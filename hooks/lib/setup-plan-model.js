// `/kit setup`의 **단계 하나**에 대한 문항 — 실행 CLI와 모델. effort는 묻지 않는다.
//
// 설계: docs/2026-10-01-wizard-question-budget/DESIGN.md §1.4·§1.7·§3
//
// ⚠ 이 파일은 `setup-plan.js`의 **아래층**이다(setup-plan → 이 파일, 역방향 없음).
//    DESIGN §1.7은 의존을 반대로 적었는데 그대로 두면 순환이 된다 — 공유 상수(GROUPS 등)를
//    이 아래층에 두고 위층이 가져다 쓰는 쪽으로 뒤집었다. 그 사실은 PROGRESS에 적었다.
//
// ⚠ 순수 — fs·os·path·process를 보지 않고 **로드 시에도 어떤 입력에도 throw하지 않는다**.
const { AGENTS, DEFAULTS } = require('./config-schema');

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v !== '' ? v : null);
const list = (v) => (Array.isArray(v) ? v.filter(isObj) : []);

/** Codex 후보는 **파일을 직접 쓰는 단계뿐**이다 — 나머지 5종은 본문을 반환하고 파일 쓰기는
 *  커맨드가 하는 계약이라, `codex exec`가 마크다운 본문을 온전히 담는지 검증되지 않았다. */
/** Claude 기본 배분에 쓰이는 이름들 — Codex 단계로 새면 안 된다. **유도**다(열거 아님). */
const CLAUDE_NAMES = [...new Set(Object.values(DEFAULTS.models).map((m) => m.model))];

const WRITES_FILES = ['feature-builder', 'tdd-driver', 'test-writer'];
const GROUPS = Object.freeze({
  writesFiles: Object.freeze(AGENTS.filter((a) => WRITES_FILES.includes(a))),
  returnsBody: Object.freeze(AGENTS.filter((a) => !WRITES_FILES.includes(a))),
});
const REASON_RETURNS_BODY = '이 단계는 **본문을 반환**하고 파일 쓰기는 커맨드가 한다 — '
  + '`codex exec`가 마크다운 본문을 온전히 담는지 검증하지 않아 Codex 후보가 아니다.';
const CODEX_USAGE = 'Codex 실행은 Codex 계정의 사용량을 쓴다(Claude 구독과 별 축이다).';
const CODEX_RANK = '목록 상위 1종을 제안한 것이며 품질 서열 보장은 없다 — 바꾸려면 `/kit setup models`.';

/** 같은 label이 둘이면 답을 intent로 되돌릴 수 없다. 충돌할 때만 값을 덧붙인다. */
function uniqueLabel(label, value, seen) {
  const base = str(label) ?? str(String(value ?? '')) ?? '(이름 없음)';
  // ⚠ 접미를 한 번만 붙이면 **그것이 또 겹칠 수 있다** — `A`·`A (2)`·`A`가 오면 두 번째와
  //   세 번째가 같은 label이 되어 map 키가 하나 줄고 사용자의 답이 다른 모델로 번역된다
  //   (2026-10-02 리뷰 🔴2). 비어 있는 자리를 찾을 때까지 넓힌다.
  let out = base;
  for (let n = 2; seen.has(out); n += 1) out = n === 2 ? `${base} (${value})` : `${base} (${value}·${n})`;
  seen.add(out);
  return out;
}

/** effort 유도 — Claude는 devkit의 설계 의도를, Codex는 카탈로그의 권장값을 따른다.
 *  ⚠ Claude에 `recommendedEffort`를 쓰면 안 된다 — opus의 권장값은 `medium`이라
 *  `planner`의 `max`가 조용히 내려가고 "계획은 가장 비싼 판단"이라는 설계가 뒤집힌다. */
function effortFor(agent, cli, choice) {
  if (cli === 'claude') return DEFAULTS.models[agent]?.effort;
  if (cli !== 'codex') return undefined;
  // 모르면 **지어내지 않는다** — 키를 빼면 mergeConfig가 기존 값을 유지한다.
  return str(isObj(choice) ? choice.recommendedEffort : null) ?? undefined;
}

