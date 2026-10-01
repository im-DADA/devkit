import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { DEFAULTS, AGENTS, mergeConfig } = require('../hooks/lib/config-schema');
const { EFFORTS } = require('../hooks/lib/agent-frontmatter');
const catalogPath = new URL('../hooks/lib/model-catalog.js', import.meta.url).pathname;
const load = () => require(catalogPath);
const ids = ['opus-5', 'fable-5-1', 'sonnet-5', 'haiku-4-5-20251001', 'fable-5', 'opus-4-8', 'opus-4-7', 'opus-4-6', 'sonnet-4-6'];
const FIXTURE = { version: 2, fetchedAt: 1790051534146, staleAt: 1790055055338, catalog: { config: { models: ids.map((id, i) => ({
  id: `claude-${id}`, name: id === 'fable-5-1' ? 'Fable 5.1' : id[0].toUpperCase() + id.slice(1).replaceAll('-', ' '),
  short_name: id.split('-')[0].replace(/^./, (c) => c.toUpperCase()), section: i < 4 ? 'main' : 'overflow',
  ...(i < 4 ? { quick_select: true } : {}), ...(i === 1 ? { min_claude_code_version: '2.1.251' } : {}),
  description: `desc-${id}`, ...(i < 2 ? { notice: { text: `cost-${id}` } } : {}),
  thinking: i === 3 ? { type: 'none' } : { type: 'effort', effort_options: (i >= 7 ? ['low', 'medium', 'high', 'max'] : ['low', 'medium', 'high', 'xhigh', 'max']).map((eid) => ({ id: eid, name: eid[0].toUpperCase() + eid.slice(1), ...(eid === 'high' ? { badge: { message: 'Recommended' } } : {}) })) },
})) } } };
const models = () => load().normalizeClaudeCatalog(FIXTURE).models;
const catalog = () => ({ ok: true, models: models() });
const configured = (models) => mergeConfig({ models }).config;

