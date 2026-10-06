// `/kit setup`이 묻는 **문항 그 자체**의 계약 — 상한·묶음·유도·스키마 수용성.
//
// 설계: docs/2026-10-01-wizard-question-budget/DESIGN.md §1·§3·§4·§8.1
//
// ⚠ 이 파일이 존재하는 이유: 같은 사용자가 **세 번** "설정이 복잡하다"고 말했고, 두 사이클이
// 각각 `commands/kit.md`에 산문으로 처방을 넣었는데 통증이 옮겨 다니기만 했다. 결정적 증거는
// `kit.md`가 `8종을 하나씩 묻지 않는다`라고 **적어 둔 상태에서** 모델이 정확히 8라운드를
// 돌린 것이다(2026-10-01). 마크다운 산문은 이 층을 구속하지 못한다(결함로그 D8·D23·D26).
// 그래서 문항을 **순수 함수의 반환값**으로 옮기고, 상한을 여기서 **실행해서** 센다.
//
// ⚠ 상한 숫자(라운드 1 · 문항 2)는 **이 파일에만** 둔다. 모듈이 budget 상수를 export하고
// 테스트가 그것을 읽으면 자기참조가 되어 상수를 고치는 것만으로 초록이 유지된다(D24 ①).
//
// ⚠ 무검증 층: 이 파일은 "모델이 `--plan`을 실제로 돌리고 그 문항만 묻는가"를 보지 못한다.
// 그 층은 `commands/kit.md`(마크다운)이고 실행할 수 없다. 문서 단언은 model-catalog-io의
// IP6~IP8이 맡고, 그래도 남는 가정은 evals/README.md의 수동 시나리오가 받는다(RULES.md:414).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dir, '..');
const planPath = path.join(root, 'hooks', 'lib', 'setup-plan.js');
const tiersPath = path.join(root, 'hooks', 'lib', 'setup-plan-tiers.js');
const require_ = createRequire(import.meta.url);
const { GROUPS, SCOPES, basePlan, modelPlan, resolveModels } = require_(planPath);
const { AGENTS, DEFAULTS, mergeConfig } = require_(path.join(root, 'hooks', 'lib', 'config-schema.js'));
const { fallbackChoices } = require_(path.join(root, 'hooks', 'lib', 'model-catalog.js'));

// ── 픽스처 ────────────────────────────────────────────────────
/** cli-detect.offerableClis의 출력 모양. `offered`·`forced`를 축으로 4조합을 만든다. */
const mkOffer = (codexOffered, forced = false) => ([
  { cli: 'claude', label: 'Claude Code', status: 'both', offered: true, forced: false, hint: null },
  { cli: 'codex', label: 'Codex', status: codexOffered ? 'both' : 'absent',
    offered: codexOffered, forced, hint: codexOffered ? null : '감지되지 않았다(--cli로 강제 노출)' },
]);
const OFFERS = [mkOffer(true, false), mkOffer(true, true), mkOffer(false, false), mkOffer(false, true)];

/** codexChoices의 출력 모양. 키 집합은 wizardChoices의 Choice와 같다. */
const codexChoice = (id, rec = 'medium', efforts = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']) => ({
  value: id, label: id.toUpperCase(), id, family: null, efforts, minVersion: null,
  description: `${id} 설명`, notice: null,
  effortOptions: efforts.map((e) => ({ id: e, label: e, recommended: e === rec })),
  recommendedEffort: rec, priority: 1, quickSelect: false,
});
const CODEX = { primary: [codexChoice('gpt-6-astra'), codexChoice('gpt-6-sol')], pinned: [] };
const CODEX_EMPTY = { primary: [], pinned: [] };

/** wizardChoices의 출력 모양. alias(value===family)와 id 고정(value!==family)을 둘 다 담는다. */
const claudeChoice = (value, family, minVersion, rec = 'medium') => ({
  value, label: `${value} 라벨`, id: `claude-${family}-5-5`, family,
  efforts: ['low', 'medium', 'high', 'xhigh', 'max'], minVersion,
  description: `${value} 설명`, notice: null,
  effortOptions: ['low', 'medium', 'high', 'xhigh', 'max'].map((e) => ({ id: e, label: e, recommended: e === rec })),
  recommendedEffort: rec,
});
const CLAUDE = {
  primary: [claudeChoice('opus', 'opus', '2.1.251'), claudeChoice('sonnet', 'sonnet', null),
    claudeChoice('haiku', 'haiku', null, null)],
  pinned: [{ ...claudeChoice('claude-opus-5', 'opus', '2.9.9'), value: 'claude-opus-5' }],
};
const META_OK = { status: 'ok', reason: null, fetchedAt: '2026-10-01T09:07:36.074Z', stale: false };
const META_STALE = { ...META_OK, stale: true };
const META_MISSING = { status: 'missing', reason: '카탈로그 파일을 찾지 못했다', fetchedAt: null, stale: false };

const CFGS = [DEFAULTS, mergeConfig({ models: { 'tdd-driver': { cli: 'codex', model: 'gpt-6-astra' } } }).config];
/** offer 4조합 × cfg 2종 = 8회. 상한 단언은 **전부**에서 성립해야 한다. */
const combos = () => OFFERS.flatMap((offer) => CFGS.map((cfg) => ({ offer, cfg })));
const qs = (plan) => plan.rounds[0].questions;
const headers = (plan) => qs(plan).map((q) => q.header);

// ── S1~S4: 상한과 스키마 ──────────────────────────────────────
test('S1 B1: basePlan은 offer 4조합과 cfg 2종 전부에서 1라운드 2문항을 넘지 않는다', () => {
  for (const { offer, cfg } of combos()) {
    const plan = basePlan({ offer, codexChoices: CODEX, cfg });
    const where = JSON.stringify(headers(plan));
    assert.equal(plan.rounds.length, 1, `라운드가 1개가 아니다 ${where}`);
    assert.ok(qs(plan).length >= 1 && qs(plan).length <= 2, `문항 수가 1~2가 아니다 ${where}`);
  }
});

test('S2 B2: Codex가 offer에 없으면 구현 CLI 문항이 사라지고 문항이 1개다', () => {
  for (const cfg of CFGS) {
    const plan = basePlan({ offer: mkOffer(false), codexChoices: CODEX, cfg });
    assert.equal(qs(plan).length, 1);
    assert.equal(qs(plan)[0].header, '설정 범위');
    assert.equal(Object.keys(plan.rounds[0].map).length, 1, 'map에 없는 문항의 매핑이 남아 있다');
    assert.ok(plan.notes.some((n) => /감지되지 않았다/.test(n)), '사라진 사유가 notes에 없다');
    // ⚠ 옛 단언은 `k.endsWith('|codex')`였다. 키가 `…|codex:<id>`가 되면서 그 필터는
    //    **항상 빈 배열**이 되어 초록인 채 죽는다(D24). 닫힌 집합 등식으로 격상한다.
    assert.deepEqual(Object.keys(plan.patches).sort(), SCOPES.map((sc) => `${sc}|claude`).sort());
  }
});

test('S3 B3: offer에 Codex가 있어도 primary가 비면 문항을 내지 않고 사유를 notes에 싣는다', () => {
  const plan = basePlan({ offer: mkOffer(true), codexChoices: CODEX_EMPTY, cfg: DEFAULTS });
  assert.equal(qs(plan).length, 1, 'Codex 모델이 하나도 없는데 CLI를 물었다');
  assert.ok(plan.notes.some((n) => /목록/.test(n)), '사유가 notes에 없다');
  // AskUserQuestion은 options minItems 2다 — 선택지 1개짜리 문항은 **스키마가 거부한다**(DESIGN §0).
  assert.ok(qs(plan).every((q) => q.options.length >= 2));
  // #1과 같은 이유로 닫힌 집합 등식이다.
  assert.deepEqual(Object.keys(plan.patches).sort(), SCOPES.map((sc) => `${sc}|claude`).sort());
});

