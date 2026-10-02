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
function modelPlan({ agent, cli, choices, meta, ccVersion, offer }) {
  const notes = [];
  if (!AGENTS.includes(agent)) return { rounds: [], notes: ['모르는 단계다 — AGENTS에 없다.'] };
  if (cli === null || cli === undefined) {
    if (GROUPS.returnsBody.includes(agent)) return { rounds: [], notes: [REASON_RETURNS_BODY] };
    // ⚠ `offer`를 **봐야** 한다. 안 보면 Codex가 없는 머신에서도 선택지로 떠서, 고른 뒤에
    //   모델 목록이 비고 그 자리를 즉흥으로 메우게 된다(2026-10-02 리뷰 🔴4).
    //   선택지가 하나로 줄면 문항을 만들지 않는다 — 스키마가 `options` 하한을 2로 잡는다.
    const codexUsable = offer === undefined
      || list(offer).some((o) => o.cli === 'codex' && o.offered === true);
    if (!codexUsable) {
      notes.push('Codex가 감지되지 않아 이 단계는 Claude로 돈다 — `/kit setup --cli=codex`로 강제 노출할 수 있다.');
      return { rounds: [], notes };
    }
    return { rounds: [{ questions: [{ question: `${agent}를 어느 CLI로 돌릴까?`, header: '실행 CLI', multiSelect: false,
      options: [{ label: 'Claude', description: '지금 기본값이다. Claude 구독 사용량을 쓴다.' },
        { label: 'Codex', description: `파일을 쓰는 단계라 Codex 후보다. ${CODEX_USAGE}` }] }],
    map: { '실행 CLI': { Claude: 'claude', Codex: 'codex' } } }], notes };
  }
  const primary = list(isObj(choices) ? choices.primary : null);
  if (str(isObj(meta) ? meta.fetchedAt : null)) notes.push(`목록 시각: ${meta.fetchedAt}`);
  if (isObj(meta) && meta.stale === true) notes.push('낡았을 수 있다 — Claude Code가 다음 실행에서 갱신한다.');
  if (!primary.length) {
    notes.push(str(isObj(meta) ? meta.reason : null) ?? '모델 목록을 얻지 못했다 — 기본 목록으로 보여 준다.');
    return { rounds: [], notes };
  }
  const seen = new Set();
  // 3종 **미만**일 수 있다 — 아래 map이 picked.length를 기준으로 돌아야 한다(고정 3으로 세면 터진다).
  const picked = primary.slice(0, 3);
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
  const derived = effortFor(agent, cli, primary[0]);
  notes.push(derived === undefined
    ? '이 모델은 effort를 쓰지 않는다(카탈로그 기준) — 기존 effort 값을 그대로 둔다.'
    : `effort는 묻지 않는다 — 유도값은 ${derived}이다.`);
  if (cli === 'codex') notes.push(CODEX_RANK);
  if (ccVersion) notes.push(`Claude Code ${ccVersion} 기준으로 표기했다.`);
  return { rounds: [{ questions: [{ question: `${agent}가 쓸 모델은?`, header: '모델', multiSelect: false, options }],
    map: { 모델: Object.fromEntries(options.map((o, i) => [o.label,
      i < picked.length ? str(picked[i].value) ?? str(picked[i].id) ?? '' : 'other'])) } }], notes };
}

module.exports = { GROUPS, REASON_RETURNS_BODY, CODEX_USAGE, CODEX_RANK,
  isObj, str, list, effortFor, uniqueLabel, modelPlan };
