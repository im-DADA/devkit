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

const SCHEMA_VERSION = 1;
const FILE = path.join('.devkit', 'pdca-state.json');
const OWN_FIELDS = ['version', 'cycleId', 'stage', 'status'];

function statePath(root) {
  return path.join(root, FILE);
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
    process.stderr.write(`[devkit] pdca-state 파싱 실패: ${e.message}\n`);
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
  if (obj.phase !== undefined || obj.gates !== undefined || obj.cycle !== undefined) {
    return { foreign: 'bkit' };
  }
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

/**
 * D5: behaviors.json 게이트 (소비 시점 차단).
 * /gap·/report가 진입 전에 부른다. 없으면 "먼저 /plan의 behavior 단계 실행"이라고 거부한다.
 * 파일을 만들게 강제하는 대신, 없으면 다음 단계가 안 열리게 한다(spec-kit 패턴).
 */
function gatePrerequisite(cycleDir) {
  const p = path.join(cycleDir, 'behaviors.json');
  if (fs.existsSync(p)) return { ok: true };
  return {
    ok: false,
    reason:
      'behaviors.json이 없다 — /plan의 behavior 목록 단계를 먼저 실행해 분모를 고정하라. ' +
      '이게 없으면 Gap 분석의 대조 기준이 없다.',
  };
}

module.exports = {
  readState,
  writeState,
  isActive,
  gatePrerequisite,
  statePath,
  SCHEMA_VERSION,
};