test('S4 B4: 모든 문항이 AskUserQuestion 제약과 키 집합을 지킨다', () => {
  for (const { offer, cfg } of combos()) {
    const plan = basePlan({ offer, codexChoices: CODEX, cfg });
    const seenHeaders = new Set();
    for (const q of qs(plan)) {
      // 문항·옵션 객체는 additionalProperties:false다 — 키를 더하면 도구가 거부한다(DESIGN §0).
      assert.deepEqual(Object.keys(q).sort(), ['header', 'multiSelect', 'options', 'question']);
      assert.equal(typeof q.question, 'string');
      assert.notEqual(q.question, '');
      assert.equal(q.multiSelect, false, 'multiSelect는 required라 생략하지 않는다');
      // 12자는 스키마가 아니라 UI 규약이다 — 기계로 지키는 자리가 여기뿐이다(DESIGN §0).
      assert.ok([...q.header].length <= 12, `header가 12자를 넘는다: ${q.header}`);
      assert.ok(!seenHeaders.has(q.header), `header가 중복이다: ${q.header}`);
      seenHeaders.add(q.header);
      assert.ok(q.options.length >= 2 && q.options.length <= 4, `선택지 수가 2~4가 아니다: ${q.header}`);
      const labels = new Set();
      for (const opt of q.options) {
        assert.deepEqual(Object.keys(opt).sort(), ['description', 'label']);
        assert.notEqual(opt.label, '');
        assert.notEqual(opt.description, '', `${q.header}/${opt.label}의 설명이 비었다`);
        assert.ok(!labels.has(opt.label), `label이 중복이다: ${opt.label}`);
        labels.add(opt.label);
      }
      // map은 AskUserQuestion에 넘기지 않는다 — 넘기면 추가 키로 거부된다.
      assert.deepEqual(Object.keys(plan.rounds[0].map[q.header]).sort(),
        q.options.map((o) => o.label).sort(), `${q.header}의 map이 선택지와 어긋난다`);
    }
  }
});

// ── S5~S6: 묶음 ───────────────────────────────────────────────
test('S5 B5: GROUPS 두 묶음의 합집합이 AGENTS와 정확히 같다', () => {
  assert.equal(GROUPS.writesFiles.length, 3);
  assert.deepEqual([...GROUPS.writesFiles, ...GROUPS.returnsBody].sort(), [...AGENTS].sort());
  assert.deepEqual(GROUPS.writesFiles.filter((a) => GROUPS.returnsBody.includes(a)), []);
  // 묶음 경계를 **열거가 아니라 근거에서** 유도해 대조한다 — 누가 에이전트의 계약을 바꾸면
  // 빨개진다. 실측(2026-10-01): 반환형 5종은 전부 '반환'을 적고, 파일을 쓰는 3종은 0건이다.
  const base = path.join(root, 'agents');
  const body = fs.readdirSync(base).filter((f) => f.endsWith('.md'))
    .filter((f) => /반환/.test(fs.readFileSync(path.join(base, f), 'utf8')))
    .map((f) => f.replace(/\.md$/, ''));
  assert.deepEqual([...GROUPS.returnsBody].sort(), body.sort(),
    '본문 반환형 묶음이 agents/*.md의 계약과 어긋난다');
});

test('S6 B6: 본문을 반환하는 5종은 어느 경로에서도 Codex 선택지에 없다', () => {
  const plan = basePlan({ offer: mkOffer(true), codexChoices: CODEX, cfg: DEFAULTS });
  const asked = JSON.stringify(plan.rounds);
  for (const agent of GROUPS.returnsBody) assert.ok(!asked.includes(agent), `${agent}가 문항에 있다`);
  assert.ok(asked.includes('본문을 반환'), 'Codex 제외 사유가 문항에 실리지 않았다');
  for (const agent of GROUPS.returnsBody) {
    const one = modelPlan({ agent, cli: null, choices: CODEX, meta: META_OK, ccVersion: '2.1.286' });
    assert.equal(one.rounds.length, 0, `${agent}에 CLI를 물었다`);
    assert.ok(one.notes.some((n) => /본문을 반환/.test(n)), `${agent}의 사유가 없다`);
  }
  for (const agent of GROUPS.writesFiles) {
    assert.equal(modelPlan({ agent, cli: null, choices: CODEX, meta: META_OK, ccVersion: null }).rounds.length, 1);
  }
});

// ── S7~S9: 유도 ───────────────────────────────────────────────
test('S7 B7: Claude로 남는 단계의 effort가 DEFAULTS와 같다', () => {
  for (const { offer, cfg } of combos()) {
    const plan = basePlan({ offer, codexChoices: CODEX, cfg });
    for (const [key, entry] of Object.entries(plan.patches)) {
      const merged = mergeConfig({ ...entry.patch }).config;
      for (const agent of AGENTS) {
        if (merged.models[agent].cli !== 'claude') continue;
        assert.equal(merged.models[agent].effort, DEFAULTS.models[agent].effort,
          `${key}에서 ${agent}의 effort가 바뀌었다`);
      }
      assert.equal(merged.models.planner.effort, 'max', `${key}에서 planner의 max가 내려갔다`);
    }
  }
  // ⚠ 위 단언만으로는 **공허하다** — 마법사는 Claude 단계를 patch에 아예 쓰지 않으므로(최소 diff)
  //    merged는 언제나 DEFAULTS와 같다. 2026-10-02 돌연변이 ③(Claude에 recommendedEffort를 덮기)이
  //    위를 그대로 통과했다. 진짜 위험은 `setup models`가 사용자에게 **보고하고 적용할 유도값**이므로
  //    그 값을 modelPlan의 notes에서 직접 본다. 픽스처의 권장값(medium)과 DEFAULTS가 **달라야**
  //    돌연변이가 드러난다 — planner는 max, architect도 max다.
  for (const agent of ['planner', 'architect', 'code-reviewer']) {
    const notes = modelPlan({ agent, cli: 'claude', choices: CLAUDE, meta: META_OK, ccVersion: '2.1.286' }).notes;
    const derived = notes.find((n) => n.startsWith('effort는 묻지 않는다'));
    assert.ok(derived, `${agent}의 유도 effort가 보고되지 않았다`);
    assert.ok(derived.includes(DEFAULTS.models[agent].effort),
      `${agent}의 유도값이 DEFAULTS(${DEFAULTS.models[agent].effort})가 아니다: ${derived}`);
    assert.notEqual(DEFAULTS.models[agent].effort, CLAUDE.primary[0].recommendedEffort,
      `${agent}의 기본 effort가 픽스처 권장값과 같아 이 단언이 돌연변이를 못 잡는다`);
  }
});

test('S8 B8: Codex로 옮긴 단계는 primary[0].id와 그 모델의 recommendedEffort를 받는다', () => {
  const plan = basePlan({ offer: mkOffer(true), codexChoices: CODEX, cfg: DEFAULTS });
  // 키가 모델별로 갈렸다 — **두 선택지가 서로 다른 모델로 번역된다**(B1)를 여기서도 본다.
  for (const [id, effort] of [['gpt-6-astra', 'medium'], ['gpt-6-sol', 'medium']]) {
    const models = plan.patches[`default|codex:${id}`].patch.models;
    assert.deepEqual(Object.keys(models).sort(), [...GROUPS.writesFiles].sort());
    for (const entry of Object.values(models)) assert.deepEqual(entry, { cli: 'codex', model: id, effort });
  }
  // recommendedEffort가 null이면 **effort 키를 싣지 않는다** — 모르는 값을 고른 척하지 않는다.
  const noRec = { primary: [codexChoice('gpt-plain', null, [])], pinned: [] };
  const bare = basePlan({ offer: mkOffer(true), codexChoices: noRec, cfg: DEFAULTS });
  const bareModels = bare.patches['default|codex:gpt-plain'].patch.models;
  for (const [agent, entry] of Object.entries(bareModels)) {
    assert.equal('effort' in entry, false, `${agent}에 모르는 effort를 지어냈다`);
    assert.equal(mergeConfig(bare.patches['default|codex:gpt-plain'].patch).config.models[agent].effort,
      DEFAULTS.models[agent].effort);
  }
  assert.ok(bare.patches['default|codex:gpt-plain'].notes.some((n) => /effort를 쓰지 않는다/.test(n)));
});

