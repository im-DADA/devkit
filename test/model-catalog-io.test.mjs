import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DEFAULTS } = require('../hooks/lib/config-schema');
const { EFFORTS } = require('../hooks/lib/agent-frontmatter');
const root = path.resolve(new URL('..', import.meta.url).pathname);
const temporary = [];
process.on('exit', () => { for (const dir of temporary) fs.rmSync(dir, {recursive:true,force:true}); });
function temp() { const dir = fs.mkdtempSync(path.join(os.tmpdir(),'devkit-catalog-')); temporary.push(dir); return dir; }
const catalogDir = (home) => path.join(home,'.claude','cache','model-catalog');
const codexCache = (home) => path.join(home,'.codex','models_cache.json');
// codex: 문자열이면 본문, `'DIR'`은 디렉터리, `'SYMLINK:<target>'`은 심링크, `'EMPTYDIR'`은 파일 없는 `~/.codex/`
function homeWith(config = null, files = {}, codex = null) {
  const home = temp();
  if (config !== null) { fs.mkdirSync(path.join(home,'.devkit')); fs.writeFileSync(path.join(home,'.devkit','config.json'), config); }
  for (const [name,body] of Object.entries(files)) {
    fs.mkdirSync(catalogDir(home),{recursive:true});
    const file = path.join(catalogDir(home),name);
    // codex 쪽(:31)과 같은 규약·같은 슬라이스 길이(8)다 — Claude 쪽에도 심링크를 심을 수 있어야
    // 38행의 lstatSync에 관측점을 세울 수 있다(2026-10-01).
    if (body === 'DIR') fs.mkdirSync(file);
    else if (typeof body === 'string' && body.startsWith('SYMLINK:')) fs.symlinkSync(body.slice(8),file);
    else fs.writeFileSync(file,body);
  }
  if (codex !== null) {
    fs.mkdirSync(path.join(home,'.codex'),{recursive:true});
    const file = codexCache(home);
    if (codex === 'EMPTYDIR') { /* 디렉터리만 만든다 */ }
    else if (codex === 'DIR') fs.mkdirSync(file);
    else if (typeof codex === 'string' && codex.startsWith('SYMLINK:')) fs.symlinkSync(codex.slice(8),file);
    else fs.writeFileSync(file,codex);
  }
  return home;
}
function run(home, args, cwd = root) {
  const env = {...process.env,HOME:home}; delete env.DEVKIT_CONFIG;
  return spawnSync(process.execPath,args,{env,cwd,input:'',timeout:10000});
}
const runStart = (home,cwd) => run(home,[path.join(root,'hooks/session-start.js')],cwd);
function probeRead(home) {
  const out = run(home,['-e',`process.stdout.write(JSON.stringify(require(${JSON.stringify(path.join(root,'hooks/lib/model-catalog-io.js'))}).readClaudeCatalog()))`]);
  assert.equal(out.status,0,out.stderr.toString()); return {value:JSON.parse(out.stdout),stderr:out.stderr.toString()};
}
function script(home,args = []) {
  const out = run(home,[path.join(root,'scripts/list-models.mjs'),...args]);
  assert.equal(out.status,0,out.stderr.toString());
  assert.equal(out.stdout.toString().trim().split('\n').length,1);
  return JSON.parse(out.stdout);
}
const tree = (home) => fs.readdirSync(home,{recursive:true}).sort();
const ids = ['opus-5', 'fable-5-1', 'sonnet-5', 'haiku-4-5-20251001', 'fable-5', 'opus-4-8', 'opus-4-7', 'opus-4-6', 'sonnet-4-6'];
const FIXTURE = { version: 2, fetchedAt: 1790051534146, staleAt: 1790055055338, catalog: { config: { models: ids.map((id, i) => ({
  id: `claude-${id}`, name: id === 'fable-5-1' ? 'Fable 5.1' : id[0].toUpperCase() + id.slice(1).replaceAll('-', ' '),
  short_name: id.split('-')[0].replace(/^./, (c) => c.toUpperCase()), section: i < 4 ? 'main' : 'overflow',
  ...(i < 4 ? { quick_select: true } : {}), ...(i === 1 ? { min_claude_code_version: '2.1.251' } : {}),
  thinking: i === 3 ? { type: 'none' } : { type: 'effort', effort_options: (i >= 7 ? ['low', 'medium', 'high', 'max'] : ['low', 'medium', 'high', 'xhigh', 'max']).map((id) => ({ id })) },
})) } } };
const fixtureText = JSON.stringify(FIXTURE);
const example = {version:1,models:{planner:{model:'claude-opus-3',effort:'high'},architect:{model:'opus',effort:3},'code-reviewer':{model:'claude-opus-4-6',effort:'xhigh'},'gap-detector':{model:'claude-haiku-4-5-20251001',effort:'high'}}};

