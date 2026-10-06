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
  isObj, str, list, uniqueLabel, modelPlan, applyFor, acceptCodexModel } = require('./setup-plan-model');

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

/** 두 번째 문항 — 모델을 **선택지로 쪼갠다.** `priority` 1위를 말없이 집던 것이 2026-10-02
 *  첫 실사용에서 사용자가 원한 모델과 달랐다(목록 1위는 "일상용 범용"이었고 사용자는 "가장
 *  어려운 일"용을 원했다). 순서는 목록 그대로 쓰되 **서열이라고 말하지 않고** 판단 근거를
 *  실어 사용자가 고른다. 선택지는 Claude 1 + 모델 ≤2 + 그 외 1 = **최대 4칸**이고, 그 2는
 *  스키마의 `options` 상한에서 유도된 수다 — 더 넣으면 도구가 문항을 거부한다. */
function buildQuestion(usable) {
  const seen = new Set();
  const first = uniqueLabel('Claude 기본값 유지', 'claude', seen);
  const options = [{ label: first, description: `지금과 같다 — ${AGENTS.length}단계 모두 Claude Code로 돈다. `
    + `본문을 반환하는 ${GROUPS.returnsBody.length}종은 어느 쪽에서도 Codex 후보가 아니다.` }];
  const map = { [first]: 'claude' };
  for (const { id, choice } of usable) {
    const rec = str(choice && choice.recommendedEffort);
    const label = uniqueLabel(str(choice && choice.label) ?? id, id, seen);
    options.push({ label, description: [str(choice && choice.description) ?? id,
      rec ? `권장 effort ${rec}` : null, 'Codex로 돈다(Codex 계정 사용량).'].filter(Boolean).join(' · ') });
    map[label] = `codex:${id}`;
  }
  const other = uniqueLabel('그 외 — 직접 적는다', 'other', seen);
  options.push({ label: other, description: '목록에 없는 Codex 모델 이름을 받는다. 세션 모델을 따라가려면'
    + '(inherit) `/kit setup models`에서 그 단계를 Claude로 두고 거기서 적는다 — Codex 단계에는 뜻이 없다.' });
  map[other] = 'other';
  return { question: `파일을 쓰는 ${GROUPS.writesFiles.length}단계를 무엇으로 돌릴까? `
      + '(목록 순서는 품질 서열이 아니다 — 설명과 권장 effort를 보고 고른다)',
    header: '구현 CLI', multiSelect: false, options, map };
}

/** 한 조합의 부분 설정. `_appliedAt`·`version`은 담지 않는다.
 *  ⚠ **최소 diff가 아니다** — scope 패치는 `cfg`를 보지 않으므로 이미 같은 값이어도 다시 싣는다.
 *  무해하지만(mergeConfig가 같은 값으로 병합한다) 그렇게 적어 둔다(2026-10-02 리뷰 🟡3). */
function resolveModels({ scope, codexModel, choices, cfg }) {
  const notes = [];
  // ⚠ `SCOPE_PATCH[scope]`로 바로 꺼내면 **프로토타입 체인을 탄다** — `scope:'toString'`이면
  //   함수를 찾아 patch가 문자열이 되고 `'valueOf'`면 throw한다(2026-10-02 리뷰 🔴3).
  //   순수층의 무throw는 이 사이클이 계약으로 못박은 것이고 이 함수는 export돼 있다.
  const patch = (SCOPES.includes(scope) ? SCOPE_PATCH[scope] : SCOPE_PATCH.default)();
  // 선택지와 patch가 **같은 게이트**(acceptCodexModel)를 지난다 — "고를 수 있는데 patch가
  // 없는" 상태나 그 반대가 구조적으로 생길 수 없다.
  const id = acceptCodexModel(codexModel);
  if (id) {
    const choice = findChoice(choices, id);
    patch.models = applyFor('codex', GROUPS.writesFiles, id, choice);
    // effort를 모른다는 것은 **모델의 성질**이지 agent마다 다르지 않다 — 한 번만 적는다.
    if (!str(choice && choice.recommendedEffort)) {
      notes.push('이 모델은 effort를 쓰지 않는다(카탈로그 기준) — 기존 effort 값을 그대로 둔다.');
    }
    notes.push(CODEX_USAGE, CODEX_RANK);
  } else if (Object.keys(diffFrom(cfg)).length) {
    notes.push('지금 설정에 바꿔 둔 단계가 있다 — 마법사는 되돌리지 않는다. '
      + '되돌리려면 `/kit setup models` 또는 설정 파일을 직접 고친다.');
  }
  return { patch, notes };
}

/**
 * 설정 파일 **원문**과 이번 patch를 합친다. ⚠ `models`를 **한 겹 더 깊게** 합치는 것이 본체다 —
 * 얕게 합치면 이번에 고르지 않은 단계의 항목이 말없이 지워진다(2026-10-02 Gap: 직전 사이클의
 * 데이터 손실이 한 층 아래에서 재발하는 형태다).
 *
 * ⚠ **`loadConfig()`의 결과를 넣지 마라.** 그것은 기본값을 채운 값이라 그대로 쓰면
 *   "기본값 전체를 적어 넣기"가 되어 나중에 devkit 기본값이 바뀌어도 그 사용자만 옛 값에 묶인다.
 *   반드시 **파일에서 읽은 원문**을 넘긴다.
 * @returns 새 설정 객체. 입력 둘 다 바꾸지 않는다.
 */