test('S9 B9: resolveModels는 codex 단계에 Claude 폴백 모델명을 절대 쓰지 않는다', () => {
  const banned = fallbackChoices().models;
  assert.ok(banned.length >= 2, '폴백 목록이 비면 이 테스트가 아무것도 막지 못한다');
  for (const choices of [null, CODEX_EMPTY, { primary: [{ ...codexChoice('x'), id: '', value: '' }], pinned: [] }]) {
    const { patch } = resolveModels({ scope: 'default', codexModel: null, choices, cfg: DEFAULTS });
    assert.equal('models' in patch, false, '쓸 모델이 없는데 models 패치를 만들었다');
  }
  // ⚠ **양성 대조** — `useCodexForBuild` → `codexModel` 개명으로 codex 분기에 영원히 안 들어가면
  //    위 단언이 자동 통과한다(공허해진다, D24). 유효 id를 주면 반드시 들어간다는 것을 못박는다.
  const live = resolveModels({ scope: 'default', codexModel: 'gpt-6-astra', choices: CODEX, cfg: DEFAULTS });
  assert.equal('models' in live.patch, true, 'codex 분기에 들어가지 못했다 — 위 단언이 공허하다');
  // 거부 목록: inherit · Claude 폴백 이름 · claude- 접두 · 공백 — 전부 models를 만들지 않는다.
  for (const bad of ['inherit', 'opus', 'sonnet', 'claude-opus-5', 'two words', '', null]) {
    assert.equal('models' in resolveModels({ scope: 'default', codexModel: bad, choices: CODEX, cfg: DEFAULTS }).patch,
      false, `${JSON.stringify(bad)}가 Codex 모델로 통과했다`);
  }
  for (const { offer, cfg } of combos()) {
    for (const [key, entry] of Object.entries(basePlan({ offer, codexChoices: CODEX, cfg }).patches)) {
      const build = key.split('|')[1];
      for (const m of Object.values(entry.patch.models ?? {})) {
        if (m.cli !== 'codex') continue;
        assert.ok(!banned.includes(m.model), `codex 단계에 ${m.model}을 넣었다`);
        // 키와 값이 어긋나면 커맨드가 A를 고르고 B가 저장된다.
        assert.equal(`codex:${m.model}`, build, `${key}의 키와 엔트리 모델이 다르다`);
      }
    }
  }
});

// ── S10~S11: 스키마 수용성과 빈 패치 ──────────────────────────
test('S10 B10: 마법사가 만드는 모든 patch를 mergeConfig가 받아들인다', () => {
  for (const { offer, cfg } of combos()) {
    for (const [key, entry] of Object.entries(basePlan({ offer, codexChoices: CODEX, cfg }).patches)) {
      const { problems } = mergeConfig({ ...entry.patch });
      assert.deepEqual(problems, [], `${key}의 patch가 스키마 밖이다: ${JSON.stringify(problems)}`);
      assert.equal('_appliedAt' in entry.patch, false, `${key}가 _appliedAt을 patch에 넣었다`);
      assert.equal('version' in entry.patch, false, `${key}가 version을 patch에 넣었다`);
    }
  }
});

test('S11 B11: 아무것도 바꾸지 않는 답이면 patch가 빈 객체다', () => {
  const plan = basePlan({ offer: mkOffer(true), codexChoices: CODEX, cfg: DEFAULTS });
  assert.deepEqual(plan.patches['default|claude'].patch, {});
  assert.equal(JSON.stringify({ version: 1, ...plan.patches['default|claude'].patch }), '{"version":1}');
  // 손으로 적은 codex 설정을 마법사가 조용히 삼키면 안 된다.
  const withCodex = basePlan({ offer: mkOffer(true), codexChoices: CODEX, cfg: CFGS[1] });
  assert.deepEqual(withCodex.patches['default|claude'].patch, {});
  assert.ok(withCodex.patches['default|claude'].notes.some((n) => /되돌리지 않는다/.test(n)));
});

// ── S12: 순수성 ───────────────────────────────────────────────
test('S12 B12: setup-plan은 fs 봉인 프로세스에서 돌고 어떤 입력에도 throw하지 않는다', () => {
  const probe = `
    const Module = require('module');
    const orig = Module.prototype.require;
    const SEALED = ['fs','node:fs','node:fs/promises','os','node:os','path','node:path',
                    'child_process','node:child_process','node:url'];
    Module.prototype.require = function (id) {
      if (SEALED.includes(id)) throw new Error('IO_TOUCHED:' + id);
      return orig.apply(this, arguments);
    };
    const { basePlan, modelPlan, resolveModels, acceptCodexModel } = require(${JSON.stringify(planPath)});
    const { stagesPlan } = require(${JSON.stringify(tiersPath)});
    const NOISE = [null, undefined, 3, 'x', [], {}, {primary:'x'}, [{id:3}],
                   {primary:[{}]}, {primary:[null]}, NaN, {primary:[{value:1,family:1}]}];
    // ⚠ Object.prototype의 키 이름을 **반드시** 넣는다 — 룩업 테이블이 프로토타입 체인을 타면
    //    'toString'은 함수를 찾아 patch가 문자열이 되고 'valueOf'는 throw한다(2026-10-02 리뷰 🔴3).
    const SCOPES_NOISE = ['toString','valueOf','hasOwnProperty','constructor','__proto__'];
    let n = 0;
    for (const v of NOISE) {
      const a = basePlan({ offer: v, codexChoices: v, cfg: v });
      if (!Array.isArray(a.rounds)) throw new Error('rounds가 배열이 아니다');
      const b = modelPlan({ agent: v, cli: v, choices: v, meta: v, ccVersion: v });
      if (!Array.isArray(b.rounds)) throw new Error('modelPlan.rounds가 배열이 아니다');
      const c = resolveModels({ scope: v, codexModel: v, choices: v, cfg: v });
      if (typeof c.patch !== 'object' || c.patch === null) throw new Error('patch가 객체가 아니다');
      n += 1;
    }
    for (const scope of SCOPES_NOISE) {
      const r = resolveModels({ scope, codexModel: 'gpt-6-astra', choices: null, cfg: null });
      if (typeof r.patch !== 'object' || r.patch === null) throw new Error('patch가 객체가 아니다: ' + scope);
      if (Array.isArray(r.patch)) throw new Error('patch가 배열이다: ' + scope);
      n += 1;
    }
    // tiers도 같은 probe 안에서 돈다 — 모듈이 하나라도 봉인 밖이면 순수성 보증이 반쪽이다.
    for (const v of NOISE) {
      const sp = stagesPlan({ offer: v, byCli: v, ccVersion: v, customModel: v });
      if (!Array.isArray(sp.rounds) || !Array.isArray(sp.tiers)) throw new Error('stagesPlan 결과가 배열이 아니다');
      n += 1;
    }
    for (const bad of SCOPES_NOISE) {
      if (acceptCodexModel(bad) === undefined) throw new Error('acceptCodexModel이 undefined를 냈다');
      const sp = stagesPlan({ offer: [], byCli: { codex: { choices: { primary: [] } } }, ccVersion: null, customModel: bad });
      if (typeof sp.byCli !== 'object') throw new Error('byCli가 객체가 아니다');
      n += 1;
    }
    // codexModel에도 프로토타입 체인 키를 넣는다 — findChoice가 키 룩업이면 여기서 터진다.
    for (const bad of SCOPES_NOISE) {
      const r = resolveModels({ scope: 'default', codexModel: bad, choices: { primary: [] }, cfg: null });
      if (typeof r.patch !== 'object' || r.patch === null) throw new Error('patch가 객체가 아니다: ' + bad);
      n += 1;
    }
    process.stdout.write(String(n));
  `;
  assert.equal(execFileSync('node', ['-e', probe], { encoding: 'utf8' }), '39');
});

