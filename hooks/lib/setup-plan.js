// `/kit setup`이 **무엇을 묻는가**를 정하는 순수 층.
//
// 설계: docs/2026-10-01-wizard-question-budget/DESIGN.md §1·§3·§4
//
// ⚠ 이 모듈이 있는 이유: 문항을 마크다운 산문에 적어 두면 지켜지지 않는다. `commands/kit.md`가
// `8종을 하나씩 묻지 않는다`라고 **적어 둔 상태에서** 모델이 8라운드를 돌린 것이 2026-10-01에
// 관측됐다(결함로그 D8·D23·D26). 그래서 문항을 **값으로** 만들고 상한을 테스트가 실행해서 센다.
// 커맨드는 여기서 나온 것을 **변형 없이** AskUserQuestion에 넘긴다 — 발명할 거리를 남기지 않는다.
//
// ⚠ **로드 시 throw하지 않는다.** `scripts/list-models.mjs`가 최상위에서 require하므로
// 여기서 던지면 try 밖이라 "보고 도구는 항상 exit 0" 계약이 깨진다. 상수 불변식은 유도로
// 구조화하고(AGENTS.filter) 단언은 테스트가 한다 — 자기 자신을 확인하는 검사는 두지 않는다(D24).
//
// ⚠ 문항·옵션 객체에 **키를 더하지 마라.** AskUserQuestion의 입력 스키마가
// `additionalProperties: false`라 추가 키는 거부된다. 그래서 답→동작 매핑은 문항 밖 `map`에 둔다.
// 같은 스키마가 `options`를 `minItems 2`로 잡으므로 **선택지가 1개면 문항을 만들지 않는다**.
//
// Codex 목록의 정렬 근거는 `model-catalog-codex.js`에 있다 — `priority` 오름차순(작을수록 상위),
// 결측·비정수는 캐시 순서를 지키며 뒤로. 여기서는 그 순서를 **그대로 믿고** 앞에서부터 쓴다.
const { AGENTS, DEFAULTS } = require('./config-schema');
const { GROUPS, REASON_RETURNS_BODY, CODEX_USAGE, CODEX_RANK,
  isObj, str, list, effortFor, modelPlan } = require('./setup-plan-model');

/** scope → 비모델 키 패치. 정의는 기존 마법사의 것을 그대로 옮긴 것이고 이번에 바꾸지 않았다. */
const SCOPE_PATCH = {
  default: () => ({}),
  minimal: () => ({ guards: { level: 'minimal' }, pdca: { enabled: false },
    rules: { noAny: false, noConsoleLog: false, noEmptyCatch: false, tsxLogic: false, naming: false, testNudge: false } }),
  strict: () => ({ guards: { level: 'strict' }, verify: { tscOnEdit: true } }),
  pick: () => ({}),
};
const SCOPES = Object.keys(SCOPE_PATCH);

/** 설정에서 기본값과 다른 모델 항목만. 마법사가 "지금 무엇이 다른가"를 보여줄 근거다. */
function diffFrom(cfg) {
  const models = isObj(cfg) && isObj(cfg.models) ? cfg.models : {};
  const out = {};
  for (const agent of AGENTS) {
    const now = isObj(models[agent]) ? models[agent] : {};
    const base = DEFAULTS.models[agent];
    const changed = Object.entries(base).filter(([k, v]) => now[k] !== undefined && now[k] !== v);
    if (changed.length) out[agent] = Object.fromEntries(changed.map(([k]) => [k, now[k]]));
  }
  return out;
}

function scopeQuestion() {
  const options = [
    { label: '기본값 그대로', description: '권장 — 파일에 {"version":1} 한 줄만 쓴다. 동작은 완전 기본값이다.' },
    { label: '최소 간섭', description: '가드를 minimal로, PDCA를 끄고, 코드 규칙 6종을 끈다.' },
    { label: '엄격', description: '가드를 strict로, 편집마다 타입체크를 켠다.' },
    { label: '직접 고르기', description: '언어·PDCA·구조·코드규칙·커밋·머지·가드·검증을 주제별로 묻는다(라운드가 늘어난다).' },
  ];
  return { question: 'devkit 설정을 어디까지 맞출까?', header: '설정 범위', multiSelect: false, options };
}