function mergeConfigFile(existing, patch) {
  const base = isObj(existing) ? existing : {};
  const add = isObj(patch) ? patch : {};
  const out = { ...base, ...add, version: 1 };
  // ⚠ **한 겹 더 깊게 합친다.** 얕게 두면 `엄격`(`{guards:{level:'strict'}}`)이 사용자의
  //   `guards.newDependency`·`protectedFiles`를, `최소 간섭`이 `pdca`·`rules`의 나머지를
  //   **말없이 지운다**(2026-10-02 Gap 4회차가 실행으로 확인했다). `models`만의 문제가 아니었다.
  //   두 겹까지만 합친다 — `SPEC`의 가장 깊은 중첩이 `guards.protectedFiles.env`·
  //   `verify.timeouts.lint`로 **세 단계**이고, 그 셋째 단계는 patch가 통째로 주는 잎이다.
  for (const key of Object.keys(out)) {
    const b = base[key]; const a = add[key];
    if (isObj(b) && isObj(a)) out[key] = { ...b, ...a };
  }
  return out;
}

/** 목록에서 id로 Choice를 찾는다. ⚠ **키 룩업을 쓰지 않는다** — `toString`·`valueOf` 같은
 *  값이 오면 프로토타입에서 **함수**를 찾아 Choice인 척하는 값이 흘러간다.
 *  ⚠ 2026-10-02 정정: 처음에 "관측 불가능"이라 적었는데 **과장이었다**(Gap이 반증했다).
 *    프로토타입 체인 키(`toString` 등)에서는 하류가 함수를 걸러 출력이 같지만,
 *    **배열 인덱스형 id(`'0'`)에서는 다르다** — 키 룩업이면 `primary[0]`을 찾아 **엉뚱한 모델의
 *    권장 effort를 지어 붙인다.** 그 자리를 S28이 핀으로 고정한다. */
function findChoice(choices, id) {
  return list(isObj(choices) ? choices.primary : null)
    .find((c) => (str(c.value) ?? str(c.id)) === id) ?? null;
}

/** 고를 수 있는 Codex 모델 — 상한 2는 스키마의 `options` 4칸에서 유도된다(Claude 1 + 모델 N + 그 외 1). */
function usableCodex(choices) {
  return list(isObj(choices) ? choices.primary : null)
    .map((c) => ({ id: acceptCodexModel(str(c.value) ?? str(c.id)), choice: c }))
    .filter((x) => x.id !== null).slice(0, 2);
}

function basePlan({ offer, codexChoices, cfg, customModel }) {
  const notes = [];
  const questions = [scopeQuestion()];
  const map = { '설정 범위': { '기본값 그대로': 'default', '최소 간섭': 'minimal', 엄격: 'strict', '직접 고르기': 'pick' } };
  const codex = list(offer).find((o) => o.cli === 'codex') ?? null;
  const usable = usableCodex(codexChoices);
  const builds = ['claude'];
  if (codex && codex.offered === true && usable.length) {
    const q = buildQuestion(usable);
    questions.push({ question: q.question, header: q.header, multiSelect: q.multiSelect, options: q.options });
    map[q.header] = q.map;
    // 키의 build 조각은 **map이 돌려주는 값 그대로**다 — 커맨드의 조립과 조회가 같은 글자를 쓴다.
    for (const v of Object.values(q.map)) if (v !== 'claude' && v !== 'other') builds.push(v);
    // ⚠ custom은 **문항에 선택지를 더하지 않는다** — 5칸이 되면 스키마가 문항을 거부한다.
    //   키만 더해서 `그 외`로 받은 이름이 완성된 patch를 갖게 한다.
    const extra = acceptCodexModel(customModel);
    if (extra && !builds.includes(`codex:${extra}`)) builds.push(`codex:${extra}`);
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
      patches[`${scope}|${build}`] = resolveModels({ scope,
        codexModel: build.startsWith('codex:') ? build.slice('codex:'.length) : null,
        choices: codexChoices, cfg });
    }
  }
  const nonDefault = diffFrom(cfg);
  return { rounds: [{ questions, map }], notes, patches,
    current: { isDefault: Object.keys(nonDefault).length === 0, nonDefault } };
}

// modelPlan·GROUPS는 아래층의 것을 **그대로** 다시 내보낸다 — 호출부가 두 파일을 알 필요가 없다.
// acceptCodexModel을 아래층에서 **그대로 다시 내보낸다** — 호출부가 두 파일을 알 필요가 없다.
module.exports = { GROUPS, REASON_RETURNS_BODY, SCOPES, basePlan, modelPlan, resolveModels,
  acceptCodexModel, mergeConfigFile };