// ── S13~S14: 문서에서 이전된 앵커 (DESIGN §5 A1·A3~A6·B2·D1) ──
// 옛 `문서 D1`·`DOC6`이 kit.md의 **키워드 존재**로 보던 것을 여기서 **동작**으로 본다.
test('S13: modelPlan이 CLI를 섞지 않고 fetchedAt/stale/notice 분기를 낸다', () => {
  const cc = '2.1.286';
  const claude = modelPlan({ agent: 'tdd-driver', cli: 'claude', choices: CLAUDE, meta: META_OK, ccVersion: cc });
  const codex = modelPlan({ agent: 'tdd-driver', cli: 'codex', choices: CODEX, meta: META_OK, ccVersion: cc });

  // A1 — 선택지가 primary에서 온다(상위 3종 + 직접 적기).
  const opts = claude.rounds[0].questions[0].options;
  assert.equal(opts.length, 4);
  assert.deepEqual(opts.slice(0, 3).map((o) => o.label), CLAUDE.primary.slice(0, 3).map((c) => c.label));
  assert.ok(/직접 적는다/.test(opts[3].label));

  // A6 — 두 CLI의 모델을 한 목록에 섞지 않는다.
  assert.ok(!JSON.stringify(codex.rounds).includes('claude-'), 'Codex 문항에 Claude id가 샜다');
  assert.ok(!JSON.stringify(claude.rounds).includes('gpt-'), 'Claude 문항에 Codex id가 샜다');

  // A5 — Claude 경로에는 ultra가 나타나지 않는다(설정은 받지만 frontmatter가 거부한다).
  assert.ok(!JSON.stringify(claude).includes('ultra'));

  // A4 — fetchedAt은 항상, "낡았을 수 있다"는 stale일 때만(양성·음성 대조).
  assert.ok(claude.notes.some((n) => n.includes(META_OK.fetchedAt)), 'fetchedAt이 notes에 없다');
  assert.ok(!claude.notes.some((n) => /낡았을 수 있다/.test(n)));
  const stale = modelPlan({ agent: 'tdd-driver', cli: 'claude', choices: CLAUDE, meta: META_STALE, ccVersion: cc });
  assert.ok(stale.notes.some((n) => /낡았을 수 있다/.test(n)));

  // A3 — 목록을 못 얻으면 문항 0개 + reason 한 줄. 빈 선택지 문항을 만들지 않는다.
  const missing = modelPlan({ agent: 'tdd-driver', cli: 'claude', choices: CODEX_EMPTY, meta: META_MISSING, ccVersion: cc });
  assert.equal(missing.rounds.length, 0);
  assert.ok(missing.notes.some((n) => n.includes(META_MISSING.reason)));

  // D1 — alias는 동작하므로 차단 경고를 붙이지 않고, id 고정에만 붙인다.
  const byLabel = (p, v) => p.rounds[0].questions[0].options.find((o) => o.label.startsWith(v));
  const alias = byLabel(claude, 'opus');
  assert.ok(!/claude update/.test(alias.description), 'alias에 불필요한 업데이트 안내를 붙였다');
  assert.ok(/최신 세대/.test(alias.description), 'alias의 minVersion 정보가 사라졌다');
  const pinnedOnly = { primary: [{ ...CLAUDE.pinned[0] }], pinned: [] };
  const pinned = modelPlan({ agent: 'tdd-driver', cli: 'claude', choices: pinnedOnly, meta: META_OK, ccVersion: cc });
  assert.ok(/claude update/.test(pinned.rounds[0].questions[0].options[0].description),
    'id 고정에 차단 경고가 없다');
  // 미달이어도 **선택지에서 빼지 않는다**(개수 보존).
  assert.equal(claude.rounds[0].questions[0].options.length, 4);
});

test('S15: 라벨이 겹쳐도 map이 선택지를 하나도 잃지 않고 notice와 권장값이 실린다', () => {
  // 🔴 2026-10-02 리뷰: `A`·`A (2)`·`A`가 오면 두 번째와 세 번째가 **같은 label**이 돼
  // map 키가 하나 줄고, 사용자의 답이 다른 모델로 번역됐다. 선택지 수 = 맵 키 수가 계약이다.
  const dup = (label, value, notice = null) => ({ ...codexChoice(value), label, value, id: value, notice });
  const plan = modelPlan({ agent: 'tdd-driver', cli: 'codex', meta: META_OK, ccVersion: null,
    choices: { primary: [dup('A', '1'), dup('A (2)', '9'), dup('A', '2', '비용이 빨리 는다')], pinned: [] } });
  const q = plan.rounds[0].questions[0];
  const map = plan.rounds[0].map['모델'];
  assert.equal(new Set(q.options.map((o) => o.label)).size, q.options.length, 'label이 겹친다');
  assert.equal(Object.keys(map).length, q.options.length, '선택지 하나가 map에서 사라졌다');
  assert.deepEqual([...new Set(Object.values(map))].sort(), ['1', '2', '9', 'other'].sort(),
    '서로 다른 선택지가 같은 값으로 번역된다');
  // 🟡 notice와 권장 effort가 선택지 설명에 실린다 — 옛 문서 앵커의 진짜 이전처다.
  const third = q.options.find((o) => map[o.label] === '2');
  assert.match(third.description, /비용이 빨리 는다/, 'notice가 선택지에서 사라졌다');
  assert.match(third.description, /권장 effort medium/, '권장값이 선택지에서 사라졌다');
});

test('S16: modelPlan의 문항도 AskUserQuestion 제약을 지킨다', () => {
  // 🟡 S4는 basePlan만 덮었다 — 같은 도구에 들어가는 modelPlan 문항은 무검증이었다.
  for (const [cli, choices] of [[null, CLAUDE], ['claude', CLAUDE], ['codex', CODEX]]) {
    for (const q of modelPlan({ agent: 'tdd-driver', cli, choices, meta: META_OK, ccVersion: '2.1.286' })
      .rounds.flatMap((r) => r.questions)) {
      assert.deepEqual(Object.keys(q).sort(), ['header', 'multiSelect', 'options', 'question']);
      assert.ok([...q.header].length <= 12, `header가 12자를 넘는다: ${q.header}`);
      assert.ok(q.options.length >= 2 && q.options.length <= 4, `선택지 수가 2~4가 아니다: ${q.header}`);
      for (const opt of q.options) {
        assert.deepEqual(Object.keys(opt).sort(), ['description', 'label']);
        assert.notEqual(opt.label, '', `${cli}의 label이 비었다`);
        assert.notEqual(opt.description, '', `${cli}/${opt.label}의 설명이 비었다`);
      }
    }
  }
});

test('S14: modelPlan은 effort 문항을 만들지 않고 두 호출 합이 2라운드를 넘지 않는다', () => {
  for (const cli of [null, 'claude', 'codex']) {
    const plan = modelPlan({ agent: 'tdd-driver', cli, choices: cli === 'codex' ? CODEX : CLAUDE,
      meta: META_OK, ccVersion: '2.1.286' });
    assert.ok(plan.rounds.length <= 1, `${cli}에서 라운드가 2개 이상이다`);
    for (const q of plan.rounds.flatMap((r) => r.questions)) {
      assert.doesNotMatch(q.header, /effort/i, `effort 문항이 살아 있다: ${q.header}`);
      assert.doesNotMatch(q.question, /effort/i);
    }
  }
  const a = modelPlan({ agent: 'tdd-driver', cli: null, choices: CODEX, meta: META_OK, ccVersion: null });
  const b = modelPlan({ agent: 'tdd-driver', cli: 'codex', choices: CODEX, meta: META_OK, ccVersion: null });
  assert.ok(a.rounds.length + b.rounds.length <= 2, '한 단계를 바꾸는 데 3라운드가 든다');
});