function buildQuestion(choice) {
  const name = str(choice.label) ?? str(choice.id) ?? str(choice.value);
  const effort = str(choice.recommendedEffort);
  return {
    question: '구현·테스트 단계를 Codex로 돌릴까?', header: '구현 CLI', multiSelect: false,
    options: [
      { label: 'Claude로 전부', description: '지금과 같다 — 8단계 모두 Claude Code로 돈다.' },
      { label: '구현은 Codex',
        description: `파일을 쓰는 ${GROUPS.writesFiles.length}단계를 ${name}로 돌린다`
          + `${effort ? `(effort ${effort})` : ''}. 본문을 반환하는 ${GROUPS.returnsBody.length}종은 Codex 후보가 아니다.` },
    ],
  };
}

/** 한 조합의 부분 설정. `_appliedAt`·`version`은 담지 않는다.
 *  ⚠ **최소 diff가 아니다** — scope 패치는 `cfg`를 보지 않으므로 이미 같은 값이어도 다시 싣는다.
 *  무해하지만(mergeConfig가 같은 값으로 병합한다) 그렇게 적어 둔다(2026-10-02 리뷰 🟡3). */
function resolveModels({ scope, useCodexForBuild, choices, cfg }) {
  const notes = [];
  // ⚠ `SCOPE_PATCH[scope]`로 바로 꺼내면 **프로토타입 체인을 탄다** — `scope:'toString'`이면
  //   함수를 찾아 patch가 문자열이 되고 `'valueOf'`면 throw한다(2026-10-02 리뷰 🔴3).
  //   순수층의 무throw는 이 사이클이 계약으로 못박은 것이고 이 함수는 export돼 있다.
  const patch = (SCOPES.includes(scope) ? SCOPE_PATCH[scope] : SCOPE_PATCH.default)();
  const top = list(isObj(choices) ? choices.primary : null)[0] ?? null;
  const id = top ? str(top.id) ?? str(top.value) : null;
  if (useCodexForBuild === true && id) {
    const models = {};
    for (const agent of GROUPS.writesFiles) {
      const effort = effortFor(agent, 'codex', top);
      models[agent] = effort === undefined ? { cli: 'codex', model: id } : { cli: 'codex', model: id, effort };
      if (effort === undefined) notes.push(`${agent}: 이 모델은 effort를 쓰지 않는다(카탈로그 기준) — 기존 effort 값을 그대로 둔다.`);
    }
    patch.models = models;
    notes.push(CODEX_USAGE, CODEX_RANK);
  } else if (useCodexForBuild !== true && Object.keys(diffFrom(cfg)).length) {
    notes.push('지금 설정에 바꿔 둔 단계가 있다 — 마법사는 되돌리지 않는다. '
      + '되돌리려면 `/kit setup models` 또는 설정 파일을 직접 고친다.');
  }
  return { patch, notes };
}

function basePlan({ offer, codexChoices, cfg }) {
  const notes = [];
  const questions = [scopeQuestion()];
  const map = { '설정 범위': { '기본값 그대로': 'default', '최소 간섭': 'minimal', 엄격: 'strict', '직접 고르기': 'pick' } };
  const codex = list(offer).find((o) => o.cli === 'codex') ?? null;
  const top = list(isObj(codexChoices) ? codexChoices.primary : null)[0] ?? null;
  const builds = ['claude'];
  if (codex && codex.offered === true && top) {
    questions.push(buildQuestion(top));
    map['구현 CLI'] = { 'Claude로 전부': 'claude', '구현은 Codex': 'codex' };
    builds.push('codex');
    notes.push(REASON_RETURNS_BODY);
  } else if (!codex || codex.offered !== true) {
    notes.push(str(codex && codex.hint) ?? 'Codex가 감지되지 않았다 — 구현 CLI는 묻지 않는다. '
      + '`/kit setup --cli=codex`로 강제 노출할 수 있다.');
  } else {
    notes.push('Codex는 감지됐지만 모델 목록을 얻지 못했다 — 구현 CLI는 묻지 않는다.');
  }
  const patches = {};
  for (const scope of SCOPES) {
    for (const build of builds) {
      patches[`${scope}|${build}`] = resolveModels({ scope, useCodexForBuild: build === 'codex', choices: codexChoices, cfg });
    }
  }
  const nonDefault = diffFrom(cfg);
  return { rounds: [{ questions, map }], notes, patches,
    current: { isDefault: Object.keys(nonDefault).length === 0, nonDefault } };
}

// modelPlan·GROUPS는 아래층의 것을 **그대로** 다시 내보낸다 — 호출부가 두 파일을 알 필요가 없다.
module.exports = { GROUPS, REASON_RETURNS_BODY, SCOPES, basePlan, modelPlan, resolveModels };
