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
function homeWith(config = null, files = {}) {
  const home = temp();
  if (config !== null) { fs.mkdirSync(path.join(home,'.devkit')); fs.writeFileSync(path.join(home,'.devkit','config.json'), config); }
  for (const [name,body] of Object.entries(files)) {
    fs.mkdirSync(catalogDir(home),{recursive:true});
    const file = path.join(catalogDir(home),name);
    if (body === 'DIR') fs.mkdirSync(file); else fs.writeFileSync(file,body);
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
test('I8 B7 B12: cc-version 필터, 잘못된 값과 값 생략은 미상', () => {
  const home=homeWith(null,{'fixture.json':fixtureText}); const value=script(home,['--cc-version','2.1.9']);
  assert.equal(value.ccVersion,'2.1.9'); assert.deepEqual(value.claude.belowVersion.map((m)=>m.id),['claude-fable-5-1']); assert.ok(!value.claude.choices.primary.some((m)=>m.family==='fable'));
  for (const args of [['--cc-version','bogus'],['--cc-version']]) { const unknown=script(home,args); assert.equal(unknown.ccVersion,null); assert.deepEqual(unknown.claude.belowVersion,[]); }
  assert.equal(script(home,['--cc-version=2.1.278']).ccVersion,'2.1.278');
});
const kitSetupStep10 = () => fs.readFileSync(path.join(root,'commands/kit.md'),'utf8').split('10. **모델 배분**')[1].split('\n### ')[0];
test('문서 D1 B15: 모델 단계와 setup show의 카탈로그 계약', () => {
  const doc=fs.readFileSync(path.join(root,'commands/kit.md'),'utf8'); const step=doc.split('10. **모델 배분**')[1].split('\n### ')[0];
  for (const word of ['list-models.mjs','choices','efforts','fallback','fetchedAt','stale','Claude Code 서브에이전트 전용','Codex에는 적용되지 않는다']) assert.ok(step.includes(word),word);
  assert.ok(!step.includes('--reapply')); assert.ok(doc.split('### `setup show`')[1].split('\n### ')[0].includes('--check'));
});
test('문서 D2 B19: 규칙/README/도움말/evals에 출처와 CC 전용', () => {
  const rules=fs.readFileSync(path.join(root,'RULES.md'),'utf8').split('### 에이전트 모델 배분')[1].split('\n## ')[0];
  for (const word of ['model-catalog','판정에는 관여하지 않는다','두 종류','Codex에는 적용되지 않는다']) assert.ok(rules.includes(word),word);
  assert.ok(fs.readFileSync(path.join(root,'README.md'),'utf8').includes('list-models.mjs'));
  assert.ok(fs.readFileSync(path.join(root,'commands/kit.md'),'utf8').split('## 인자 없음')[1].includes('카탈로그'));
  const evals=fs.readFileSync(path.join(root,'evals/README.md'),'utf8'); for (const word of ['model-catalog','Codex 미적용']) assert.ok(evals.includes(word));
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