// ── S17~S26: 모델별 선택지·묶음·적용 데이터 (B1·B3·B5·B8~B11·B14·B15·B22) ──
// 설계: docs/2026-10-02-role-model-choice-ux/DESIGN.md §1·§5·§7·§8.1
const { TIERS, stagesPlan } = require_(path.join(root, 'hooks', 'lib', 'setup-plan-tiers.js'));
const { acceptCodexModel, applyFor } = require_(path.join(root, 'hooks', 'lib', 'setup-plan-model.js'));
const byCliOf = (claude = CLAUDE, codex = CODEX) => ({
  claude: claude && { choices: claude, meta: META_OK }, codex: codex && { choices: codex, meta: META_OK } });

test('S17 B1: 두 번째 문항이 Codex 모델 2종을 독립 선택지로 내고 서로 다른 id로 번역한다', () => {
  const plan = basePlan({ offer: mkOffer(true), codexChoices: CODEX, cfg: DEFAULTS });
  const q = qs(plan)[1];
  assert.equal(q.options.length, 4, 'Claude 1 + 모델 2 + 그 외 1이어야 한다');
  const map = plan.rounds[0].map[q.header];
  assert.deepEqual([...new Set(Object.values(map))].sort(),
    ['claude', 'codex:gpt-6-astra', 'codex:gpt-6-sol', 'other'].sort());
  // ⚠ 닫힌 집합 — `other`를 뺀 **모든** map 값이 patches의 키에 존재해야 한다.
  //    선택지와 키가 같은 게이트를 지난다는 불변식이고, 어긋나면 사용자가 고른 칸이 undefined가 된다.
  for (const v of Object.values(map)) {
    if (v === 'other') continue;
    assert.ok(`default|${v}` in plan.patches, `map 값 ${v}에 대응하는 patch 키가 없다`);
  }
  assert.equal(plan.patches['default|codex:gpt-6-astra'].patch.models['tdd-driver'].model, 'gpt-6-astra');
  assert.equal(plan.patches['default|codex:gpt-6-sol'].patch.models['tdd-driver'].model, 'gpt-6-sol');
  // custom은 **선택지를 늘리지 않는다** — 5칸이 되면 스키마가 문항을 거부한다.
  const withCustom = basePlan({ offer: mkOffer(true), codexChoices: CODEX, cfg: DEFAULTS, customModel: 'gpt-x' });
  assert.equal(qs(withCustom)[1].options.length, 4, 'custom이 선택지를 늘렸다');
});

test('S18 B3: primary 수에 따라 선택지가 3개 또는 4개이고 비면 문항이 없다', () => {
  const one = { primary: [codexChoice('only-one')], pinned: [] };
  assert.equal(qs(basePlan({ offer: mkOffer(true), codexChoices: one, cfg: DEFAULTS }))[1].options.length, 3);
  const three = { primary: ['a', 'b', 'c'].map((n) => codexChoice(n)), pinned: [] };
  assert.equal(qs(basePlan({ offer: mkOffer(true), codexChoices: three, cfg: DEFAULTS }))[1].options.length, 4);
  const none = basePlan({ offer: mkOffer(true), codexChoices: CODEX_EMPTY, cfg: DEFAULTS });
  assert.equal(qs(none).length, 1);
  assert.ok(none.notes.length >= 1);
  // id와 value가 둘 다 빈 Choice는 선택지에서도 키에서도 함께 빠진다(같은 게이트).
  const broken = { primary: [{ ...codexChoice('x'), id: '', value: '' }, codexChoice('good')], pinned: [] };
  const bp = basePlan({ offer: mkOffer(true), codexChoices: broken, cfg: DEFAULTS });
  assert.equal(qs(bp)[1].options.length, 3, '쓸 수 없는 Choice가 선택지에 남았다');
  assert.deepEqual(Object.keys(bp.patches).filter((k) => k.includes('codex:')).map((k) => k.split('|')[1]).sort(),
    SCOPES.map(() => 'codex:good').sort());
});

test('S19 B5: Codex 선택지가 카탈로그 설명과 권장 effort를 싣고 순서가 서열이 아님을 문항에 적는다', () => {
  const plan = basePlan({ offer: mkOffer(true), codexChoices: CODEX, cfg: DEFAULTS });
  const q = qs(plan)[1];
  const map = plan.rounds[0].map[q.header];
  for (const opt of q.options) {
    const v = map[opt.label];
    if (!String(v).startsWith('codex:')) continue;
    const id = String(v).slice('codex:'.length);
    const src = CODEX.primary.find((c) => c.id === id);
    assert.ok(opt.description.includes(src.description), `${id}의 카탈로그 설명이 빠졌다`);
    assert.ok(opt.description.includes(`권장 effort ${src.recommendedEffort}`), `${id}의 권장 effort가 빠졌다`);
  }
  // 설명이 없는 모델은 id로 대체된다(빈 설명을 만들지 않는다).
  const noDesc = { primary: [{ ...codexChoice('bare'), description: null }], pinned: [] };
  const bare = qs(basePlan({ offer: mkOffer(true), codexChoices: noDesc, cfg: DEFAULTS }))[1];
  assert.ok(bare.options[1].description.includes('bare'));
  // 사용자가 **항상 보는 자리**(질문문)에 서열이 아님을 적는다. notes에도 한 번 더.
  assert.match(q.question, /품질 서열/);
  assert.ok(plan.patches['default|codex:gpt-6-astra'].notes.some((n) => /품질 서열/.test(n)));
});

test('S20 B8: setup models가 라운드 1에 단계와 실행 CLI를 담고 합 2라운드를 넘지 않는다', () => {
  const sp = stagesPlan({ offer: mkOffer(true), byCli: byCliOf(), ccVersion: '2.1.287', customModel: null });
  assert.equal(sp.rounds.length, 1);
  const r1 = sp.rounds[0];
  assert.deepEqual(r1.questions.map((q) => q.header), ['단계', '실행 CLI']);
  const seen = new Set();
  for (const q of r1.questions) {
    assert.deepEqual(Object.keys(q).sort(), ['header', 'multiSelect', 'options', 'question']);
    assert.ok([...q.header].length <= 12);
    assert.ok(!seen.has(q.header)); seen.add(q.header);
    assert.ok(q.options.length >= 2 && q.options.length <= 4, `${q.header}의 선택지가 2~4가 아니다`);
    assert.equal(q.multiSelect, q.header === '단계', '단계 문항만 multiSelect여야 한다');
    for (const o of q.options) assert.deepEqual(Object.keys(o).sort(), ['description', 'label']);
  }
  for (const cli of ['claude', 'codex']) {
    assert.ok(sp.byCli[cli].rounds.length <= 1);
    // ⚠ 라운드 2도 **같은 도구에 그대로 들어간다** — 키 집합을 안 보면 `question` 누락 같은
    //    결함이 초록 뒤에 숨는다(2026-10-02 Gap이 실제로 잡았다. `question`은 required다).
    for (const q of sp.byCli[cli].rounds.flatMap((r) => r.questions)) {
      assert.deepEqual(Object.keys(q).sort(), ['header', 'multiSelect', 'options', 'question']);
      assert.equal(typeof q.question, 'string');
      assert.notEqual(q.question, '');
      assert.ok([...q.header].length <= 12);
      assert.ok(q.options.length >= 2 && q.options.length <= 4);
      for (const o of q.options) {
        assert.deepEqual(Object.keys(o).sort(), ['description', 'label']);
        assert.notEqual(o.label, ''); assert.notEqual(o.description, '');
      }
    }
  }
  assert.ok(sp.rounds.length + Math.max(sp.byCli.claude.rounds.length, sp.byCli.codex.rounds.length) <= 2);
  // Codex가 없으면 실행 CLI 문항이 사라진다(선택지 1개짜리 문항을 만들지 않는다).
  const noCodex = stagesPlan({ offer: mkOffer(false), byCli: byCliOf(CLAUDE, null), ccVersion: null, customModel: null });
  assert.deepEqual(noCodex.rounds[0].questions.map((q) => q.header), ['단계']);
  assert.equal(noCodex.byCli.codex, null);
  assert.ok(noCodex.notes.some((n) => /codex/.test(n)), 'codex를 못 쓰는 사유가 없다');
});

