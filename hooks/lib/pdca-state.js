// PDCA 사이클 상태 — `.devkit/pdca-state.json` 단일 포인터.
// 훅(UserPromptSubmit·SessionStart)이 "지금 어느 단계인지"를 여기서 읽는다.
// 상태를 못 읽는 것이 대화를 막는 이유가 되면 안 되므로, 모든 실패는 null로 degrade한다.
//
// 4필드 포인터: {version, cycleId, stage, status}. nextAction·matchRates·docs는 제거했다
// (각각 PROGRESS.md·behaviors.json·git에서 유도 가능 — bkit의 넓은 상태 JSON이 null로 썩은 교훈).
//
// D6: bkit이 같이 설치되면 AI가 bkit 스키마(cycle/phase/gates)로 상태를 쓴다. "모르는 파일→null"이
// 아니라 "foreign 명시"로 감지해야 훅이 충돌을 경고할 수 있다.
const fs = require('node:fs');
const path = require('node:path');
const { warn } = require('./diag');

const SCHEMA_VERSION = 1;
const FILE = path.join('.devkit', 'pdca-state.json');
const OWN_FIELDS = ['version', 'cycleId', 'stage', 'status'];
// 허용값 집합의 정본. 커맨드 문서가 아니라 여기가 enum의 소스다.
const STAGES = ['plan', 'design', 'do', 'gap', 'review', 'report', 'done'];
const STATUSES = ['in-progress', 'awaiting-approval', 'done'];
const BKIT_KEYS = ['cycle', 'phase', 'gates'];

// docs/{YYYY-MM-DD}-{kebab slug}/(GAP|REPORT).md — 사이클 폴더 안 + 정확한 파일명만.
// 폭을 좁게 잡는 것이 오탐 방지의 1차 방어선이다(벗어나면 차단이 아니라 통과).
const CYCLE_ARTIFACT =
  /(?:^|\/)docs\/(\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*)\/(GAP|REPORT)\.md$/;
const STATE_FILE = /(?:^|\/)\.devkit\/pdca-state\.json$/;

// 사이클 폴더 안의 **모든** 파일(하위 폴더 포함). 진행 중 형태와 아카이브 이동 후 형태 둘 다.
// 위 CYCLE_ARTIFACT와 달리 파일명을 열거하지 않는다 — 여기서 묻는 건 "무엇을 쓰나"가 아니라
// "쓰려는 것이 PDCA 문서인가"라서 폴더 진입 자체가 판정 범위다.
// slug는 `[^/]+` — CYCLE_ID가 유니코드를 허용하므로(`2026-07-24-devkit-재설계`) 여기서도 좁히지 않는다.
const CYCLE_FOLDER_FILE =
  /(?:^|\/)docs\/(?:archive\/\d{4}-\d{2}-\d{2}\/[^/]+|\d{4}-\d{2}-\d{2}-[^/]+)\/(.+)$/;
const DOC_EXT = /\.(?:md|json)$/i;

// cycleId는 `path.join(root, 'docs', cycleId)`의 **경로 조각 한 개**다. 검증이
// "빈 문자열이 아닌 string"뿐이라 개행·`..`·절대경로가 전부 통과했다:
//   - 개행 → verify-evidence의 조기 종료 헤더가 그대로 보간해 대조 후보 줄을 만든다(벡터 A)
//   - `..`·`/` → 사이클 폴더 밖을 판정 대상으로 만든다
// 열거(무엇이 위험한가)가 아니라 형태 강제(무엇만 허용하나)로 좁힌다.
// ⚠ `\w`(ASCII)로 좁히면 실재하는 폴더명이 막힌다 — `2026-07-24-devkit-재설계`·
//   `에이전트-배선-강화`. 이 함수는 pdca-gate가 상태 쓰기를 하드 차단하는 근거라
//   너무 좁히면 정직한 사이클이 멈춘다. 그래서 유니코드 글자/숫자는 허용한다.
const CYCLE_ID = /^[\p{L}\p{N}_.-]+$/u;
const ALL_DOTS = /^\.+$/; // '.'·'..'는 위 집합을 통과하지만 폴더명이 아니라 이동이다
const toPosix = (p) => p.replace(/\\/g, '/'); // Windows 구분자 우회 방지

function statePath(root) {
  return path.join(root, FILE);
}

/**
 * 사이클 산출물 경로 분류. 게이트 대상이면 담당 stage를 돌려준다.
 * 호출자(pdca-gate.js)가 stage만 쓰므로 stage만 돌려준다 — cycleId·artifact는 경로에서 다시 얻을 수 있다.
 * @param {string} filePath 절대/상대 경로(Windows 구분자 허용)
 * @returns {{stage:'gap'|'report'} | null}
 */
function matchCycleArtifact(filePath) {
  if (typeof filePath !== 'string') return null;
  const m = CYCLE_ARTIFACT.exec(toPosix(filePath));
  if (!m) return null;
  return { stage: m[2] === 'GAP' ? 'gap' : 'report' };
}