/** 한 단계의 cli·model 문항. **effort는 묻지 않는다.** 두 번 불러 합쳐도 2라운드다. */
function modelPlan({ agent, cli, choices, meta, ccVersion, offer, customModel, codexHasModels }) {
  const notes = [];
  if (!AGENTS.includes(agent)) return { rounds: [], notes: ['모르는 단계다 — AGENTS에 없다.'] };
  if (cli === null || cli === undefined) {
    if (GROUPS.returnsBody.includes(agent)) return { rounds: [], notes: [REASON_RETURNS_BODY] };
    // ⚠ `offer`를 **봐야** 한다. 안 보면 Codex가 없는 머신에서도 선택지로 떠서, 고른 뒤에
    //   모델 목록이 비고 그 자리를 즉흥으로 메우게 된다(2026-10-02 리뷰 🔴4).
    //   선택지가 하나로 줄면 문항을 만들지 않는다 — 스키마가 `options` 하한을 2로 잡는다.
    // ⚠ `codexHasModels`는 호출자가 **"모델 문항을 낼 수 있나"**를 알려 주는 축이다 — 감지만
    //   보면 목록이 비었을 때 라운드 2가 빈 손이라 **막다른 길**이 된다. `round1`이 같은 기준을
    //   쓰는데 이 분기만 안 썼다(Gap 5회차: 조치가 형제 경로 한쪽만 닫았다).
    const usable = offer === undefined
      || list(offer).some((o) => o.cli === 'codex' && o.offered === true);
    const codexUsable = usable && codexHasModels !== false;
    if (!codexUsable) {
      notes.push(usable
        ? 'Codex 모델 목록이 비어 이 단계는 Claude로 돈다 — 그 CLI의 모델 문항을 낼 수 없다.'
        : 'Codex가 감지되지 않아 이 단계는 Claude로 돈다 — `/kit setup --cli=codex`로 강제 노출할 수 있다.');
      return { rounds: [], notes };
    }
    return { rounds: [{ questions: [{ question: `${agent}를 어느 CLI로 돌릴까?`, header: '실행 CLI', multiSelect: false,
      options: [{ label: 'Claude', description: '지금 기본값이다. Claude 구독 사용량을 쓴다.' },
        { label: 'Codex', description: `파일을 쓰는 단계라 Codex 후보다. ${CODEX_USAGE}` }] }],
    map: { '실행 CLI': { Claude: 'claude', Codex: 'codex' } } }], notes };
  }
  const built = modelOptions({ cli, choices, meta, ccVersion, question: `${agent}가 쓸 모델은?` });
  notes.push(...built.notes);
  if (!built.round) return { rounds: [], notes };
  const derived = effortFor(agent, cli, built.choiceOf(built.ids[0]));
  notes.push(derived === undefined
    ? '이 모델은 effort를 쓰지 않는다(카탈로그 기준) — 기존 effort 값을 그대로 둔다.'
    : `effort는 묻지 않는다 — 유도값은 ${derived}이다.`);
  const agents = cli === 'codex' ? GROUPS.writesFiles : [agent];
  const apply = {};
  for (const id of built.ids) apply[id] = applyFor(cli, agents, id, built.choiceOf(id));
  // ⚠ `그 외`로 받은 이름도 **여기** 들어와야 한다 — 없으면 한 단계 경로에서 커맨드가
  //   `apply[<이름>]`을 꺼내 `undefined`를 받고 금지된 effort 계산으로 메운다(2026-10-02 리뷰 🔴5).
  addCustom(apply, { cli, agents, custom: customModel, choiceOf: built.choiceOf });
  return { rounds: [built.round], notes, apply };
}

/** Codex 모델 id로 받아들일 수 있는 값인가. **카탈로그 경로와 사용자 입력 경로가 같은 게이트를 쓴다.**
 *  `inherit`은 `cli:'codex'`에서 뜻이 없고(스키마는 받지만 조합이 미검증이다), Claude 이름은
 *  폴백이 Codex 단계로 새는 경로라 막는다. 목록은 **열거하지 않고 DEFAULTS에서 유도**한다. */
function acceptCodexModel(value) {
  const id = str(value);
  if (id === null || /\s/.test(id) || id === 'inherit' || /^claude-/.test(id)) return null;
  // ⚠ `Object.prototype`의 이름을 **게이트에서** 막는다. 통과시키면 `apply[id] = …`가 own 키를
  //   만들지 않거나 프로토타입을 바꿔서 `Object.keys`·`JSON.stringify`에서 **조용히 사라진다**
  //   — 커맨드는 JSON 경계로 읽으므로 "그 단계는 건너뜀"으로 오독한다. 두 호출 경로가 각자
  //   다른 방식(`!apply[x]` vs `hasOwnProperty`)으로 막으려 해서 **서로 갈렸다**(Gap 5회차).
  if (PROTO_NAMES.includes(id)) return null;
  return CLAUDE_NAMES.includes(id) ? null : id;
}

/** `Object.prototype`에서 상속되는 이름 — 모델 id로 받으면 `apply` 객체가 망가진다. */
const PROTO_NAMES = Object.freeze(Object.getOwnPropertyNames(Object.prototype));