test('S29 B8: 모델이 많아도 라운드 2의 선택지가 4칸을 넘지 않는다', () => {
  // 🔴 모든 픽스처가 3종 이하라 `options.length <= 4` 단언이 **경계에 한 번도 안 닿았다**
  //    — `slice(0,3)`을 `slice(0,4)`로 바꿔도 전 파일이 초록이었다(2026-10-02 Gap 2회차).
  //    5칸 문항이 나가면 AskUserQuestion이 거부한다.
  const many = { primary: ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => codexChoice(n)), pinned: [] };
  const sp = stagesPlan({ offer: mkOffer(true), byCli: byCliOf(many, many), ccVersion: null, customModel: null });
  for (const cli of ['claude', 'codex']) {
    const q = sp.byCli[cli].rounds[0].questions[0];
    assert.equal(q.options.length, 4, `${cli}의 선택지가 4칸이 아니다`);
    assert.equal(Object.keys(sp.byCli[cli].rounds[0].map['모델']).length, 4);
  }
  // 첫 번째 문항(basePlan)도 같은 경계를 지킨다.
  assert.equal(qs(basePlan({ offer: mkOffer(true), codexChoices: many, cfg: DEFAULTS }))[1].options.length, 4);
  // modelPlan 경로도 마찬가지다.
  assert.equal(modelPlan({ agent: 'tdd-driver', cli: 'codex', choices: many, meta: META_OK, ccVersion: null })
    .rounds[0].questions[0].options.length, 4);
});

test('S31: stagesPlan의 custom 경로도 인덱스형 id에 엉뚱한 effort를 붙이지 않는다', () => {
  // S28이 `findChoice`만 핀했다 — `modelOptions`의 `choiceOf`도 같은 위험이 있다(Gap 2회차 잔여).
  const only = { primary: [{ ...codexChoice('astra'), recommendedEffort: 'medium' }], pinned: [] };
  const sp = stagesPlan({ offer: mkOffer(true), byCli: byCliOf(only, only), ccVersion: null, customModel: '0' });
  assert.ok('0' in sp.byCli.codex.apply, 'custom id가 apply에 없다 — ?? {}로 넘어가면 공허해진다');
  for (const [agent, e] of Object.entries(sp.byCli.codex.apply['0'])) {
    assert.equal(e.model, '0');
    assert.equal('effort' in e, false, `${agent}에 astra의 권장 effort를 붙였다`);
  }
});

test('S21 B9: 세 묶음이 AGENTS를 정확히 나누고 구현·테스트가 GROUPS.writesFiles와 같다', () => {
  const all = TIERS.flatMap((t) => [...t.agents]);
  assert.deepEqual(all.slice().sort(), [...AGENTS].sort());
  assert.equal(new Set(all).size, all.length, '묶음이 겹친다');
  for (const t of TIERS) assert.ok(t.agents.length >= 1, `${t.id}가 비었다`);
  assert.deepEqual([...TIERS[1].agents].sort(), [...GROUPS.writesFiles].sort());
  assert.equal(TIERS[0].agents.length, 2, 'PLAN_TIER 오타는 이 길이로 드러난다');
  // 묶음 경계를 **근거에서 유도해** 대조한다 — 실측(2026-10-02): PLAN/DESIGN 본문을 반환한다고
  // 적은 파일은 정확히 2개다. 누가 계약을 바꾸면 빨개진다(S5와 같은 패턴).
  const base = path.join(root, 'agents');
  const planners = fs.readdirSync(base).filter((f) => f.endsWith('.md'))
    .filter((f) => /(PLAN|DESIGN)\.md 본문/.test(fs.readFileSync(path.join(base, f), 'utf8')))
    .map((f) => f.replace(/\.md$/, ''));
  assert.deepEqual([...TIERS[0].agents].sort(), planners.sort());
});

test('S22 B10: Codex를 골라도 본문 반환 단계는 Claude로 남고 사유가 보고된다', () => {
  const sp = stagesPlan({ offer: mkOffer(true), byCli: byCliOf(), ccVersion: null, customModel: null });
  // ⚠ **빈 객체면 for가 0회 돈다** — `apply` 채우는 루프를 통째로 지워도 초록이었다
  //    (2026-10-02 Gap 4회차: 여섯 번째 공허 단언). 키 집합부터 못박는다.
  assert.deepEqual(Object.keys(sp.byCli.codex.apply).sort(), CODEX.primary.map((c) => c.id).sort(),
    'Codex apply가 카탈로그 모델 집합과 다르다(비어 있을 수도 있다)');
  assert.ok(Object.keys(sp.byCli.claude.apply).length >= 1, 'Claude apply가 비었다');
  for (const [, apply] of Object.entries(sp.byCli.codex.apply)) {
    assert.deepEqual(Object.keys(apply).sort(), [...GROUPS.writesFiles].sort(),
      'Codex 적용 데이터에 본문 반환 단계가 있다');
    for (const [agent, entry] of Object.entries(apply)) {
      assert.ok(!GROUPS.returnsBody.includes(agent), `${agent}에 codex가 갔다`);
      assert.equal(entry.cli, 'codex');
    }
  }
  assert.ok(sp.notes.some((n) => /본문을 반환/.test(n)));
  // ⚠ DESIGN §8.1은 "rounds에 에이전트 이름 0건"을 요구했지만 **그 단언은 쓰지 않는다** —
  //    묶음 설명에 멤버를 보여주지 않으면 사용자가 "검증·보고"에 무엇이 들어가는지 모르고 고른다.
  //    의도는 "이름을 숨겨라"가 아니라 **"단계별로 묻지 마라"**였으므로 그쪽을 단언한다.
  const stageQ = sp.rounds[0].questions.find((q) => q.header === '단계');
  assert.equal(stageQ.options.length, TIERS.length, '묶음이 아니라 단계별로 물으면 선택지가 8개가 된다');
  assert.ok(stageQ.options.length < AGENTS.length);
  // basePlan 쪽도 같은 성질이다.
  for (const entry of Object.values(basePlan({ offer: mkOffer(true), codexChoices: CODEX, cfg: DEFAULTS }).patches)) {
    for (const [agent, m] of Object.entries(entry.patch.models ?? {})) {
      if (m.cli === 'codex') assert.ok(!GROUPS.returnsBody.includes(agent), `${agent}에 codex가 갔다`);
    }
  }
});