test('C1 B1: 9종 정규화, 가족/section/effort/버전 보존', () => {
  const parsed = load().normalizeClaudeCatalog(FIXTURE);
  assert.deepEqual(parsed.models.map((m) => m.id), ids.map((id) => `claude-${id}`));
  assert.deepEqual(parsed.models.map((m) => m.family), ids.map((id) => id.split('-')[0]));
  assert.deepEqual(parsed.models.map((m) => m.section), ids.map((_, i) => i < 4 ? 'main' : 'overflow'));
  assert.deepEqual(parsed.models.map((m) => m.quickSelect), ids.map((_, i) => i < 4));
  assert.deepEqual(parsed.models[3].efforts, []);
  for (const i of [7, 8]) assert.deepEqual(parsed.models[i].efforts, ['low', 'medium', 'high', 'max']);
  assert.deepEqual(parsed.models[0].efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(parsed.models.map((m) => m.minVersion), ids.map((_, i) => i === 1 ? '2.1.251' : null));
  assert.ok(parsed.models.every((m) => m.hidden === false));
  assert.equal(parsed.fetchedAt, FIXTURE.fetchedAt); assert.equal(parsed.staleAt, FIXTURE.staleAt);
});
test('C2 B2: fs 봉인 프로세스에서 로드와 판정', () => {
  const probe = `const Module = require('module'); const original = Module.prototype.require;
    Module.prototype.require = function(id) { if (['fs','node:fs','fs/promises','node:fs/promises'].includes(id)) throw new Error('FS_TOUCHED'); return original.apply(this, arguments); };
    const m = require(${JSON.stringify(catalogPath)}); const parsed = m.normalizeClaudeCatalog(${JSON.stringify(FIXTURE)});
    process.stdout.write(JSON.stringify([parsed.models.length, m.matchModel('opus', parsed.models), m.catalogDriftMessage({}, null), m.checkAssignments({}, {ok:false}).length]));`;
  const out = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr); assert.deepEqual(JSON.parse(out.stdout), [9, 'family', '', 8]);
});
test('C3 B3: shape 밖 입력은 null, 빈 배열은 빈 목록', () => {
  const { normalizeClaudeCatalog: normalize } = load();
  for (const raw of [null, [], 'x', {}, {version:2}, {version:3,catalog:{config:{models:[]}}}, {version:2,catalog:{config:{models:'x'}}}, {version:2,catalog:{config:{models:[{name:'x'}]}}}]) assert.equal(normalize(raw), null);
  assert.deepEqual(normalize({version:2,catalog:{config:{models:[]}}}).models, []);
});
test('C4 B7: 숫자 버전 비교와 미상 버전 필터 생략', () => {
  const { compareVersion, splitByVersion } = load();
  for (const [a,b,result] of [['2.1.278','2.1.251',1], ['2.1.9','2.1.251',-1], ['2.1','2.1.0',0], ['2.1.278-beta','1',null]]) assert.equal(compareVersion(a,b), result);
  for (const version of [undefined, null, 'garbage']) assert.deepEqual(splitByVersion(models(), version), {offered:models(),belowVersion:[]});
  const split = splitByVersion(models(), '2.1.9'); assert.equal(split.offered.length, 8); assert.deepEqual(split.belowVersion.map((m) => m.id), ['claude-fable-5-1']);
  assert.equal(splitByVersion(models(), '2.1.278').belowVersion.length, 0);
});
test('C5 B8: id/가족 정확 일치와 판정 범위', () => {
  const {matchModel, classifyModel} = load();
  for (const [value,result] of [['claude-opus-5','id'],['opus','family'],['claude-opus-3',null],['Opus',null],['',null],[undefined,null],[3,null]]) assert.equal(matchModel(value,models()),result);
  assert.equal(classifyModel('claude-opus-3',models()),'absent');
  for (const value of ['opusplan','claude-sonnet-4-6[1m]','claude-3-5-sonnet-v2@20241022','claude-'+ 'a'.repeat(61)]) assert.equal(classifyModel(value,models()),'unjudged');
  assert.equal(matchModel('claude-opus-5', [{...models()[0],hidden:true}]),'id');
});
test('C6 B9: 기본값/alias/카탈로그 부재는 침묵, 없는 id만 경고', () => {
  const {catalogDriftMessage: message, modelsAreDefault} = load();
  assert.equal(modelsAreDefault(mergeConfig(undefined).config),true);
  assert.equal(message(mergeConfig(undefined).config,catalog()),'');
  const cfg = configured({planner:{model:'claude-opus-3'}});
  for (const cat of [null,{ok:false}, {ok:true,models:[]}]) assert.equal(message(cfg,cat),'');
  for (const model of ['opus','fable','claude-opus-5']) assert.equal(message(configured({planner:{model}}),catalog()),'');
  const warning = message(cfg,catalog()); for (const part of ['planner','claude-opus-3','/kit setup','404']) assert.ok(warning.includes(part));
  assert.ok(!warning.includes('--reapply'));
  assert.match(message(configured({planner:{model:'claude-opus-3'},architect:{model:'claude-opus-3'}}),catalog()), /planner.*architect/);
  for (const value of [null,3,'x',[]]) assert.equal(message({models:value},catalog()),'');
});
test('C7 B13: 폴백은 DEFAULTS와 EFFORTS에서 유도', () => {
  assert.deepEqual(load().fallbackChoices(), {models:[...new Set(Object.values(DEFAULTS.models).map((m) => m.model))],efforts:EFFORTS});
});
test('C8 B14: 에이전트별 모델/effort 대조, 정수와 부재는 unjudged', () => {
  const {effortStatusFor,checkAssignments} = load(); const m = models();
  for (const [effort,model,result] of [['high',m[3],'none'],['xhigh',m[7],'unsupported'],['high',m[0],'ok'],[3,m[0],'unjudged'],['high',null,'unjudged']]) assert.equal(effortStatusFor(effort,model),result);
  const cfg = configured({planner:{model:'claude-opus-3',effort:'high'},architect:{model:'opus',effort:3},'code-reviewer':{model:'claude-opus-4-6',effort:'xhigh'},'gap-detector':{model:'claude-haiku-4-5-20251001',effort:'high'}});
  const absent = checkAssignments(cfg,{ok:false}); assert.equal(absent.length,8); assert.ok(absent.every((row) => row.modelStatus === 'unjudged' && row.effortStatus === 'unjudged'));
  const rows = checkAssignments(cfg,catalog()); assert.deepEqual(rows.map((r) => r.agent),AGENTS);
  const expected = [
    ['planner','claude-opus-3','high','absent','unjudged',null,null],
    ['architect','opus',3,'family','unjudged','claude-opus-5',m[0].efforts],
    ['code-reviewer','claude-opus-4-6','xhigh','id','unsupported','claude-opus-4-6',m[7].efforts],
    ['gap-detector','claude-haiku-4-5-20251001','high','id','none','claude-haiku-4-5-20251001',[]],
  ].map(([agent,model,effort,modelStatus,effortStatus,matched,efforts]) => ({agent,model,effort,modelStatus,effortStatus,matched,efforts}));
  assert.deepEqual(rows.filter((r) => expected.some((e) => e.agent === r.agent)),expected);
  assert.equal(checkAssignments(cfg,{ok:true,models:[...m,{...m[0],id:'claude-opus-other'}]})[1].matched,null);
});
test('C9 B6: staleAt 경과는 정보만', () => {
  const {isStale} = load(); const now = 100; assert.equal(isStale(99,now),true); assert.equal(isStale(101,now),false); assert.equal(isStale(null,now),false);
});
test('C10 B6: 최신 fetchedAt, 동률은 파일명 사전순', () => {
  const {pickLatest} = load(); const item = (name,fetchedAt) => ({name,parsed:{fetchedAt}});
  assert.equal(pickLatest([item('b',100),item('a',200)]).name,'a');
  assert.equal(pickLatest([item('b',200),item('a',200)]).name,'a');
  assert.equal(pickLatest([item('b',null),item('a',0)]).name,'a'); assert.equal(pickLatest([]),null);
});
test('C11: 마법사는 main 가족 alias, 나머지 id, 중복 가족과 hidden 처리', () => {
  const {wizardChoices} = load(); const m = models(); const choices = wizardChoices(m);
  assert.deepEqual(choices.primary.map((c) => c.value),m.slice(0,4).map((m) => m.family));
  assert.deepEqual(choices.primary.map((c) => c.label),m.slice(0,4).map((m) => m.name));
  assert.deepEqual(choices.pinned.map((c) => c.value),m.slice(4).map((m) => m.id));
  const duplicate = wizardChoices([...m,{...m[0],id:'claude-opus-other'}]); assert.deepEqual(duplicate.primary.filter((c) => c.family === 'opus').map((c) => c.value), ['claude-opus-5','claude-opus-other']);
  assert.deepEqual(wizardChoices(m.map((m) => ({...m,hidden:true}))),{primary:[],pinned:[]});
});

