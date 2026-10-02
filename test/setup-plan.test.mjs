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
const require_ = createRequire(import.meta.url);
const { GROUPS, basePlan, modelPlan, resolveModels } = require_(planPath);
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
    // 고를 수 없는 조합의 patch를 만들어 두면 커맨드가 그것을 고를 수 있다.
    assert.deepEqual(Object.keys(plan.patches).filter((k) => k.endsWith('|codex')), []);
  }
});

test('S3 B3: offer에 Codex가 있어도 primary가 비면 문항을 내지 않고 사유를 notes에 싣는다', () => {
  const plan = basePlan({ offer: mkOffer(true), codexChoices: CODEX_EMPTY, cfg: DEFAULTS });
  assert.equal(qs(plan).length, 1, 'Codex 모델이 하나도 없는데 CLI를 물었다');
  assert.ok(plan.notes.some((n) => /목록/.test(n)), '사유가 notes에 없다');
  // AskUserQuestion은 options minItems 2다 — 선택지 1개짜리 문항은 **스키마가 거부한다**(DESIGN §0).
  assert.ok(qs(plan).every((q) => q.options.length >= 2));
  assert.deepEqual(Object.keys(plan.patches).filter((k) => k.endsWith('|codex')), []);
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
  const models = plan.patches['default|codex'].patch.models;
  assert.deepEqual(Object.keys(models).sort(), [...GROUPS.writesFiles].sort());
  for (const entry of Object.values(models)) {
    assert.deepEqual(entry, { cli: 'codex', model: 'gpt-6-astra', effort: 'medium' });
  }
  // recommendedEffort가 null이면 **effort 키를 싣지 않는다** — 모르는 값을 고른 척하지 않는다.
  const noRec = { primary: [codexChoice('gpt-plain', null, [])], pinned: [] };
  const bare = basePlan({ offer: mkOffer(true), codexChoices: noRec, cfg: DEFAULTS });
  const bareModels = bare.patches['default|codex'].patch.models;
  for (const [agent, entry] of Object.entries(bareModels)) {
    assert.equal('effort' in entry, false, `${agent}에 모르는 effort를 지어냈다`);
    assert.equal(mergeConfig(bare.patches['default|codex'].patch).config.models[agent].effort,
      DEFAULTS.models[agent].effort);
  }
  assert.ok(bare.patches['default|codex'].notes.some((n) => /effort를 쓰지 않는다/.test(n)));
});

test('S9 B9: resolveModels는 codex 단계에 Claude 폴백 모델명을 절대 쓰지 않는다', () => {
  const banned = fallbackChoices().models;
  assert.ok(banned.length >= 2, '폴백 목록이 비면 이 테스트가 아무것도 막지 못한다');
  for (const choices of [null, CODEX_EMPTY, { primary: [{ ...codexChoice('x'), id: '', value: '' }], pinned: [] }]) {
    const { patch } = resolveModels({ scope: 'default', useCodexForBuild: true, choices, cfg: DEFAULTS });
    assert.equal('models' in patch, false, '쓸 모델이 없는데 models 패치를 만들었다');
  }
  for (const { offer, cfg } of combos()) {
    for (const entry of Object.values(basePlan({ offer, codexChoices: CODEX, cfg }).patches)) {
      for (const m of Object.values(entry.patch.models ?? {})) {
        if (m.cli === 'codex') assert.ok(!banned.includes(m.model), `codex 단계에 ${m.model}을 넣었다`);
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
    const { basePlan, modelPlan, resolveModels } = require(${JSON.stringify(planPath)});
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
      const c = resolveModels({ scope: v, useCodexForBuild: v, choices: v, cfg: v });
      if (typeof c.patch !== 'object' || c.patch === null) throw new Error('patch가 객체가 아니다');
      n += 1;
    }
    for (const scope of SCOPES_NOISE) {
      const r = resolveModels({ scope, useCodexForBuild: true, choices: null, cfg: null });
      if (typeof r.patch !== 'object' || r.patch === null) throw new Error('patch가 객체가 아니다: ' + scope);
      if (Array.isArray(r.patch)) throw new Error('patch가 배열이다: ' + scope);
      n += 1;
    }
    process.stdout.write(String(n));
  `;
  assert.equal(execFileSync('node', ['-e', probe], { encoding: 'utf8' }), '17');
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