test('S23 B11: 단계별 적용 데이터가 cli와 model과 effort까지 완성돼 있다', () => {
  const sp = stagesPlan({ offer: mkOffer(true), byCli: byCliOf(), ccVersion: null, customModel: null });
  assert.deepEqual(Object.keys(sp.byCli.claude.apply).sort(), CLAUDE.primary.map((c) => c.value).sort(),
    'Claude apply가 카탈로그 모델 집합과 다르다');
  // **한 단계 경로(modelPlan)도 같은 계약이다** — 거기 apply를 통째로 지워도 초록이었다.
  const one = modelPlan({ agent: 'tdd-driver', cli: 'codex', choices: CODEX, meta: META_OK, ccVersion: null });
  assert.deepEqual(Object.keys(one.apply).sort(), CODEX.primary.map((c) => c.id).sort());
  for (const apply of Object.values(one.apply)) {
    assert.deepEqual(Object.keys(apply).sort(), [...GROUPS.writesFiles].sort(),
      '한 단계 경로의 Codex apply에 본문 반환 단계가 있다');
  }
  const oneClaude = modelPlan({ agent: 'planner', cli: 'claude', choices: CLAUDE, meta: META_OK, ccVersion: null });
  for (const apply of Object.values(oneClaude.apply)) assert.deepEqual(Object.keys(apply), ['planner']);
  for (const [model, apply] of Object.entries(sp.byCli.claude.apply)) {
    assert.deepEqual(Object.keys(apply).sort(), [...AGENTS].sort(), 'claude는 8종 전부에 갈 수 있다');
    for (const [agent, e] of Object.entries(apply)) {
      assert.equal(e.effort, DEFAULTS.models[agent].effort, `${agent}의 claude effort가 DEFAULTS와 다르다`);
      assert.equal(e.model, model);
    }
  }
  for (const [model, apply] of Object.entries(sp.byCli.codex.apply)) {
    const rec = CODEX.primary.find((c) => c.id === model).recommendedEffort;
    for (const e of Object.values(apply)) assert.equal(e.effort, rec);
  }
  // 권장값이 없으면 **키 자체가 없다** — 모르는 값을 지어내지 않는다.
  const noRec = { primary: [codexChoice('gpt-plain', null, [])], pinned: [] };
  const bare = stagesPlan({ offer: mkOffer(true), byCli: byCliOf(CLAUDE, noRec), ccVersion: null, customModel: null });
  for (const apply of Object.values(bare.byCli.codex.apply)) {
    for (const [agent, e] of Object.entries(apply)) {
      assert.equal('effort' in e, false, `${agent}에 모르는 effort를 지어냈다`);
      assert.equal(mergeConfig({ models: { [agent]: e } }).config.models[agent].effort, DEFAULTS.models[agent].effort);
    }
  }
  // 엔트리의 키 집합은 두 가지뿐이다.
  for (const cli of ['claude', 'codex']) {
    for (const apply of Object.values(sp.byCli[cli].apply)) {
      for (const e of Object.values(apply)) {
        const keys = Object.keys(e).sort().join(',');
        assert.ok(keys === 'cli,model' || keys === 'cli,effort,model', `예상 밖 키 집합: ${keys}`);
      }
    }
  }
});

test('S24 B14: inherit은 claude에서만 나타나고 Codex 경로에 0건이다', () => {
  // ⚠ `cli:'codex'`에 inherit을 금지하는 계약이 **여기** 있다 — `validateModel`은 문자열 하나만
  //    받아 형제 키 `cli`를 구조적으로 볼 수 없어서 그 층에는 둘 수 없다(DESIGN §3.3).
  assert.equal(acceptCodexModel('inherit'), null);
  const plan = basePlan({ offer: mkOffer(true), codexChoices: CODEX, cfg: DEFAULTS, customModel: 'inherit' });
  for (const [key, entry] of Object.entries(plan.patches)) {
    if (!key.includes('codex:')) continue;
    assert.ok(!key.includes('inherit'), `${key}에 inherit이 샜다`);
    assert.ok(!JSON.stringify(entry).includes('inherit'), `${key}의 patch에 inherit이 샜다`);
  }
  const sp = stagesPlan({ offer: mkOffer(true), byCli: byCliOf(), ccVersion: null, customModel: 'inherit' });
  assert.ok(!JSON.stringify(sp.byCli.codex).includes('inherit'), 'Codex 적용 데이터에 inherit이 샜다');
  // claude 쪽은 받는다 — 사용자가 적을 수 있는 값이다.
  const applied = applyFor('claude', ['planner'], 'inherit', null);
  assert.deepEqual(applied.planner, { cli: 'claude', model: 'inherit', effort: DEFAULTS.models.planner.effort });
});

test('S25 B15: inherit 단계의 effort가 DEFAULTS와 같고 Claude 경로 출력에 ultra가 없다', () => {
  const ultraChoice = { ...codexChoice('x', 'ultra'), recommendedEffort: 'ultra' };
  const applied = applyFor('claude', AGENTS, 'inherit', ultraChoice);
  for (const agent of AGENTS) {
    assert.equal(applied[agent].effort, DEFAULTS.models[agent].effort,
      `${agent}의 effort가 카탈로그 권장값으로 덮였다`);
  }
  assert.deepEqual(mergeConfig({ models: { planner: { cli: 'claude', model: 'inherit',
    effort: DEFAULTS.models.planner.effort } } }).problems, []);
  const sp = stagesPlan({ offer: mkOffer(true), byCli: byCliOf(), ccVersion: null, customModel: null });
  assert.ok(!JSON.stringify(sp.byCli.claude).includes('ultra'), 'Claude 경로에 ultra가 샜다');
});

