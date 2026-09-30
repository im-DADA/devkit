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