test('C12 B20: 표시용 필드를 버리지 않는다 — description·notice·effortOptions·recommendedEffort', () => {
  const parsed = load().normalizeClaudeCatalog(FIXTURE);
  assert.deepEqual(parsed.models.map((m) => m.description), ids.map((id) => `desc-${id}`));
  // notice는 일부 모델에만 있다(실제 카탈로그도 11종 중 7종) — 없으면 null이어야 한다.
  assert.deepEqual(parsed.models.map((m) => m.notice), ids.map((id, i) => i < 2 ? `cost-${id}` : null));
  // efforts는 string[] 하위호환을 유지한다(멤버십 판정이 여기 걸려 있다).
  assert.deepEqual(parsed.models[0].efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(parsed.models[0].effortOptions[0], { id: 'low', label: 'Low', recommended: false });
  assert.deepEqual(parsed.models[0].effortOptions.filter((o) => o.recommended).map((o) => o.id), ['high']);
  assert.deepEqual(parsed.models.map((m) => m.recommendedEffort), ids.map((_, i) => i === 3 ? null : 'high'));
  // effort 미지원 모델은 빈 배열이고 권장값도 없다.
  assert.deepEqual(parsed.models[3].effortOptions, []);
});

test('C13 B21: Choice가 설명·비용경고·권장 effort를 전달한다', () => {
  const { wizardChoices } = load();
  const first = wizardChoices(models()).primary[0];
  assert.equal(first.description, `desc-${ids[0]}`);
  assert.equal(first.notice, `cost-${ids[0]}`);
  assert.equal(first.recommendedEffort, 'high');
  assert.deepEqual(first.effortOptions.map((o) => o.label), ['Low', 'Medium', 'High', 'Xhigh', 'Max']);
  // notice가 없는 모델은 null로 온다(있는 척하지 않는다).
  assert.equal(wizardChoices(models()).primary[2].notice, null);
});

test('C14 B20: 표시용 필드가 shape 밖이어도 throw 없이 null·빈 배열로 떨어진다', () => {
  const { normalizeClaudeCatalog } = load();
  const raw = { version: 2, catalog: { config: { models: [
    { id: 'claude-a', description: 3, notice: 'not-an-object', thinking: { type: 'effort', effort_options: [{ id: 'low', name: 7, badge: 'x' }, 'junk', { name: 'no-id' }] } },
  ] } } };
  const model = normalizeClaudeCatalog(raw).models[0];
  assert.equal(model.description, null);
  assert.equal(model.notice, null);
  assert.deepEqual(model.effortOptions, [{ id: 'low', label: null, recommended: false }]);
  assert.deepEqual(model.efforts, ['low']);
  assert.equal(model.recommendedEffort, null);
});

// ── Codex 정규화 (§8.0·§8.1) ───────────────────────────────────
// ⚠ `model-catalog-codex.js`를 **top-level에서 require하지 않는다**(§8.7-1) — 각 테스트가
// 지연 require나 자식 프로세스로 모듈을 연다. 그래야 구현 0줄 상태에서 "무엇이 RED인가"가
// 테스트 단위로 보이고, 기존 C1~C14가 양성 대조로 남는다.
const codexPath = new URL('../hooks/lib/model-catalog-codex.js', import.meta.url).pathname;
const loadCodex = () => require(codexPath);
const CODEX = { fetched_at: '2026-09-30T02:11:04Z', etag: 'W/"x"', client_version: '0.155.1',
  identity: { plan: 'x' },
  models: [
    { slug:'gpt-6-astra', display_name:'GPT-6 Astra', description:'desc-astra', visibility:'list', priority:1,
      default_reasoning_level:'medium',
      supported_reasoning_levels:[{effort:'low',description:'빠름'},{effort:'medium',description:'권장'},
        {effort:'high',description:'깊다'},{effort:'xhigh',description:'더 깊다'},
        {effort:'max',description:'최대'},{effort:'ultra',description:'가장 깊다'}] },
    // 추론 단계가 아예 없는 모델 — effortOptionsOf의 빈 배열 경로를 덮는다(2026-10-01 리뷰 지적).
    { slug:'gpt-plain', display_name:'Plain', description:'desc-plain', visibility:'list' },
    { slug:'gpt-5.5', display_name:'GPT-5.5', description:'desc-55', visibility:'list', priority:7,
      default_reasoning_level:'high',
      supported_reasoning_levels:[{effort:'low'},{effort:'medium'},{effort:'high'},{effort:'xhigh'}] },
    { slug:'gpt-reserve', display_name:'Reserve', visibility:'hide', priority:9,
      default_reasoning_level:'nope', supported_reasoning_levels:[{effort:'low'}] },
  ] };

test('CX1 B1 B2: Codex 캐시가 공통 shape으로 정규화되고 hide는 hidden이 된다', () => {
  const parsed = loadCodex().normalizeCodexCatalog(CODEX);
  assert.deepEqual(parsed.models.map((m) => m.id), ['gpt-6-astra', 'gpt-plain', 'gpt-5.5', 'gpt-reserve']);
  assert.deepEqual(parsed.models.map((m) => m.name), ['GPT-6 Astra', 'Plain', 'GPT-5.5', 'Reserve']);
  // Codex 캐시에 대응 필드가 없는 축은 **만들어 넣지 않는다**(§4.1).
  for (const key of ['family', 'section', 'minVersion', 'notice']) {
    assert.deepEqual(parsed.models.map((m) => m[key]), [null, null, null, null], key);
  }
  assert.deepEqual(parsed.models.map((m) => m.quickSelect), [false, false, false, false]);
  // `ultra`는 Codex 캐시에만 있는 effort다(2026-09-30 실측) — Claude frontmatter 값이 아니다.
  assert.deepEqual(parsed.models[0].efforts, ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  // 추론 단계가 없는 모델은 빈 배열이다 — effortOptionsOf의 조기 반환 경로(2026-10-01 리뷰 지적).
  assert.deepEqual(parsed.models[1].efforts, []);
  assert.deepEqual(parsed.models[1].effortOptions, []);
  assert.equal(parsed.models[1].recommendedEffort, null);
  assert.deepEqual(parsed.models[2].efforts, ['low', 'medium', 'high', 'xhigh']);
  assert.deepEqual(parsed.models.map((m) => m.hidden), [false, false, false, true]);
  assert.deepEqual(parsed.models.map((m) => m.description), ['desc-astra', 'desc-plain', 'desc-55', null]);
  // Codex 전용 축 — 결측은 null이다(0으로 치면 최신보다 위로 올라간다).
  assert.deepEqual(parsed.models.map((m) => m.priority), [1, null, 7, 9]);
  assert.equal(parsed.cli, 'codex');
  assert.equal(parsed.fetchedAt, Date.parse(CODEX.fetched_at));
  // 캐시에 스키마 버전 필드도 만료 시각 필드도 없다(§3.10·O8) — 없는 것을 꾸미지 않는다.
  assert.equal(parsed.staleAt, null);
  assert.equal(parsed.version, null);
});

test('CX2 B3: default_reasoning_level이 recommendedEffort가 되고 목록 밖 값은 null이다', () => {
  const parsed = loadCodex().normalizeCodexCatalog(CODEX);
  const astra = parsed.models[0];
  assert.equal(astra.recommendedEffort, 'medium');
  assert.deepEqual(astra.effortOptions.filter((o) => o.recommended).map((o) => o.id), ['medium']);
  assert.deepEqual(astra.effortOptions[5], { id: 'ultra', label: null, recommended: false, description: '가장 깊다' });
  // `nope`은 efforts 밖이다 — 선택지에 없는 값을 기본 포커스로 두지 않는다(§4.2).
  assert.equal(parsed.models[3].recommendedEffort, null);
  assert.equal(parsed.models[2].recommendedEffort, 'high');
  // 추론 단계가 없는 모델은 권장값도 없다.
  assert.equal(parsed.models[1].recommendedEffort, null);
});

test('CX3 B4: shape 밖 입력은 throw 없이 null, 유효한 빈 배열은 빈 목록이다', () => {
  const { normalizeCodexCatalog } = loadCodex();
  for (const raw of [null, undefined, [], 'x', 3, {}, { models: 'x' }, { models: {} },
    { models: [{ display_name: 'x' }] }, { models: [null] }]) {
    assert.equal(normalizeCodexCatalog(raw), null, JSON.stringify(raw));
  }
  // 부재와 0종은 다르다 — 0종은 "읽었고 비었다"는 사실이다.
  assert.deepEqual(normalizeCodexCatalog({ models: [] }).models, []);
  assert.equal(normalizeCodexCatalog({ models: [] }).fetchedAt, null);
});

test('CX4 R9: codexChoices는 hidden을 빼고 단일 목록을 내며 키 집합이 Choice와 같다', () => {
  const { normalizeCodexCatalog, codexChoices } = loadCodex();
  const codexModels = normalizeCodexCatalog(CODEX).models;
  const choices = codexChoices(codexModels);
  assert.deepEqual(choices.primary.map((c) => c.value), ['gpt-6-astra', 'gpt-5.5', 'gpt-plain']);
  // Codex에는 section·family가 없어 "이전 버전" 묶음이 성립하지 않는다(§3.2·R9).
  assert.deepEqual(choices.pinned, []);
  assert.deepEqual(choices.primary.map((c) => c.id), ['gpt-6-astra', 'gpt-5.5', 'gpt-plain']);
  assert.deepEqual(choices.primary.map((c) => c.label), ['GPT-6 Astra', 'GPT-5.5', 'Plain']);
  // 마법사가 `clis[cli].choices` 하나로 두 CLI를 다루려면 키 집합이 같아야 한다(§3.6).
  const claudeKeys = Object.keys(load().wizardChoices(models()).primary[0]).sort();
  assert.deepEqual(Object.keys(choices.primary[0]).sort(), claudeKeys);
  for (const bad of [null, undefined, 'x', 3, {}, [null], [{ id: 3 }]]) {
    assert.deepEqual(codexChoices(bad), { primary: [], pinned: [] }, JSON.stringify(bad));
  }
  // 정규화를 거치지 않은(혹은 망가진) 모델이 들어와도 throw하지 않고 안전한 기본값으로 떨어진다.
  const odd = codexChoices([{ id: 'x' }, { id: 'y', name: 3, efforts: 'nope', effortOptions: null, description: 7 }]);
  assert.equal(odd.primary.length, 2);
  assert.equal(odd.primary[0].label, 'x', 'name이 없으면 id로 표기한다');
  assert.deepEqual(odd.primary[1].efforts, [], 'efforts가 배열이 아니면 빈 배열이다');
  assert.deepEqual(odd.primary[1].effortOptions, []);
  assert.equal(odd.primary[1].recommendedEffort, null);
  // ⚠ label·description의 **타입 강제는 이 함수의 책임이 아니다.** 입력은 normalizeCodexCatalog의
  // 출력이고 거기서 stringOrNull로 이미 걸러진다 — 여기서 또 막으면 중복 방어가 된다.
  // 계약 밖 값(숫자 등)은 그대로 흐른다. 이 테스트가 고정하는 것은 **throw하지 않는다**는 것이다.
});

test('CX5 B1: fs·child_process·os·path를 모두 봉인한 프로세스에서 두 함수가 동작한다', () => {
  // 이 모듈은 **아무것도 require하지 않는다**(§3.9·§4.2). 헬퍼 3줄을 복제한 대가로 얻은
  // 성질이고, 봉인 테스트가 전이 논증 없이 자명해진다.
  const sealed = ['fs', 'node:fs', 'fs/promises', 'node:fs/promises', 'child_process', 'node:child_process',
    'os', 'node:os', 'path', 'node:path'];
  const probe = `const Module = require('module'); const original = Module.prototype.require;
    Module.prototype.require = function (id) { if (${JSON.stringify(sealed)}.includes(id)) throw new Error('SEALED:' + id); return original.apply(this, arguments); };
    const m = require(${JSON.stringify(codexPath)});
    const parsed = m.normalizeCodexCatalog(${JSON.stringify(CODEX)});
    process.stdout.write(JSON.stringify([parsed.models.length, parsed.models[3].hidden,
      m.codexChoices(parsed.models).primary.length, m.normalizeCodexCatalog('x')]));`;
  const out = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout), [4, true, 3, null]);
});