test('S26 B22: 순수 3모듈이 200줄 이내이고 fs와 os와 path와 process를 참조하지 않는다 (소스 관찰)', () => {
  // ⚠ **소스 관찰**이다(RULES.md:412) — 동작 단언과 섞지 않는다. 무throw·순수성의 동작 증명은 S12다.
  for (const name of ['setup-plan.js', 'setup-plan-model.js', 'setup-plan-tiers.js']) {
    const src = fs.readFileSync(path.join(root, 'hooks', 'lib', name), 'utf8');
    assert.ok(src.split('\n').length <= 200, `${name}이 200줄을 넘는다`);
    assert.doesNotMatch(src, /require\(\s*'(node:)?(fs|os|path|child_process)'/, `${name}이 IO를 require한다`);
    assert.doesNotMatch(src, /\bprocess\./, `${name}이 process를 참조한다`);
  }
});

test('S27 B12: 병합이 고르지 않은 단계와 비모델 키를 보존한다', () => {
  const { mergeConfigFile } = require_(planPath);
  // 🔴 직전 사이클의 데이터 손실과 **같은 클래스**다 — 얕게 합치면 models가 통째로 교체된다.
  const existing = { version: 1, language: 'ko', guards: { level: 'strict' },
    models: { planner: { cli: 'claude', model: 'fable', effort: 'max' },
      'tdd-driver': { cli: 'codex', model: 'gpt-x', effort: 'low' } } };
  const patch = { models: { 'feature-builder': { cli: 'codex', model: 'gpt-y', effort: 'medium' } } };
  const out = mergeConfigFile(existing, patch);
  assert.equal(out.language, 'ko', '비모델 키가 사라졌다');
  assert.deepEqual(out.guards, { level: 'strict' });
  assert.deepEqual(out.models.planner, existing.models.planner, '고르지 않은 단계가 사라졌다');
  assert.deepEqual(out.models['tdd-driver'], existing.models['tdd-driver'], '고르지 않은 단계가 사라졌다');
  assert.deepEqual(out.models['feature-builder'], patch.models['feature-builder']);
  assert.equal(Object.keys(out.models).length, 3);
  assert.equal(out.version, 1);
  // ⚠ **방향**도 단언한다 — patch가 기존을 이겨야 한다. 뒤집어도(`{...add, ...base}`) 위 단언들은
  //    전부 통과했다(2026-10-02 Gap). 그러면 `엄격`을 골라도 기존 guards가 말없이 이긴다.
  assert.deepEqual(mergeConfigFile({ version: 1, guards: { level: 'minimal' }, language: 'en' },
    { guards: { level: 'strict' }, language: 'ko' }), { version: 1, guards: { level: 'strict' }, language: 'ko' });
  // 같은 단계를 다시 고르면 **덮어쓴다**(그게 의도다).
  assert.deepEqual(mergeConfigFile(existing, { models: { planner: { cli: 'claude', model: 'opus' } } })
    .models.planner, { cli: 'claude', model: 'opus' });
  // 🔴 `models`만의 문제가 아니었다 — `엄격`이 사용자의 `guards.newDependency`를,
  //    `최소 간섭`이 `verify.timeouts`를 **말없이 지웠다**(2026-10-02 Gap 4회차 실행 확인).
  const deep = mergeConfigFile(
    { version: 1, guards: { level: 'default', newDependency: 'deny', protectedFiles: { env: 'ask' } },
      verify: { kinds: ['lint'], timeouts: { lint: 5 } } },
    { guards: { level: 'strict' }, verify: { tscOnEdit: true } });
  assert.equal(deep.guards.newDependency, 'deny', 'guards의 다른 키가 사라졌다');
  assert.deepEqual(deep.guards.protectedFiles, { env: 'ask' });
  assert.equal(deep.guards.level, 'strict', 'patch가 져서 범위 선택이 무시됐다');
  assert.deepEqual(deep.verify.kinds, ['lint'], 'verify의 다른 키가 사라졌다');
  assert.deepEqual(deep.verify.timeouts, { lint: 5 });
  assert.equal(deep.verify.tscOnEdit, true);
  // 입력을 바꾸지 않는다 — 호출부가 원문을 다시 쓸 수 있어야 한다.
  assert.equal(Object.keys(existing.models).length, 2);
  // patch가 비면 기존이 그대로 남는다(= `기본값 그대로`가 남의 설정을 지우지 않는다).
  assert.deepEqual(mergeConfigFile(existing, {}).models, existing.models);
  // 파일이 없던 경우 — models 키를 만들지 않는다.
  assert.equal('models' in mergeConfigFile(null, {}), false);
  assert.deepEqual(mergeConfigFile(null, {}), { version: 1 });
  // 잡음에도 throw하지 않는다.
  for (const v of [null, undefined, 3, 'x', [], { models: 'x' }]) {
    assert.equal(typeof mergeConfigFile(v, v), 'object');
  }
});

test('S28: 인덱스형 모델 id가 와도 엉뚱한 모델의 권장 effort를 지어 붙이지 않는다', () => {
  // 🔴 `findChoice`를 키 룩업으로 바꾸면 `'0'`이 `primary[0]`을 찾아 **그 모델의 effort**를
  //    엉뚱한 id에 붙인다(2026-10-02 Gap이 내 "관측 불가능" 주장을 반증한 자리다).
  const only = { primary: [{ ...codexChoice('astra'), recommendedEffort: 'medium' }], pinned: [] };
  for (const id of ['0', '1', 'length']) {
    const { patch } = resolveModels({ scope: 'default', codexModel: id, choices: only, cfg: DEFAULTS });
    for (const [agent, e] of Object.entries(patch.models ?? {})) {
      assert.equal(e.model, id, `${agent}의 모델이 요청한 id와 다르다`);
      assert.equal('effort' in e, false, `${id}에 ${only.primary[0].id}의 권장 effort를 붙였다`);
    }
  }
});

// ── S32: 🔴4·🔴5 조치에 단언을 박는다 (2026-10-02 Gap 5회차) ──
// 🔴 이 사이클 **일곱 번째** 공허: `round1`의 `codexUsable` 가드와 `modelPlan`의 custom 추가를
//    **통째로 지워도 행동 테스트가 0건 RED**였다(늘어난 것은 무결성 해시 `P15b`뿐).
//    `P15b`는 "파일이 바뀌었다"만 말한다 — "동작이 바뀌었다"는 아무도 말하지 않았다.
test('S32 B7: 모델 목록이 비면 두 경로가 **같은 기준으로** CLI를 묻지 않는다', () => {
  const offer = [{ cli: 'claude', offered: true }, { cli: 'codex', offered: true }];
  const empty = { choices: { primary: [], overflow: [] }, meta: {} };
  // ① 여러 단계 경로(`round1`) — 감지됐지만 목록이 비었다.
  const sp = stagesPlan({ offer, byCli: { claude: empty, codex: empty }, ccVersion: null });
  const headers = sp.rounds[0].questions.map((q) => q.header);
  assert.deepEqual(headers, ['단계'], '목록이 비었는데 실행 CLI를 물었다 — 라운드 2가 빈 손이라 막다른 길이다');
  assert.ok(!('실행 CLI' in sp.rounds[0].map), 'map에 CLI 축이 남으면 커맨드가 답을 되돌릴 수 있다고 믿는다');
  assert.ok(sp.notes.some((n) => n.includes('목록이 비어')), '사유를 안 실으면 커맨드가 즉흥으로 메운다');
  // ② 한 단계 경로(`modelPlan`) — **같은 입력에서 같은 판정**이어야 한다.
  const mp = modelPlan({ agent: 'tdd-driver', cli: null, choices: null, meta: null,
    ccVersion: null, offer, codexHasModels: false });
  assert.deepEqual(mp.rounds, [], '형제 경로가 여전히 물었다 — 사용자는 경로에 따라 다른 문항을 받는다');
  assert.ok(mp.notes.some((n) => n.includes('목록이 비어')), '사유가 "감지되지 않아"면 틀린 사유를 보고한다');
  // ③ 목록이 있으면 **묻는다**(가드가 항상 막기만 하면 기능이 죽는다 — 양성 대조).
  const ok = { choices: { primary: [{ id: 'gpt-6-astra', name: 'A', recommendedEffort: 'medium',
    effortOptions: [{ id: 'medium' }] }], overflow: [] }, meta: {} };
  const sp2 = stagesPlan({ offer, byCli: { claude: ok, codex: ok }, ccVersion: null });
  assert.deepEqual(sp2.rounds[0].questions.map((q) => q.header), ['단계', '실행 CLI']);
  const mp2 = modelPlan({ agent: 'tdd-driver', cli: null, choices: null, meta: null,
    ccVersion: null, offer, codexHasModels: true });
  assert.equal(mp2.rounds.length, 1, '목록이 있는데도 안 물으면 Codex를 고를 길이 없다');
});

test('S32b B7: `그 외` 이름이 **두 경로 모두** apply에 들어가고 객체를 망가뜨리지 않는다', () => {
  const ch = { primary: [{ id: 'gpt-6-astra', name: 'A', recommendedEffort: 'medium',
    effortOptions: [{ id: 'medium' }] }], overflow: [] };
  const offer = [{ cli: 'claude', offered: true }, { cli: 'codex', offered: true }];
  const one = (name) => modelPlan({ agent: 'tdd-driver', cli: 'codex', choices: ch, meta: {},
    ccVersion: null, customModel: name }).apply;
  const many = (name) => stagesPlan({ offer, byCli: { claude: null, codex: { choices: ch, meta: {} } },
    ccVersion: null, customModel: name }).byCli.codex.apply;
  // ① 정상 이름은 **양쪽 다** 들어가고 단계별로 완성돼 있다 — `kit.md`가 복사해 쓰는 자리다.
  for (const [label, apply] of [['modelPlan', one('m-custom')], ['stagesPlan', many('m-custom')]]) {
    assert.ok('m-custom' in apply, `${label}에 custom이 없다 — 커맨드가 undefined를 받아 effort를 지어낸다`);
    const entry = apply['m-custom'];
    assert.deepEqual(Object.keys(entry).sort(), ['feature-builder', 'tdd-driver', 'test-writer'],
      `${label}의 custom이 파일 쓰는 3단계를 못 덮는다`);
    for (const a of Object.keys(entry)) assert.equal(entry[a].cli, 'codex');
    // 모르는 모델엔 effort를 **붙이지 않는다**(카탈로그가 권장값을 모른다).
    assert.ok(!('effort' in entry['tdd-driver']), `${label}이 모르는 모델에 effort를 지어냈다`);
  }
  // ② 프로토타입 이름은 **게이트에서** 거부된다 — 두 경로가 **같은 답**을 낸다.
  for (const bad of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
    const a = one(bad); const b = many(bad);
    assert.deepEqual(Object.keys(a), ['gpt-6-astra'], `modelPlan이 ${bad}를 받았다`);
    assert.deepEqual(Object.keys(b), ['gpt-6-astra'], `stagesPlan이 ${bad}를 받았다`);
    assert.equal(Object.getPrototypeOf(a), Object.prototype, `${bad}가 modelPlan의 apply를 오염시켰다`);
    assert.equal(Object.getPrototypeOf(b), Object.prototype, `${bad}가 stagesPlan의 apply를 오염시켰다`);
    // 기존 엔트리가 멀쩡한지 — 오염되면 JSON 경계에서 엉뚱한 값이 나간다.
    assert.equal(a['gpt-6-astra']['tdd-driver'].model, 'gpt-6-astra');
  }
});
