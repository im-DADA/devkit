// devkit 설정의 **순수 층** — 기본값·허용값 표·병합 판정. fs·env를 보지 않는다.
//
// 설계: docs/2026-09-21-devkit-config/DESIGN.md §3.1·§4.3·§5.1
//
// ⚠ **이 파일은 node:fs를 require하지 않는다.** verify-classify.js와 같은 계약이고, 이유도
// 같다 — 판정이 fs 뒤에 있으면 "허용값 밖 × 모르는 키 × 부분 객체"의 조합을 임시 홈
// 디렉터리 없이 테스트할 수 없다. test/config.test.mjs의 U5가 fs를 봉인한 프로세스에서
// 이 모듈을 실제로 돌려 그 성질을 **동작으로** 고정한다(소스 문자열 검색이 아니다).
// IO(파일 읽기·경고 출력)는 config.js가 맡는다.

const VERSION = 1;

// 동결은 방어가 아니라 **계약**이다. 병합이 기본값 객체를 건드리면 한 훅의 설정이 다음
// 호출에 새는데, 훅은 프로세스당 1회라 그 버그가 테스트에서만 보인다(U3b가 고정한다).
function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}

const AGENTS = [
  'planner', 'architect', 'code-reviewer', 'feature-builder',
  'tdd-driver', 'gap-detector', 'test-writer', 'report-writer',
];

const DEFAULTS = deepFreeze({
  version: VERSION,
  language: 'auto',
  tone: 'concise-ko',
  format: 'on',
  structure: 'features',
  testing: 'tdd-logic',
  receipts: true,
  formatOnEdit: true,
  guards: {
    level: 'default',
    newDependency: 'ask',
    protectedFiles: { env: 'deny', lockfile: 'ask', git: 'deny', nodeModules: 'ask' },
  },
  pdca: { enabled: true, sensitivity: 'default', defaultTrack: 'Full', docs: 'full' },
  rules: {
    noAny: true, noConsoleLog: true, noEmptyCatch: true,
    tsxLogic: true, naming: true, testNudge: true, maxLines: 200,
  },
  commit: { convention: 'conventional', coAuthoredBy: 'forbid' },
  merge: { strategy: 'squash' },
  verify: {
    kinds: ['typecheck', 'lint'],
    timeouts: { typecheck: 30, lint: 15 },
    tscOnEdit: false,
  },
  models: {
    planner: { model: 'fable', effort: 'max' },
    architect: { model: 'fable', effort: 'max' },
    'code-reviewer': { model: 'opus', effort: 'high' },
    'feature-builder': { model: 'opus', effort: 'medium' },
    'tdd-driver': { model: 'opus', effort: 'medium' },
    'gap-detector': { model: 'sonnet', effort: 'high' },
    'test-writer': { model: 'sonnet', effort: 'medium' },
    'report-writer': { model: 'sonnet', effort: 'low' },
  },
  _appliedAt: null,
});

// 허용값 표. 값이 배열이면 enum, 함수면 술어다. **모델 이름은 열거하지 않는다** —
// 모델명은 바뀌고, 열거하면 그 목록이 낡아 새 모델을 쓰려는 사용자를 막는다(형태만 본다).
const enumOf = (...vals) => vals;
const isBool = (v) => typeof v === 'boolean';
const isNonNegInt = (v) => Number.isInteger(v) && v >= 0;
const isSeconds = (v) => Number.isFinite(v) && v > 0;
const isName = (v) => typeof v === 'string' && v.trim().length > 0 && !/\s/.test(v);
const isEffort = (v) => (typeof v === 'string' && ['low', 'medium', 'high', 'xhigh', 'max'].includes(v))
  || (Number.isInteger(v) && v > 0);
const isKinds = (v) => Array.isArray(v) && v.every((k) => ['typecheck', 'lint'].includes(k));
const isIsoOrNull = (v) => v === null || (typeof v === 'string' && !Number.isNaN(Date.parse(v)));