test('I1 B4: 카탈로그 디렉터리/JSON 없음은 missing, stderr 침묵', () => {
  for (const home of [homeWith(),homeWith(null,{'ignore.txt':'x'})]) { const out=probeRead(home); assert.equal(out.value.reason,'missing'); assert.equal(out.stderr,''); }
});
test('I2 B5: JSON/종류/크기/권한 실패는 본문 없는 진단 한 줄', (t) => {
  const cases = [['{ not json SECRET_BODY_MARKER','invalid'],['DIR','unreadable'],[Buffer.alloc(257*1024,'x'),'unreadable']];
  for (const [body,reason] of cases) {
    const out=probeRead(homeWith(null,{'x-cc.json':body})); assert.equal(out.value.ok,false); assert.equal(out.value.reason,reason);
    // ⚠ `''.trim().split('\n')`은 길이 1이다 — 비어있지 않음을 먼저 단언해야 진단 소실 회귀를 잡는다.
    assert.notEqual(out.stderr.trim(),''); assert.equal(out.stderr.trim().split('\n').length,1); assert.doesNotMatch(out.stderr,/SECRET_BODY_MARKER|not json/);
  }
  if (process.getuid?.() === 0) { t.diagnostic('chmod 000 검증은 root에서 생략'); return; }
  const home=homeWith(null,{'x-cc.json':'SECRET_BODY_MARKER'}); const file=path.join(catalogDir(home),'x-cc.json'); fs.chmodSync(file,0);
  try { const out=probeRead(home); assert.equal(out.value.reason,'unreadable'); assert.notEqual(out.stderr.trim(),''); assert.equal(out.stderr.trim().split('\n').length,1); assert.doesNotMatch(out.stderr,/SECRET_BODY_MARKER/); }
  finally { fs.chmodSync(file,0o600); }
});
test('I3 B6: 최신 파일 선택, stale 목록 유지, 다른 깨진 파일은 침묵', () => {
  const older=structuredClone(FIXTURE); older.fetchedAt=100; older.catalog.config.models=older.catalog.config.models.slice(0,5);
  const newer={...FIXTURE,fetchedAt:200,staleAt:1};
  const home=homeWith(null,{'old.json':JSON.stringify(older),'new.json':JSON.stringify(newer)});
  let out=probeRead(home); assert.equal(out.value.source,path.join(catalogDir(home),'new.json')); assert.equal(out.value.models.length,9); assert.equal(out.value.stale,true);
  fs.writeFileSync(path.join(catalogDir(home),'broken.json'),'{ broken'); out=probeRead(home); assert.equal(out.value.ok,true); assert.equal(out.stderr,'');
});
test('I4 B10: 기본값 HOME에 깨진 카탈로그를 넣어도 출력 바이트 동일', () => {
  const home=homeWith('{"version":1}'); const cwd=temp(); const a=runStart(home,cwd);
  fs.mkdirSync(catalogDir(home),{recursive:true}); fs.writeFileSync(path.join(catalogDir(home),'broken.json'),'{ not json'); const b=runStart(home,cwd);
  assert.equal(a.status,0); assert.equal(b.status,0); assert.equal(Buffer.compare(a.stdout,b.stdout),0); assert.equal(Buffer.compare(a.stderr,b.stderr),0);
});
test('I5 B11: 없는 id 경고 1회, 카탈로그 삭제 후 0회, P14 양성 대조', (t) => {
  const home=homeWith(JSON.stringify({version:1,models:{planner:{model:'claude-opus-3',effort:'high'}}}),{'fixture.json':fixtureText}); const cwd=temp();
  const first=runStart(home,cwd); const stdout=first.stdout.toString();
  assert.equal(first.status,0); assert.match(stdout,/에이전트 모델 설정이 풀렸다/); t.diagnostic('P14 양성 대조 PASS: 에이전트 모델 설정이 풀렸다');
  assert.equal(stdout.split('카탈로그에 없다').length-1,1,'카탈로그 경고가 0회다');
  const paragraph=stdout.slice(stdout.indexOf('⚠ 에이전트 모델이')).split('\n\n')[0];
  for (const part of ['planner','claude-opus-3','/kit setup']) assert.ok(paragraph.includes(part)); assert.ok(!paragraph.includes('--reapply'));
  fs.rmSync(catalogDir(home),{recursive:true}); const second=runStart(home,cwd); assert.equal(second.status,0);
  assert.equal(second.stdout.toString().split('카탈로그에 없다').length-1,0); assert.match(second.stdout.toString(),/에이전트 모델 설정이 풀렸다/);
});
// 마크다운 대화 흐름은 evals 수동 검증 대상이다. 여기서는 문서의 호출 문자열까지 실행한다.
test('I6 B12: 문서의 호출 실행, 목록/폴백 JSON, 홈 파일 쓰기 0', () => {
  const document=fs.readFileSync(path.join(root,'commands/kit.md'),'utf8');
  const invocation=document.match(/node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/list-models\.mjs"/); assert.ok(invocation,'kit.md에 스크립트 호출이 없다');
  for (const hasCatalog of [true,false]) {
    const home=homeWith(null,hasCatalog?{'fixture.json':fixtureText}:{}); const before=tree(home);
    const env={...process.env,HOME:home}; delete env.DEVKIT_CONFIG;
    const out=spawnSync(invocation[0].replace('${CLAUDE_PLUGIN_ROOT}',root),{shell:true,env,encoding:'utf8'});
    assert.equal(out.status,0,out.stderr); assert.equal(out.stdout.trim().split('\n').length,1); const value=JSON.parse(out.stdout);
    assert.ok(value.note.includes(' · ')); assert.equal(value.claude.status,hasCatalog?'ok':'missing'); assert.equal(value.claude.models.length,hasCatalog?9:0);
    assert.equal(value.claude.choices.primary.length,hasCatalog?4:0); assert.equal(value.claude.choices.pinned.length,hasCatalog?5:0);
    if (hasCatalog) { assert.ok(path.isAbsolute(value.claude.source)); assert.ok(Number.isFinite(Date.parse(value.claude.fetchedAt))); assert.equal(typeof value.claude.stale,'boolean'); }
    assert.deepEqual(value.fallback,{models:[...new Set(Object.values(DEFAULTS.models).map((m)=>m.model))],efforts:EFFORTS}); assert.deepEqual(tree(home),before);
  }
});
test('I7 B14: check 모드의 8행 대조와 카탈로그 부재', () => {
  for (const hasCatalog of [true,false]) {
    const home=homeWith(JSON.stringify(example),hasCatalog?{'fixture.json':fixtureText}:{}); const value=script(home,['--check']);
    assert.equal(value.agents.length,8); assert.equal(value.config.modelsDefault,false);
    if (!hasCatalog) { assert.equal(value.claude.status,'missing'); assert.ok(value.agents.every((r)=>r.modelStatus==='unjudged'&&r.effortStatus==='unjudged')); continue; }
    for (const [agent,modelStatus,effortStatus] of [['planner','absent','unjudged'],['architect','family','unjudged'],['code-reviewer','id','unsupported'],['gap-detector','id','none']]) {
      const row=value.agents.find((r)=>r.agent===agent); assert.equal(row.modelStatus,modelStatus); assert.equal(row.effortStatus,effortStatus);
    }
  }
});
// ⚠ 이름의 `B7 B12`는 **옛 사이클 번호**다(2026-09-30). 이번 사이클의 B7·B12와 숫자가 겹치지만
// 추적성을 위해 이름은 건드리지 않는다. 이 테스트가 지금 고정하는 것은 이번 B1~B5다.
test('I8 B7 B12: cc-version은 belowVersion만 만들고 선택지는 줄이지 않는다', () => {
  const home=homeWith(null,{'fixture.json':fixtureText}); const value=script(home,['--cc-version','2.1.9']);
  assert.equal(value.ccVersion,'2.1.9');
  // ① 필터가 사라져 **인자 없는 경로와 같아진다**(I6의 4/5와 일치해야 한다).
  assert.equal(value.claude.choices.primary.length,4); assert.equal(value.claude.choices.pinned.length,5);
  // ② 미달 모델이 **가족 alias 값으로** 남는다 — id로 격하되면(main에 같은 가족이 둘일 때) 여기서 빨개진다.
  assert.deepEqual(value.claude.choices.primary.map((c)=>c.value),['opus','fable','sonnet','haiku']);
  // ③ alias 선택지에도 `minVersion`이 실린다 — 마법사가 **정보 톤**으로 "최신 세대는 x.y.z 이상"을
  //    적을 근거다. ⚠ alias는 하위 세대로 **동작하므로** 차단 경고를 붙이면 안 된다(DOC6이 고정).
  assert.equal(value.claude.choices.primary.find((c)=>c.family==='fable').minVersion,'2.1.251');
  // ④ 미달 목록 자체는 그대로 산출된다(표기·안내용).
  //    ⚠ **4키 전부**를 본다 — id만 보면 투영을 깎아도(예: minVersion 제거) 아무도 못 잡고,
  //    그러면 마법사가 버전 안내를 적을 근거를 잃는다(2026-10-01 Gap이 돌연변이로 잡았다).
  assert.deepEqual(value.claude.belowVersion,
    [{ id:'claude-fable-5-1', name:'Fable 5.1', family:'fable', minVersion:'2.1.251' }]);
  for (const args of [['--cc-version','bogus'],['--cc-version']]) { const unknown=script(home,args); assert.equal(unknown.ccVersion,null); assert.deepEqual(unknown.claude.belowVersion,[]); }
  assert.equal(script(home,['--cc-version=2.1.278']).ccVersion,'2.1.278');
});
// ⚠ 앵커가 '### 모델 배분'이다 — 마법사가 3라운드가 되며 번호가 사라졌다(2026-10-01).
const kitSetupStep10 = () => fs.readFileSync(path.join(root,'commands/kit.md'),'utf8').split('\n### 모델 배분\n')[1].split('\n### ')[0];
test('문서 D1 B15: 모델 단계와 setup show의 카탈로그 계약', () => {
  const doc=fs.readFileSync(path.join(root,'commands/kit.md'),'utf8'); const step=doc.split('\n### 모델 배분\n')[1].split('\n### ')[0];
  // "Codex 미적용" 두 문장은 B30이 삭제를 요구한다 — 대신 CLI 축의 단어를 고정한다.
  for (const word of ['list-models.mjs','choices','efforts','fallback','fetchedAt','stale','clis','offer','ultra','두 CLI의 모델을 한 목록에 섞지 마라']) assert.ok(step.includes(word),word);
  assert.ok(!step.includes('--reapply')); assert.ok(doc.split('### `setup show`')[1].split('\n### ')[0].includes('--check'));
});
test('문서 D2 B19: 규칙/README/도움말/evals에 출처와 CC 전용', () => {
  const rules=fs.readFileSync(path.join(root,'RULES.md'),'utf8').split('### 에이전트 모델 배분')[1].split('\n### ')[0];
  for (const word of ['cli-detect.js','판정에는 관여하지 않는다','두 종류','폴백 정의']) assert.ok(rules.includes(word),word);
  assert.ok(fs.readFileSync(path.join(root,'README.md'),'utf8').includes('list-models.mjs'));
  assert.ok(fs.readFileSync(path.join(root,'commands/kit.md'),'utf8').split('## 인자 없음')[1].includes('로컬 캐시'));
  const evals=fs.readFileSync(path.join(root,'evals/README.md'),'utf8'); for (const word of ['list-models.mjs','codex exec','CLI 질문']) assert.ok(evals.includes(word),`evals: ${word}`);
});

test('문서 B22: 10단계가 낡은 EXECPATH를 1차 버전원으로 쓰지 않는다', () => {
  const step = kitSetupStep10();
  assert.match(step, /claude --version/);
  // env가 낡는다는 사실과 "모르면 안 넘긴다"는 처방이 둘 다 있어야 한다.
  assert.match(step, /런처 경로라 실행 중 버전보다 \*\*낡는다\*\*|낡는다/);
  assert.match(step, /큰 값/);
  assert.match(step, /인자를 넘기지 마라/);
  // 설명·권장값을 보여주라는 지시가 살아 있어야 한다(이름만 나열하는 회귀 방지).
  assert.match(step, /description/);
  assert.match(step, /notice/);
  assert.match(step, /recommended/);
});

test('문서 B23: evals 모델 단계 행이 표에서 끊기지 않는다', () => {
  const lines = fs.readFileSync(path.join(root,'evals/README.md'),'utf8').split('\n');
  const i = lines.findIndex((l) => l.startsWith('| **모델 단계**'));
  assert.ok(i > 0, '모델 단계 행이 있어야 한다');
  // GFM은 빈 줄로 표가 끊긴다 — 바로 위 줄도 표 행이어야 같은 표로 렌더된다.
  assert.match(lines[i - 1], /^\|/, `모델 단계 행 위(${i}행)가 표 행이 아니다: ${JSON.stringify(lines[i - 1])}`);
});

test('문서 B24: README의 해싱 파일 개수가 매니페스트 실제 줄 수와 같다', () => {
  const manifest = fs.readFileSync(path.join(root,'INTEGRITY.sha256'),'utf8').trim().split('\n').length;
  const readme = fs.readFileSync(path.join(root,'README.md'),'utf8');
  const claimed = readme.match(/실행 파일 (\d+)개를 해싱/);
  assert.ok(claimed, 'README에 해싱 개수 문장이 있어야 한다');
  assert.equal(Number(claimed[1]), manifest);
});

// ── Codex 캐시 리더 (§8.5) ─────────────────────────────────────
// 상한을 Claude와 **공유하지 않는다**: 실측 캐시가 351,987B이고 Claude용 256KB를 공유하면
// 항상 `unreadable`이 되어 기능이 통째로 죽는다(§4.4).
const CODEX_MODELS = [
  { slug:'gpt-6-astra', display_name:'GPT-6 Astra', description:'desc-astra', visibility:'list',
    default_reasoning_level:'medium',
    supported_reasoning_levels:[{effort:'low'},{effort:'medium'},{effort:'high'},{effort:'xhigh'},{effort:'ultra'}] },
  { slug:'gpt-5.5', display_name:'GPT-5.5', description:'desc-55', visibility:'list',
    default_reasoning_level:'high', supported_reasoning_levels:[{effort:'low'},{effort:'medium'}] },
  { slug:'gpt-reserve', display_name:'Reserve', visibility:'hide',
    default_reasoning_level:'nope', supported_reasoning_levels:[{effort:'low'}] },
];
const codexBody = (pad = 0) => JSON.stringify({ fetched_at:'2026-09-30T02:11:04Z', etag:'W/"x"', client_version:'0.155.1',
  identity:{plan:'x'},
  models: CODEX_MODELS.map((m,i) => i === 0 && pad ? {...m, description:'desc-astra'+'x'.repeat(pad)} : m) });
function probeReadCodex(home) {
  const out = run(home,['-e',`process.stdout.write(JSON.stringify(require(${JSON.stringify(path.join(root,'hooks/lib/model-catalog-io.js'))}).readCodexCatalog()))`]);
  assert.equal(out.status,0,out.stderr.toString()); return {value:JSON.parse(out.stdout),stderr:out.stderr.toString()};
}

test('IX1 B5: 352KB급 Codex 캐시를 읽어낸다 — Claude용 256KB 상한에 걸리지 않는다', () => {
  const body = codexBody(400*1024);
  assert.ok(Buffer.byteLength(body) > 256*1024, '이 테스트의 전제가 깨졌다 — 본문이 256KB를 넘지 않는다');
  const home = homeWith(null,{},body);
  const out = probeReadCodex(home);
  assert.equal(out.value.ok,true,JSON.stringify(out.value));
  assert.equal(out.value.cli,'codex');
  assert.equal(out.value.models.length,3);
  // 만료 시각 필드를 캐시에서 찾지 못했다 — stale 판정을 하지 않는다(R4·O8).
  assert.equal(out.value.stale,false);
  assert.equal(out.value.staleAt,null);
  assert.equal(out.value.fetchedAt,Date.parse('2026-09-30T02:11:04Z'));
  assert.equal(out.value.source,codexCache(home));
  assert.equal(out.stderr,'');
});

test('IX2 B6: 상한을 넘는 파일은 unreadable이고 진단은 본문 없는 한 줄이다', () => {
  const { MAX_CODEX_CATALOG_BYTES } = require('../hooks/lib/model-catalog-io.js');
  assert.equal(MAX_CODEX_CATALOG_BYTES, 2*1024*1024);
  const big = Buffer.concat([Buffer.from('SECRET_BODY_MARKER'), Buffer.alloc(MAX_CODEX_CATALOG_BYTES+1-18,'x')]);
  assert.equal(big.length, MAX_CODEX_CATALOG_BYTES+1);
  const out = probeReadCodex(homeWith(null,{},big));
  assert.equal(out.value.ok,false); assert.equal(out.value.reason,'unreadable');
  // ⚠ `''.trim().split('\n')`은 길이 1이다 — **비어있지 않음을 먼저** 단언해야 진단 소실을 잡는다.
  assert.notEqual(out.stderr.trim(),'');
  assert.equal(out.stderr.trim().split('\n').length,1);
  assert.doesNotMatch(out.stderr,/SECRET_BODY_MARKER|xxxx/);
  assert.match(out.stderr,/상한 2097152B/);
});

test('IX3 B7: Codex 캐시가 없으면 missing이고 stderr가 조용하다', () => {
  for (const home of [homeWith(), homeWith(null,{},'EMPTYDIR')]) {
    const out = probeReadCodex(home);
    assert.equal(out.value.ok,false); assert.equal(out.value.reason,'missing');
    assert.equal(out.stderr,'');
  }
});

test('IX4 B8: 심링크와 디렉터리는 따라가지 않고 unreadable이다', () => {
  const outside = temp();
  const target = path.join(outside,'real-cache.json');
  fs.writeFileSync(target, codexBody());
  const link = probeReadCodex(homeWith(null,{},`SYMLINK:${target}`));
  assert.equal(link.value.ok,false,'HOME 밖 심링크를 따라 읽었다');
  assert.equal(link.value.reason,'unreadable');
  assert.ok(!('models' in link.value) || link.value.models === undefined);
  assert.notEqual(link.stderr.trim(),''); assert.equal(link.stderr.trim().split('\n').length,1);
  const dir = probeReadCodex(homeWith(null,{},'DIR'));
  assert.equal(dir.value.reason,'unreadable');
  assert.match(dir.stderr,/정규 파일이 아니다/);
});

test('IX5 B5 B6: JSON 아님과 shape 밖은 invalid, 0종은 empty다', () => {
  const bad = probeReadCodex(homeWith(null,{},'{ not json SECRET_BODY_MARKER'));
  assert.equal(bad.value.reason,'invalid');
  assert.notEqual(bad.stderr.trim(),''); assert.equal(bad.stderr.trim().split('\n').length,1);
  assert.doesNotMatch(bad.stderr,/SECRET_BODY_MARKER|not json/);
  const shape = probeReadCodex(homeWith(null,{},'{"models":"x"}'));
  assert.equal(shape.value.reason,'invalid');
  assert.match(shape.stderr,/models=string/);
  assert.equal(shape.stderr.trim().split('\n').length,1);
  const empty = probeReadCodex(homeWith(null,{},'{"models":[]}'));
  assert.equal(empty.value.reason,'empty');
  assert.notEqual(empty.stderr.trim(),'');
});

test('IX9 B20 B34: cli가 codex인 항목은 드리프트 경고를 내지 않는다', () => {
  const cwd = temp();
  const codex = homeWith(JSON.stringify({version:1,models:{'tdd-driver':{cli:'codex',model:'gpt-6-astra',effort:'ultra'}}}));
  const quiet = runStart(codex,cwd);
  assert.equal(quiet.status,0);
  assert.doesNotMatch(quiet.stdout.toString(),/모델 설정이 풀렸다/);
  // 양성 대조: 같은 값을 claude로 돌리면 경고가 **있다**(침묵이 구현 누락이 아님을 증명한다).
  const claude = homeWith(JSON.stringify({version:1,models:{'tdd-driver':{cli:'claude',model:'gpt-6-astra',effort:'ultra'}}}));
  const loud = runStart(claude,cwd);
  assert.equal(loud.status,0);
  assert.match(loud.stdout.toString(),/모델 설정이 풀렸다/);
});

test('IX10 P1: 설정 없는 사용자는 Codex 캐시 유무와 무관하게 출력 바이트가 같다', () => {
  // ⚠ **같은 HOME**에서 두 번 돈다. 첫 실행 안내가 HOME 경로를 본문에 보간하므로
  // (rules-render.js:152) 홈이 다르면 바이트가 달라져 이 단언이 무엇도 증명하지 못한다.
  const home = homeWith(null,{'fixture.json':fixtureText}); const cwd = temp();
  const a = runStart(home,cwd);
  fs.mkdirSync(path.join(home,'.codex'),{recursive:true}); fs.writeFileSync(codexCache(home),codexBody());
  const b = runStart(home,cwd);
  assert.equal(a.status,0); assert.equal(b.status,0);
  assert.equal(Buffer.compare(a.stdout,b.stdout),0,'기본값 사용자의 stdout이 Codex 캐시에 반응했다 — IO 0 계약이 깨졌다');
  assert.equal(Buffer.compare(a.stderr,b.stderr),0);
});

// ── IX6~IX8: 스크립트 출력에 CLI 축 (B22·B23·B24·B13) ──────────
// 설계: DESIGN.md §4.5. 기존 최상위 키는 한 글자도 빼지 않는다(B23).

test('IX6 B22 B23: clis·detected·offer가 실리고 기존 최상위 키가 그대로 남는다', () => {
  const home = homeWith(null,{'a-cc.json':JSON.stringify(FIXTURE)},codexBody());
  const before = tree(home);
  const j = script(home);
  // 기존 계약(B23) — 하나라도 빠지면 setup show와 --check가 깨진다.
  for (const key of ['note','mode','cli','ccVersion','claude','fallback']) assert.ok(key in j, `최상위 ${key}가 사라졌다`);
  assert.ok(j.note.includes(' · '), 'note의 SEP가 없으면 이 줄이 인용 대조 후보가 된다');
  // clis.claude는 최상위 claude와 같은 내용이다(§3.6 — 마법사 지시문이 CLI별로 갈리지 않게).
  assert.deepEqual(j.clis.claude, j.claude);
  assert.equal(j.clis.codex.status,'ok');
  assert.equal(j.clis.codex.choices.primary.length,2, 'hidden 1종을 뺀 2종이어야 한다');
  assert.deepEqual(j.clis.codex.choices.pinned,[], 'Codex에는 section이 없어 pinned가 성립하지 않는다(R9)');
  assert.equal(j.clis.codex.stale,false, '만료 시각 필드를 찾지 못했으므로 stale 판정을 하지 않는다');
  assert.ok(Number.isFinite(Date.parse(j.clis.codex.fetchedAt)), 'fetchedAt이 ISO가 아니다');
  assert.ok(j.detected.codex.status, 'detected가 비었다');
  assert.equal(j.offer.length,2, 'offered가 false여도 이유를 말할 수 있어야 하므로 항상 둘이다');
  assert.equal(j.offer[0].cli,'claude');
  assert.deepEqual(tree(home),before, '보고 도구가 파일을 썼다');
});

test('IX7 B13: --cli는 감지 결과와 무관하게 노출한다', () => {
  const home = homeWith(null,{},null);           // Codex 캐시도 홈도 없다
  const j = script(home,['--cli=codex']);
  const codex = j.offer.find((o) => o.cli === 'codex');
  assert.equal(codex.offered,true);
  assert.equal(codex.forced,true);
  // ⚠ hint는 단언하지 않는다 — 이 테스트는 PATH를 물려받고, 이 머신에 codex가 깔려 있으면
  // status가 absent가 아니라 binary라서 forced hint가 붙지 않는다. 그 문안은 환경에
  // 의존하지 않는 DT5(순수 함수)가 본다. 여기서 보는 것은 **--cli 인자가 프로세스
  // 경계를 넘어 offerableClis까지 닿는가**다.
});

test('IX8 B24: Codex가 없어도 exit 0이고 Claude 쪽은 정상이다', () => {
  const home = homeWith(null,{'a-cc.json':JSON.stringify(FIXTURE)},null);
  const j = script(home);
  assert.equal(j.clis.codex.status,'missing');
  assert.deepEqual(j.clis.codex.models,[]);
  assert.deepEqual(j.clis.codex.choices,{primary:[],pinned:[]});
  assert.equal(j.clis.claude.status,'ok', 'Codex 부재가 Claude 목록을 깨서는 안 된다');
  assert.ok(j.fallback.models.length > 0);
});

// ── DOC1~DOC4: 이번 사이클의 문서 계약 (B19·B25·B27~B32·B37) ──────
// 설계: DESIGN.md §8.6. 문안이 재생성되면 단어가 어긋나므로 여기서 고정한다.
const kitDoc = () => fs.readFileSync(path.join(root,'commands/kit.md'),'utf8');
const modelSection = () => kitDoc().split('\n### 모델 배분\n')[1].split('\n### ')[0];

test('문서 DOC1 B19: 모델 적용이 CLI별로 갈리고 Codex는 기본값으로 되돌린다', () => {
  const step = modelSection();
  for (const word of ['cli','codex','DEFAULTS.models','되돌린다','폴백 정의','applyModel']) {
    assert.ok(step.includes(word), `모델 배분 절에 ${word}가 없다`);
  }
});

test('문서 DOC2 B25 B27 B28 B37: 라운드 축소·4선택지 제약·Codex 제외 사유·목록 밖 입력', () => {
  const doc = kitDoc();
  for (const word of ['한 라운드에 세 문항','24개 항목','직접 고르기','최대 4개','4개씩 나눠 라운드',
    '8종을 하나씩 묻지 않는다','report-writer','검증하지 않았다','목록에 없는 모델도 그대로 적을 수 있다']) {
    assert.ok(doc.includes(word), `kit.md에 ${word}가 없다`);
  }
  // 재적용은 카탈로그 드리프트의 처방이 아니다 — 모델 배분 절에 들어오면 안 된다.
  assert.ok(!modelSection().includes('--reapply'), '모델 배분 절에 --reapply가 있다');
  // B42: 감지가 틀렸을 때의 탈출구가 하위 명령표와 도움말 **둘 다**에 있어야 찾을 수 있다.
  assert.ok(doc.split('### 마법사 절차')[0].includes('--cli='), '하위 명령표에 --cli 탈출구가 없다');
  assert.ok(doc.split('## 인자 없음')[1].includes('--cli=codex'), '도움말에 --cli 탈출구가 없다');
});

test('문서 DOC3 B29 B30 B32: Codex 실행 규약이 한 곳에 있고 금지 문장이 사라졌다', () => {
  const rules = fs.readFileSync(path.join(root,'RULES.md'),'utf8');
  const protocol = rules.split('### Codex 단계 실행 규약')[1];
  assert.ok(protocol, 'RULES.md에 Codex 단계 실행 규약 절이 없다');
  for (const word of ['codex exec','model_reasoning_effort','stdin','-o','stdout을 파싱하지 마라',
    'workspace-write','read-only','폴백','dangerously']) {
    assert.ok(protocol.includes(word), `규약에 ${word}가 없다`);
  }
  // B44: `cat <…>`는 셸이 리다이렉션으로 읽어 parse error를 낸다 — 코드블록에 남으면 안 된다.
  assert.ok(!protocol.includes('cat <'), '규약의 cat에 셸 메타문자 placeholder가 남아 있다');
  // 실측으로 드러난 두 사실이 적혀 있어야 한다(둘 다 사용자를 오해시킨다).
  assert.ok(protocol.includes('stderr'), '훅 출력 채널 사실이 없다');
  assert.ok(protocol.includes('--skip-git-repo-check'), 'git 레포 요구 사실이 없다');
  // B30: 이번 사이클이 대체한 문장이 어디에도 남아 있지 않다.
  for (const file of ['RULES.md','commands/kit.md','README.md','evals/README.md']) {
    const text = fs.readFileSync(path.join(root,file),'utf8');
    for (const gone of ['Codex 미적용','Codex에는 적용되지 않는다']) {
      assert.ok(!text.includes(gone), `${file}에 "${gone}"이 남아 있다`);
    }
  }
});

test('문서 DOC4 B31 B32: 커맨드가 CLI 분기를 적고 규약을 참조한다', () => {
  // iterate·ship도 Task로 위임한다 — 빠지면 설정을 조용히 무시한다(RULES.md가 금지한 상태).
  for (const name of ['plan','review','tdd','gap','report','flow','iterate','ship']) {
    const doc = fs.readFileSync(path.join(root,'commands',`${name}.md`),'utf8');
    for (const word of ['models','cli','codex exec','RULES.md','dangerously']) {
      assert.ok(doc.includes(word), `commands/${name}.md에 ${word}가 없다`);
    }
  }
});

// ── IX11: 고장난 설정에서도 exit 0과 폴백을 지킨다 (B43) ────────
// ⚠ 이 테스트는 `catch` 블록을 타지 **않는다.** config.js·model-catalog-io.js의 읽기 가드가
// 모든 고장을 먼저 잡아 정상 경로로 흘리기 때문이다(2026-10-01 실측: config.json을 디렉터리로
// 둬도 `설정 경로가 정규 파일이 아니다` 경고 후 기본값을 반환한다). 즉 `list-models.mjs:79`의
// catch는 **도달시킬 입력을 찾지 못한 최후 방어선**이고, 그 사실 자체를 여기 남긴다.
// 이 테스트가 고정하는 것은 "가드가 처리해 exit 0과 폴백 형태가 유지된다"다.
test('IX11 B43: 설정이 고장나도 가드가 처리해 exit 0과 폴백 형태를 지킨다', () => {
  // 주입 가능한 고장 — config.json을 **디렉터리**로 둔다.
  const home = homeWith(null,{'a-cc.json':JSON.stringify(FIXTURE)},null);
  fs.mkdirSync(path.join(home,'.devkit'),{recursive:true});
  fs.mkdirSync(path.join(home,'.devkit','config.json'));
  const before = tree(home);
  const out = run(home,[path.join(root,'scripts/list-models.mjs'),'--check']);
  assert.equal(out.status,0,'보고 도구는 스스로 터져도 작업을 막지 않는다');
  const j = JSON.parse(out.stdout);
  assert.ok(j.note && j.fallback, '폴백 JSON의 최소 형태가 깨졌다');
  assert.ok(j.clis && j.clis.claude && j.clis.codex, 'clis 자리가 비면 마법사가 읽을 수 없다');
  assert.deepEqual(tree(home),before,'예외 경로에서 파일을 썼다');
});

// ── IX12: readAgentModels의 실패 경로 (B43 동반 지적) ─────────────
// 2026-10-01 Gap: 이 함수는 테스트가 0건이었고 :126의 catch는 도달이 trivial하다
// ("못 읽은 것은 풀렸다가 아니다"는 계약이 여기 걸려 있다 — null이어야 드리프트 오탐이 안 난다).
test('IX12 B43: 없는 디렉터리를 주면 8종 전부 null이고 throw하지 않는다', () => {
  const home = homeWith();
  const out = run(home,['-e',
    `const io = require(${JSON.stringify(path.join(root,'hooks/lib/model-catalog-io.js'))});`
    + `process.stdout.write(JSON.stringify(io.readAgentModels('/definitely/not/here')))`]);
  assert.equal(out.status,0,out.stderr.toString());
  const got = JSON.parse(out.stdout);
  assert.equal(Object.keys(got).length,8);
  assert.deepEqual(Object.values(got),Array(8).fill(null),'읽지 못한 에이전트는 null이어야 한다');
  assert.equal(out.stderr.toString(),'', '못 읽은 것은 정상 상태다 — 경고하지 않는다');
});

// ── IX13: --cli 인자 규약과 미지값 진단 (2026-10-01 리뷰 🟢2) ──────
test('IX13: --cli는 공백 형태도 받고 모르는 값은 조용히 삼키지 않는다', () => {
  const home = homeWith(null,{'a-cc.json':JSON.stringify(FIXTURE)},null);
  // `--cc-version`과 같은 규약 — 한 파일 안에서 인자 형태가 갈리면 호출자가 헷갈린다.
  const spaced = script(home,['--cli','codex']);
  assert.equal(spaced.offer.find((o) => o.cli === 'codex').forced,true,'공백 형태를 못 받았다');
  // 모르는 값은 stderr 한 줄로 알리고 exit 0을 지킨다(조용히 무시하면 오타를 모른다).
  const out = run(home,[path.join(root,'scripts/list-models.mjs'),'--cli=gemini']);
  assert.equal(out.status,0);
  assert.match(out.stderr.toString(),/--cli 값을 모른다/);
  assert.ok(!JSON.parse(out.stdout).offer.some((o) => o.cli === 'gemini'),'모르는 CLI가 선택지에 샜다');
});

// ── IX14: fetchedAt이 날짜가 아니면 null로 낸다 (2026-10-01 Gap 2회차) ──
// `iso()`의 null 분기가 미검증으로 남아 있었다 — 없는 값을 ISO처럼 꾸며 내지 않는 것이 계약이다.
test('IX14: fetched_at이 날짜가 아니면 fetchedAt이 null이고 exit 0이다', () => {
  const body = JSON.stringify({ fetched_at:'not-a-date', etag:'W/"x"',
    models:[{slug:'gpt-x', display_name:'X', visibility:'list',
      default_reasoning_level:'low', supported_reasoning_levels:[{effort:'low'}]}] });
  const j = script(homeWith(null,{},body));
  assert.equal(j.clis.codex.status,'ok','날짜가 깨진 것은 목록을 무효화하지 않는다');
  assert.equal(j.clis.codex.fetchedAt,null,'파싱 못한 시각을 ISO처럼 꾸며 내면 안 된다');
  assert.equal(j.clis.codex.choices.primary.length,1);
});

// ── IX16: priority 정렬이 스크립트 출력까지 닿는다 (B7·B9·B17·B18) ──
// ⚠ 실제 캐시는 캐시 순서 == priority 순서라(2026-10-01 실측) 정렬이 돌았는지 구분되지 않는다.
//    그래서 **일부러 어긋난** 입력으로 정렬을 증명한다.
test('IX16 B7 B17 B18: choices는 priority 순, models는 캐시 순, priority는 Codex에만 실린다', () => {
  const body = JSON.stringify({ fetched_at:'2026-10-01T00:00:00Z', etag:'W/"x"',
    models: [
      { slug:'A', display_name:'A', visibility:'list', priority:9,
        default_reasoning_level:'low', supported_reasoning_levels:[{effort:'low'}] },
      { slug:'B', display_name:'B', visibility:'list', priority:2,
        default_reasoning_level:'low', supported_reasoning_levels:[{effort:'low'}] },
      { slug:'C', display_name:'C', visibility:'list',
        default_reasoning_level:'low', supported_reasoning_levels:[{effort:'low'}] },
    ] });
  const home = homeWith(null,{'fixture.json':fixtureText},body);
  const j = script(home);
  // 선택지는 priority 오름차순 — 결측(C)은 캐시 순서를 지키며 뒤로.
  assert.deepEqual(j.clis.codex.choices.primary.map((c)=>c.value), ['B','A','C']);
  // models는 **캐시 순서 그대로**다(B18) — 정렬이 입력을 변이시켰다면 여기가 ['B','A','C']가 된다.
  assert.deepEqual(j.clis.codex.models.map((m)=>m.id), ['A','B','C']);
  // B17: Codex에만 키가 늘었다. Claude 쪽은 그대로다(비대칭을 양성 단언한다).
  assert.ok('priority' in j.clis.codex.models[0], 'Codex 정규화에 priority가 없다');
  assert.equal(j.clis.codex.models[2].priority, null, '결측은 null이어야 한다');
  assert.ok(!('priority' in j.clis.claude.models[0]), 'Claude에 priority가 샜다');
});

// ── IX15: Claude 카탈로그 심링크 방어 (B12·B13) ──────────────────
// 2026-10-01까지 이 자리는 **무검증이었다** — model-catalog-io.js:38을 statSync로 되돌려도
// 아무 기능 테스트가 빨개지지 않았다(직전 사이클 Gap 1회차 발견). Codex 쪽은 IX4가 덮는다.
// ⚠ IX4의 `!('models' in value)`는 약한 앵커다 — 실패 객체의 성질일 뿐 *링크 대상이 새지
//    않았다*를 증명하지 않는다. 그래서 링크 대상에 **고유 마커**를 심고 부재를 직접 단언한다.
test('IX15 B12: Claude 카탈로그가 심링크면 읽지 않고 링크 대상이 새지 않는다', () => {
  const outside = temp();
  const target = path.join(outside,'real-catalog.json');
  fs.writeFileSync(target, JSON.stringify({ ...FIXTURE, catalog: { config: { models: [
    { id:'claude-symlink-leak-marker', name:'Leak', short_name:'Leak', section:'main',
      thinking:{ type:'effort', effort_options:[{id:'low'}] } },
  ] } } }));
  const home = homeWith(null,{'x-cc.json':`SYMLINK:${target}`});
  const out = probeRead(home);
  assert.equal(out.value.ok,false);
  assert.equal(out.value.reason,'unreadable');
  // 링크 **대상의 모델**이 결과에 하나도 나타나지 않는다 — 이것이 이 테스트의 본체다.
  assert.doesNotMatch(JSON.stringify(out.value),/symlink-leak-marker/);
  assert.equal(out.stderr.trim().split('\n').length,1);
  assert.notEqual(out.stderr.trim(),'');
  assert.doesNotMatch(out.stderr,/symlink-leak-marker/);
  assert.doesNotMatch(out.stderr,new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),
    '링크 대상 경로를 진단에 싣지 않는다');
});

