// `/kit setup models`가 **여러 단계를 한 번에** 받기 위한 묶음과 라운드.
//
// 설계: docs/2026-10-02-role-model-choice-ux/DESIGN.md §5
//
// ⚠ 이 모듈이 있는 이유: 한 단계씩만 바꿀 수 있어서 세 단계를 고치려면 `setup models`를 세 번
//    돌려야 했다 — 직전 사이클이 없앤 "라운드 폭발"로 되돌아가는 길이다. 묶음 3개를 한 라운드에
//    multiSelect로 받고, 모델은 다음 라운드에서 한 번만 묻는다(합 2라운드).
//
// ⚠ 묶음은 **열거가 아니라 유도**다. `build`는 `GROUPS.writesFiles`와 **같은 배열을 재사용**하고
//    `verify`는 여집합이라, 합집합 = AGENTS·교집합 = ∅ 이 구조적으로 참이다. 남는 실패 모드는
//    `PLAN_TIER`의 오타 하나뿐이고 그것은 길이 단언으로 드러난다.
//
// ⚠ 순수 — fs·os·path·process를 보지 않고 **로드 시에도 어떤 입력에도 throw하지 않는다**.
const { AGENTS } = require('./config-schema');
const { GROUPS, isObj, list, str, modelOptions, applyFor, addCustom } = require('./setup-plan-model');

/** 이 사이클에서 유일하게 남는 열거. 나머지 둘은 여기서 유도된다. */
const PLAN_TIER = ['planner', 'architect'];
const TIERS = Object.freeze([
  Object.freeze({ id: 'plan', label: '계획·설계',
    agents: Object.freeze(AGENTS.filter((a) => PLAN_TIER.includes(a))) }),
  Object.freeze({ id: 'build', label: '구현·테스트', agents: GROUPS.writesFiles }),
  Object.freeze({ id: 'verify', label: '검증·보고',
    agents: Object.freeze(AGENTS.filter((a) => !PLAN_TIER.includes(a) && !GROUPS.writesFiles.includes(a))) }),
]);

const TIER_NOTE = {
  plan: '본문을 반환하는 단계라 Codex 후보가 아니다 — Codex를 골라도 Claude로 남는다.',
  build: '파일을 직접 쓰는 단계다 — Codex로 돌릴 수 있다.',
  verify: '본문을 반환하는 단계라 Codex 후보가 아니다 — Codex를 골라도 Claude로 남는다.',
};

/** 라운드 1의 두 문항. **서로의 답에 의존하지 않는다**(한 번에 제출되므로 그래야 한다).
 *  ⚠ `codexUsable`은 "감지됐나"가 아니라 **"모델 문항을 낼 수 있나"**다 — 감지만 보고 물으면
 *    목록이 비었을 때(캐시 부재·깨짐, 로그인 전엔 흔하다) 라운드 2가 빈 손이라 **막다른 길**이
 *    된다(2026-10-02 리뷰 🔴4). 형제 경로인 `basePlan`은 이미 그렇게 한다. */
function round1(offer, codexUsable) {
  const stages = {
    question: '어느 단계를 바꿀까?', header: '단계', multiSelect: true,
    options: TIERS.map((t) => ({ label: t.label, description: `${t.agents.join(' · ')} — ${TIER_NOTE[t.id]}` })),
  };
  const map = { 단계: Object.fromEntries(TIERS.map((t) => [t.label, t.id])) };
  const questions = [stages];
  // 선택지가 1개로 줄면 문항을 만들지 않는다 — 스키마가 `options`를 2개 이상으로 잡는다.
  if (codexUsable && list(offer).some((o) => o.cli === 'codex' && o.offered === true)) {
    questions.push({
      question: '고른 단계를 어느 CLI로 돌릴까?', header: '실행 CLI', multiSelect: false,
      options: [{ label: 'Claude', description: '지금 기본값이다. Claude 구독 사용량을 쓴다.' },
        { label: 'Codex', description: `파일을 쓰는 ${GROUPS.writesFiles.length}단계만 Codex로 돈다(Codex 계정 사용량). 나머지는 Claude로 남는다.` }],
    });
    map['실행 CLI'] = { Claude: 'claude', Codex: 'codex' };
  }
  return { questions, map };
}

/** 한 CLI의 라운드 2 재료. 못 쓰는 CLI는 호출자가 null을 넣는다. */
function forCli(cli, source, ccVersion, customModel) {
  if (!isObj(source)) return null;
  const notes = [];
  const built = modelOptions({ cli, choices: source.choices, meta: source.meta, ccVersion,
    question: '고른 단계가 쓸 모델은?' });   // ⚠ question은 **required**다 — 빼면 도구가 문항을 거부한다
  notes.push(...built.notes);
  // claude는 8종 전부에 갈 수 있고, codex는 파일을 쓰는 3종에만 간다 —
  // **키의 부재**로 "본문 반환 단계에 Codex 금지"를 강제한다(문항이 아니라 데이터로).
  const agents = cli === 'codex' ? GROUPS.writesFiles : AGENTS;
  const apply = {};
  for (const id of built.ids) apply[id] = applyFor(cli, agents, id, built.choiceOf(id));
  // ⚠ custom은 **문항에 선택지를 더하지 않는다** — 더하면 5칸이 되어 스키마가 거부한다.
  // ⚠ `modelPlan`과 **같은 함수**를 쓴다 — 각자 구현하면 판정이 갈린다(Gap 5회차).
  addCustom(apply, { cli, agents, custom: customModel, choiceOf: built.choiceOf });
  return { rounds: built.round ? [built.round] : [], apply, notes };
}

/**
 * `/kit setup models`(단계 미지정)의 계획. 라운드 1 하나 + CLI별 라운드 2 재료.
 * 두 라운드를 넘지 않는다. 순수 — 어떤 입력에도 throw하지 않는다.
 */
function stagesPlan({ offer, byCli, ccVersion, customModel }) {
  const notes = [];
  const src = isObj(byCli) ? byCli : {};
  const out = { claude: forCli('claude', src.claude, ccVersion, null),
    codex: forCli('codex', src.codex, ccVersion, customModel) };
  for (const cli of ['claude', 'codex']) {
    // `byCli[cli] === null`이 침묵이 되면 커맨드가 그 자리를 즉흥으로 메운다.
    if (out[cli] === null) notes.push(`${cli}는 지금 쓸 수 없다 — 그 CLI의 모델 문항을 내지 않는다.`);
    else notes.push(...out[cli].notes.map((n) => `${cli}: ${n}`));
  }
  const codexUsable = out.codex !== null && out.codex.rounds.length > 0;
  if (!codexUsable && out.codex !== null) {
    notes.push('Codex 모델 목록이 비어 실행 CLI를 묻지 않는다 — 고른 단계는 Claude로 돈다.');
  }
  notes.push('고른 단계 중 본문을 반환하는 단계는 Codex를 골라도 Claude로 남는다 — 적용 데이터에 그 단계의 키가 없다.');
  return { tiers: TIERS.map((t) => ({ id: t.id, label: t.label, agents: [...t.agents] })),
    rounds: [round1(offer, codexUsable)], byCli: out, notes };
}

module.exports = { TIERS, stagesPlan };