const SPEC = {
  version: enumOf(VERSION),
  language: enumOf('auto', 'off'),
  tone: enumOf('concise-ko', 'neutral'),
  format: enumOf('on', 'off'),
  structure: enumOf('features', 'components', 'none'),
  testing: enumOf('tdd-logic', 'after', 'off'),
  receipts: isBool,
  formatOnEdit: isBool,
  guards: {
    level: enumOf('strict', 'default', 'minimal'),
    // 'deny'를 주지 않는다 — 2026-09-17에 "Claude가 라이브러리 없는 설계로 몰래 우회"를
    // 유발해 폐기한 값이다. 폐기한 값을 설정으로 되살리면 그 사고가 되돌아온다.
    newDependency: enumOf('ask', 'off'),
    protectedFiles: {
      env: enumOf('deny', 'ask', 'off'),
      lockfile: enumOf('deny', 'ask', 'off'),
      git: enumOf('deny', 'ask', 'off'),
      nodeModules: enumOf('deny', 'ask', 'off'),
    },
  },
  pdca: {
    enabled: isBool,
    sensitivity: enumOf('low', 'default', 'high'),
    defaultTrack: enumOf('Full', 'Quick'),
    // lite는 GAP·REVIEW를 REPORT의 선행조건에서 뺀다. 이 스위치가 정당한 이유와 대가는
    // DESIGN §1-④ 반전 블록에 있다 — 요약하면 **사람이 정하고(SG1이 AI를 막는다)
    // 켜져 있으면 매 세션 보인다(SG2)**. 둘 중 하나라도 없으면 이 값을 열면 안 된다.
    docs: enumOf('full', 'lite'),
  },
  rules: {
    noAny: isBool, noConsoleLog: isBool, noEmptyCatch: isBool,
    tsxLogic: isBool, naming: isBool, testNudge: isBool,
    maxLines: isNonNegInt,
  },
  commit: { convention: enumOf('conventional', 'free'), coAuthoredBy: enumOf('forbid', 'allow') },
  merge: { strategy: enumOf('squash', 'merge', 'rebase') },
  verify: {
    kinds: isKinds,
    timeouts: { typecheck: isSeconds, lint: isSeconds },
    tscOnEdit: isBool,
  },
  models: Object.fromEntries(AGENTS.map((a) => [a, { model: isName, effort: isEffort }])),
  _appliedAt: isIsoOrNull,
};

const clone = (v) => (Array.isArray(v) ? v.slice()
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]))
    : v);

const accepts = (spec, v) => (Array.isArray(spec) ? spec.includes(v) : spec(v));
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * raw의 알려진 키만 out에 덮어쓴다. **틀린 키 하나가 나머지를 버리지 않는다** —
 * 한 글자 오타로 전부 날아가면 사용자가 원인을 못 찾는다.
 * @param at problems 메시지에 쓸 경로 접두(`guards.protectedFiles.` 등)
 */