// ── DOC6: 이번 사이클의 문안 계약 (B14·B15) ──────────────────────
// 앵커는 네 글자 이하·일반 명사를 피한다(직전 리뷰가 `clis`(4자)를 약한 앵커로 지적했다).
// 부재 단언은 **commands/kit.md 한 파일로 좁힌다** — `통째로 사라진다`는 다른 4개 파일에
// 무관한 뜻으로 존재한다(no-config-parity:445 · verify-classify:289 · receipt.js · rules-sync.js).
test('문서 DOC6 B14 B15: 빼지 않고 업데이트를 안내하고 priority·effort 순서의 근거를 적는다', () => {
  const doc = kitDoc();
  const step = modelSection();
  for (const word of ['선택지에서 빼지 않는다','claude update','하위 세대로 내려준다',
    '오름차순','작을수록 상위','캐시 순서를 지키며 뒤로','관측이지 보장이 아니다','2026-10-01','과하게 잡혀']) {
    assert.ok(step.includes(word), `모델 배분 절에 "${word}"가 없다`);
  }
  // alias와 id 고정의 **분기**를 고정한다 — 한 문구로 합치면 동작하는 선택지(alias)에
  // 불필요한 `claude update`가 붙는다(2026-10-01 리뷰 🟡2). 뭉뚱그리기로의 회귀를 막는다.
  for (const word of ['차단 경고를 붙이지 마라','id 고정']) {
    assert.ok(step.includes(word), `모델 배분 절에 "${word}"가 없다`);
  }
  // 휘발성 수치는 문서에 박지 않는다 — 캐시가 하루 안에 바뀌는 것을 리뷰 중 관측했다.
  assert.ok(!doc.includes('가시 7종'), 'kit.md에 고정된 가시 모델 수가 남아 있다');
  assert.doesNotMatch(doc, /`gpt-[0-9]/, 'kit.md에 Codex 모델 슬러그가 박혀 있다');
  // 뜻이 뒤집힌 옛 문장이 남아 있으면 안 된다.
  assert.ok(!doc.includes('통째로 사라진다'), 'kit.md에 "통째로 사라진다"가 남아 있다');
  assert.ok(!doc.includes('선택지에 넣지 말고'), 'kit.md에 "선택지에 넣지 말고"가 남아 있다');
});