/**
 * 사이클 폴더에 PDCA 문서(.md/.json)가 아닌 파일을 쓰려는가.
 *
 * 왜 훅인가: 같은 규칙을 안내로 두 번 넣었는데 둘 다 그 상황에 닿지 못했다(실측, 2026-07-29).
 *   - RULES.md 본문 폴더 규약 → 세션에 주입되는 건 `SUMMARY:START~END` 블록뿐이다(D23과 같은 형태)
 *   - pdca-detect의 KICKOFF → 시안·목업은 TRIVIAL_RE로 배제돼 KICKOFF 자체가 안 뜬다
 *     (`"로그인 화면 시안 만들어줘"` → too-short, 긴 형태 → trivial)
 * 경고를 넣은 자리와 그 경고가 필요한 상황이 배타적이라, 경로를 보는 층에서 닫는다.
 *
 * fs를 보지 않는다 — 경로만으로 판정하므로 폴더 존재 여부 오탐이 없다.
 * @param {string} filePath 절대/상대 경로(Windows 구분자 허용)
 * @returns {{ok:true} | {ok:false, name:string, reason:string}}
 */
function gateCycleFolderFile(filePath) {
  if (typeof filePath !== 'string') return { ok: true };
  const m = CYCLE_FOLDER_FILE.exec(toPosix(filePath));
  if (!m) return { ok: true }; // 사이클 폴더 밖 — 과잉차단이 미차단보다 비싸다
  const name = m[1];
  if (DOC_EXT.test(name)) return { ok: true };
  return {
    ok: false,
    name,
    // ⚠ 대안 없는 금지는 교착이다. "어디에 두라"가 빠지면 같은 자리에 재시도만 반복된다.
    reason: [
      `사이클 폴더에는 PDCA 문서(.md/.json)만 둔다 — 막힌 파일: ${name}`,
      '시안·목업 HTML·스크린샷·PNG·데이터 파일은 여기 두면 안 된다.',
      '`docs/`는 보통 gitignore라 git에 안 남고, 완료 후 archive/로 옮겨지면 더 묻힌다.',
      '',
      '→ 프로젝트의 실제 위치에 쓰고, 문서에서는 경로로 참조하라:',
      '  - 시안·목업 HTML  → `design/` 또는 `mockups/`',
      '  - 이미지·스크린샷 → `public/` 또는 `assets/`',
      '  - 테스트 픽스처·데이터 → 그 코드 옆(`test/fixtures/` 등)',
      '  - 그 외 → 실제로 소비하는 코드 옆',
      '그 경로로 다시 Write한 다음, PLAN.md·REPORT.md에서 상대경로로 링크한다.',
    ].join('\n'),
  };
}

/**
 * 상태 읽기.
 * @returns {null | {version,cycleId,stage,status} | {foreign:"bkit"}}
 *   - 우리 것: version:1 + cycleId 문자열 (4필드만 취함)
 *   - foreign: phase/gates/cycle 시그니처 (bkit)
 *   - null: 파일 없음 | 깨진 JSON | 알 수 없는 형태
 */
function readState(root) {
  let raw;
  try {
    raw = fs.readFileSync(statePath(root), 'utf8');
  } catch {
    return null; // 파일 없음 = 진행 중 사이클 없음. 정상 흐름
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    warn(`pdca-state 파싱 실패: ${e.message}`);
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;

  // 양성 시그니처 — 우리 것 (4필드만 취한다)
  if (obj.version === SCHEMA_VERSION && typeof obj.cycleId === 'string') {
    const state = {};
    for (const k of OWN_FIELDS) state[k] = obj[k];
    return state;
  }
  // foreign 시그니처 — bkit
  if (BKIT_KEYS.some((k) => obj[k] !== undefined)) return { foreign: 'bkit' };
  return null;
}

/** 상태 저장. `.devkit/`이 없으면 만든다 */
function writeState(root, state) {
  const dir = path.join(root, '.devkit');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(statePath(root), JSON.stringify(state, null, 2) + '\n');
}

/** 진행 중인 사이클인가. foreign(남의 것)이거나 done이거나 없으면 false */
function isActive(state) {
  if (!state || state.foreign) return false;
  return state.stage !== 'done';
}

/** `.devkit/pdca-state.json`인가 */
function isStateFile(filePath) {
  if (typeof filePath !== 'string') return false;
  return STATE_FILE.test(toPosix(filePath));
}

// 단계별 선행 산출물 (사이클 폴더 기준 상대 파일명). 문서가 아니라 이 상수가 정본이다.
const STAGE_REQUIREMENTS = {
  gap: ['behaviors.json'],
  report: ['behaviors.json', 'GAP.md', 'REVIEW.md'],
};
const MAKER = {
  'behaviors.json': '/plan (behavior 목록 단계)',
  'GAP.md': '/gap',
  'REVIEW.md': '/review',
};
// 차단 안내에 "왜"를 붙이는 이유: 무엇이 없는지만 알려주면 AI가 파일을 빈 껍데기로 만들어 통과시킨다.
const WHY = {
  gap: '이게 없으면 Gap 분석의 대조 기준(분모)이 없다.',
  report:
    'GAP과 REPORT 사이의 review는 필수 단계다. review 결과가 파일로 남지 않아 종합에서\n' +
    '조용히 빠진 사이클에 실제 버그 3건이 남아 있었다(결함로그 D13).',
};

/**
 * 내용이 있는 파일인가. 존재만 보면 `touch REVIEW.md` 한 줄로 게이트가 열린다 —
 * 게이트를 형식적 통과 의식으로 만드는 가장 싼 우회라서 빈 파일은 없는 것으로 본다.
 * 읽기 실패(파일 없음 포함)도 "없다"가 답이다.
 */
function hasContent(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return false;
  }
  return raw.trim().length > 0;
}