function mergeInto(out, raw, spec, at, problems) {
  for (const [key, value] of Object.entries(raw)) {
    // ⚠ **프로토타입 체인을 타면 안 된다.** `spec[key]`로 읽으면 `hasOwnProperty`·`toString`
    // 같은 키가 `Object.prototype`의 **함수**를 rule로 가져오고, 아래 `accepts`가 그걸
    // this 없이 호출해 throw한다 → 훅 프로세스가 죽고 **가드가 fail-open된다.**
    // 실측(리뷰 1회차): `{"hasOwnProperty":1}` 한 줄로 bash-guard가 exit 1(차단 실패)이었다.
    // `__proto__`는 더 나쁘다 — 아래 재귀가 `out['__proto__']`에 쓰면서 **전역
    // Object.prototype을 오염**시킨다. 그래서 own key만 rule로 인정한다.
    if (!Object.prototype.hasOwnProperty.call(spec, key)) {
      problems.push(`모르는 키 ${at}${key} — 무시했다`);
      continue;
    }
    const rule = spec[key];
    if (rule === undefined) {
      problems.push(`모르는 키 ${at}${key} — 무시했다`);
      continue;
    }
    // 스펙이 평범한 객체면 한 겹 더 내려간다. 스칼라·배열은 여기서 끝난다(깊이는 스키마가 정한다).
    if (isPlainObject(rule) && !Array.isArray(rule) && typeof rule !== 'function') {
      if (!isPlainObject(value)) {
        problems.push(`${at}${key}는 객체여야 한다 — 기본값 유지`);
        continue;
      }
      mergeInto(out[key], value, rule, `${at}${key}.`, problems);
      continue;
    }
    if (!accepts(rule, value)) {
      // ⚠ **거부한 값의 원문을 싣지 않는다.** 이 문자열은 stderr로 나가고 stderr는
      // bash-receipt에 봉인된다. 사용자가 설정 자리에 토큰을 적어 넣었거나 `.env`를
      // 잘못 두면 그 값이 진단으로 새어 나간다 — secret-guard가 막는 노출이 설정 경로로
      // 우회되는 셈이다. 어느 키가 어떤 타입으로 들어왔는지면 고치기에 충분하다.
      problems.push(`${at}${key}의 값(${typeof value})이 허용값이 아니다 — 기본값 유지`);
      continue;
    }
    out[key] = clone(value);
  }
}

/**
 * 순수. fs·env를 보지 않고 어떤 입력에도 throw하지 않는다.
 *
 * @param raw JSON.parse의 결과(또는 아무것이나)
 * @returns {{config: object, problems: string[]}}
 *   problems가 비어 있으면 입력이 완전히 유효했다는 뜻이다. 비어 있지 않아도 config는 항상 쓸 수 있다.
 */
function mergeConfig(raw) {
  const config = clone(DEFAULTS);
  const problems = [];

  if (raw === undefined) return { config, problems };
  if (!isPlainObject(raw)) {
    problems.push(`설정이 객체가 아니다(${raw === null ? 'null' : typeof raw}) — 전부 기본값`);
    return { config, problems };
  }
  // 미래 스키마를 **부분 해석**하면 틀린 조합이 나온다. 버리는 쪽이 안전하다.
  // ⚠ 단 "적지 않음"과 "다른 값"은 다르다. `version`이 없는 것은 손으로 몇 줄만 적은
  // 부분 설정이고(정상), 그걸 미래 스키마로 취급하면 **설정 전체가 조용히 무시된다.**
  // 거부는 사용자가 **명시적으로 다른 버전을 적었을 때만** 한다.
  if (raw.version !== undefined && raw.version !== VERSION) {
    problems.push(`version이 이 devkit이 모르는 스키마다(아는 값: ${VERSION}) — 전부 기본값`);
    return { config, problems };
  }
  mergeInto(config, raw, SPEC, '', problems);
  return { config, problems };
}

/**
 * 전부 기본값인가.
 *
 * ⚠ 프로덕션 호출부는 아직 없다(테스트와 `/kit setup`의 판단용이다). `session-start`는
 * `models`만 따로 비교하고 `renderSettingsNote`는 항목별로 본다 — 한 판정점으로 모으면
 * "기본값이 아니면 전부 다르다"가 되어 노트가 과하게 붙는다.
 *
 * 키를 세지 않고 직렬화로 비교하는 이유: `clone(DEFAULTS)`와 `DEFAULTS`는 키 순서가 같고,
 * 사용자가 기본값을 그대로 적어 넣은 경우도 "설정 안 함"과 같게 취급해야 한다(U 참조).
 */
function isDefault(config) {
  return JSON.stringify(config) === JSON.stringify(DEFAULTS);
}

module.exports = { VERSION, DEFAULTS, AGENTS, SPEC, mergeConfig, isDefault };