/** `그 외`로 받은 이름을 `apply`에 더한다. **`modelPlan`과 `forCli`가 같은 함수를 쓴다** —
 *  두 자리에 두면 판정이 갈린다(Gap 5회차에 실제로 갈렸다). `acceptCodexModel`이 프로토타입
 *  이름을 이미 걸렀으므로 여기서는 own 키만 보면 된다. */
function addCustom(apply, { cli, agents, custom, choiceOf }) {
  if (cli !== 'codex') return apply;
  const id = acceptCodexModel(custom);
  if (id === null || Object.prototype.hasOwnProperty.call(apply, id)) return apply;
  apply[id] = applyFor(cli, agents, id, choiceOf(id));
  return apply;
}

/** 한 CLI·한 모델의 **단계별 적용 데이터**. effort를 모르면 **키 자체를 뺀다.** */
function applyFor(cli, agents, model, choice) {
  const out = {};
  // agents는 AGENTS/GROUPS 유래라 사용자 키가 아니다 — 방어 변환이 필요 없다.
  for (const agent of Array.isArray(agents) ? agents : []) {
    const effort = effortFor(agent, cli, choice);
    out[agent] = effort === undefined ? { cli, model } : { cli, model, effort };
  }
  return out;
}

/** 모델 문항 하나를 만든다 — `modelPlan`과 `stagesPlan`이 **같은 빌더**를 쓴다(규약이 한 자리에). */
function modelOptions({ cli, choices, meta, ccVersion, question }) {
  const notes = [];
  const primary = list(isObj(choices) ? choices.primary : null);
  if (str(isObj(meta) ? meta.fetchedAt : null)) notes.push(`목록 시각: ${meta.fetchedAt}`);
  if (isObj(meta) && meta.stale === true) notes.push('낡았을 수 있다 — Claude Code가 다음 실행에서 갱신한다.');
  const usable = cli === 'codex' ? primary.filter((c) => acceptCodexModel(str(c.value) ?? str(c.id))) : primary;
  if (!usable.length) {
    notes.push(str(isObj(meta) ? meta.reason : null) ?? '모델 목록을 얻지 못했다 — 기본 목록으로 보여 준다.');
    return { round: null, ids: [], choiceOf: () => null, notes };
  }
  const seen = new Set();
  // 3종 **미만**일 수 있다 — map이 picked.length를 기준으로 돌아야 한다(고정 3으로 세면 터진다).
  const picked = usable.slice(0, 3);
  const options = picked.map((c) => {
    const min = str(c.minVersion);
    const alias = str(c.family) !== null && c.value === c.family;
    // alias는 하위 세대로 **동작하므로** 차단 경고를 붙이지 않는다. id 고정만 막힌다.
    const ver = !min ? '' : alias ? `ⓘ 최신 세대는 Claude Code ${min} 이상 — 지금은 쓸 수 있는 세대로 동작한다.`
      : `⚠ Claude Code ${min} 이상 필요 — claude update.`;
    const rec = str(c.recommendedEffort);
    return { label: uniqueLabel(c.label, c.value, seen),
      // 조각을 ` · `로 끊는다 — 공백만으로 이으면 네 조각이 한 문장처럼 읽힌다.
      description: [str(c.description) ?? str(c.id), rec ? `권장 effort ${rec}` : null,
        str(c.notice), str(ver)].filter(Boolean).join(' · ') };
  });
  options.push({ label: uniqueLabel('그 외 — 직접 적는다', 'other', seen), description: '전체 목록을 평문으로 보여주고 이름을 받는다.' });
  if (cli === 'codex') notes.push(CODEX_RANK);
  if (ccVersion) notes.push(`Claude Code ${ccVersion} 기준으로 표기했다.`);
  const ids = picked.map((c) => str(c.value) ?? str(c.id) ?? '');
  return {
    round: { questions: [{ question, header: '모델', multiSelect: false, options }],
      map: { 모델: Object.fromEntries(options.map((o, i) => [o.label, i < picked.length ? ids[i] : 'other'])) } },
    ids,
    // 키 룩업을 쓰지 않는다 — 프로토타입 체인 키가 들어오면 함수를 찾아 터진다.
    choiceOf: (id) => picked.find((c) => (str(c.value) ?? str(c.id)) === id) ?? null,
    notes,
  };
}

module.exports = { addCustom, GROUPS, REASON_RETURNS_BODY, CODEX_USAGE, CODEX_RANK, CLAUDE_NAMES,
  isObj, str, list, effortFor, uniqueLabel, modelPlan, modelOptions, applyFor, acceptCodexModel };