// ── CX6: priority 정렬 (B7~B11·B18) ─────────────────────────────
// 2026-10-01 실측: Codex priority는 **작을수록 상위**다(gpt-6-astra=2 … gpt-5.5=13).
// 공유 CODEX 픽스처를 건드리지 않고 지역 입력을 쓴다(다른 테스트를 조용히 망치지 않기 위해).
test('CX6 B7 B8 B9 B11 B18: priority 오름차순·결측은 뒤로·동률은 캐시 순서·입력 불변', () => {
  const { codexChoices } = loadCodex();
  const m = (id, extra = {}) => ({ id, name: id, efforts: ['low'], effortOptions: [], hidden: false, ...extra });

  // 1. 오름차순 — 작을수록 앞
  assert.deepEqual(codexChoices([m('c',{priority:13}), m('a',{priority:2}), m('b',{priority:5})])
    .primary.map((c) => c.value), ['a','b','c']);

  // 2. 결측·비정수는 정렬 키가 없다 → 캐시 순서를 지키며 뒤로
  const mixed = [m('x'), m('p',{priority:3}), m('y',{priority:'3'}), m('z',{priority:2.5}), m('q',{priority:1})];
  assert.deepEqual(codexChoices(mixed).primary.map((c) => c.value), ['q','p','x','y','z']);

  // 3. 동률은 캐시 순서 — 사전순이 아니다(안정 정렬이 아니면 뒤집힐 입력)
  assert.deepEqual(codexChoices([m('b',{priority:4}), m('a',{priority:4})])
    .primary.map((c) => c.value), ['b','a']);

  // 4. hidden은 정렬 후에도 없다(가시 항목과 **동률**이어도)
  const withHidden = codexChoices([m('v',{priority:4}), m('h',{priority:4, hidden:true})]);
  assert.equal(withHidden.primary.length, 1);
  assert.equal(withHidden.primary[0].value, 'v');

  // 5. 입력 배열을 변이시키지 않는다(B18) — list-models.mjs가 같은 배열을 models에도 싣는다
  const input = [m('b',{priority:9}), m('a',{priority:1})];
  const before = input.map((x) => x.id);
  const out = codexChoices(input);
  assert.deepEqual(input.map((x) => x.id), before, '입력 배열이 정렬돼 버렸다');
  assert.notEqual(out.primary, input);

  // 6. 비교 함수 분기를 2원소 호출로 결정적으로 밟는다(큰 배열은 V8의 비교 순서를 모른다)
  assert.deepEqual(codexChoices([m('a'), m('b',{priority:1})]).primary.map((c)=>c.value), ['b','a']);
  assert.deepEqual(codexChoices([m('a',{priority:1}), m('b')]).primary.map((c)=>c.value), ['a','b']);
  assert.deepEqual(codexChoices([m('a'), m('b')]).primary.map((c)=>c.value), ['a','b']);

  // 7. efforts는 정렬하지 않는다(B10) — 서열을 발명하지 않는다.
  //    ⚠ 픽스처가 **알파벳순이 아니어야** 알파벳 정렬 돌연변이를 잡는다 — `['high','low']`는
  //    이미 알파벳순이라 `.sort()`를 넣어도 통과했다(2026-10-01 Gap이 돌연변이로 잡았다).
  const kept = codexChoices([m('a',{priority:1, efforts:['medium','low','xhigh']})]).primary[0].efforts;
  assert.deepEqual(kept, ['medium','low','xhigh'], 'efforts를 정렬하면 서열을 발명하는 것이다');
  // effortOptions도 같은 성질이다 — 마법사가 label·recommended를 이 순서로 읽는다.
  const opts = codexChoices([m('a',{priority:1,
    effortOptions:[{id:'medium'},{id:'low'}]})]).primary[0].effortOptions;
  assert.deepEqual(opts.map((o)=>o.id), ['medium','low']);
});