/**
 * D5: 단계별 선행조건 게이트 (소비 시점 차단).
 * 파일을 만들게 강제하는 대신, 없으면 다음 단계가 안 열리게 한다(spec-kit 패턴).
 * @param {string} cycleDir 사이클 폴더 절대경로
 * @param {'gap'|'report'} [stage='gap'] 미지정이면 기존 behaviors.json 판정(하위호환)
 * @returns {{ok:true} | {ok:false, missing:string[], reason:string}}
 */
function gatePrerequisite(cycleDir, stage = 'gap') {
  const required = STAGE_REQUIREMENTS[stage];
  if (!required) return { ok: true }; // 게이트를 정의하지 않은 단계는 통과
  const missing = required.filter((f) => !hasContent(path.join(cycleDir, f)));
  if (missing.length === 0) return { ok: true };
  return {
    ok: false,
    missing,
    reason:
      `${stage} 단계 선행조건 미충족 — docs/${path.basename(cycleDir)}/에 없는 파일:\n` +
      missing.map((f) => `  - ${f} → ${MAKER[f]} 로 생성`).join('\n') +
      `\n${WHY[stage]}`,
  };
}

/**
 * 상태 파일 쓰기 검증(4필드 정확 일치 + enum).
 * 위반을 전부 모아서 돌려준다 — 한 번에 다 알려줘야 AI가 1회 재시도로 회복한다.
 * @param {unknown} obj 파싱된 상태 객체
 * @returns {{ok:true} | {ok:false, problems:string[], reason:string}}
 */
function validateStateWrite(obj) {
  const problems = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    problems.push('최상위가 객체가 아니다');
  } else {
    if (obj.version !== SCHEMA_VERSION) {
      problems.push(`version은 ${SCHEMA_VERSION}이어야 한다(현재: ${JSON.stringify(obj.version)})`);
    }
    if (typeof obj.cycleId !== 'string' || !obj.cycleId) {
      problems.push('cycleId(사이클 폴더명)가 없다');
    } else if (!CYCLE_ID.test(obj.cycleId) || ALL_DOTS.test(obj.cycleId)) {
      problems.push(
        'cycleId는 docs/ 아래 폴더명 한 개여야 한다 — 경로 구분자·공백·개행·상위 이동(..) 불가'
        + ` (현재: ${JSON.stringify(obj.cycleId)})`,
      );
    }
    if (!STAGES.includes(obj.stage)) {
      problems.push(`stage 허용값 밖: ${JSON.stringify(obj.stage)} (허용: ${STAGES.join('|')})`);
    }
    if (!STATUSES.includes(obj.status)) {
      problems.push(`status 허용값 밖: ${JSON.stringify(obj.status)} (허용: ${STATUSES.join('|')})`);
    }
    const extra = Object.keys(obj).filter((k) => !OWN_FIELDS.includes(k));
    if (extra.length) {
      const bkit = extra.some((k) => BKIT_KEYS.includes(k)) ? ' — bkit 스키마다' : '';
      problems.push(`허용되지 않은 키: ${extra.join(', ')}${bkit}`);
    }
  }
  if (problems.length === 0) return { ok: true };
  return {
    ok: false,
    problems,
    reason: [
      `${FILE} 스키마 위반:`,
      ...problems.map((p) => `  - ${p}`),
      '정확한 형식(4필드만, 순서 무관):',
      '  {"version":1,"cycleId":"{docs/ 아래 사이클 폴더명}","stage":"gap","status":"in-progress"}',
      `  stage: ${STAGES.join('|')}`,
      `  status: ${STATUSES.join('|')}`,
    ].join('\n'),
  };
}

module.exports = {
  readState,
  writeState,
  isActive,
  gatePrerequisite,
  gateCycleFolderFile,
  matchCycleArtifact,
  isStateFile,
  validateStateWrite,
  statePath,
  SCHEMA_VERSION,
  STAGES,
  STATUSES,
  STAGE_REQUIREMENTS,
  MAKER,
};
