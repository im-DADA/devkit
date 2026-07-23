// PDCA 사이클 상태 — `.devkit/pdca-state.json` 단일 포인터.
// 훅(UserPromptSubmit·SessionStart)이 "지금 어느 단계인지"를 여기서 읽는다.
// 상태를 못 읽는 것이 대화를 막는 이유가 되면 안 되므로, 모든 실패는 null로 degrade한다.
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 1;
const FILE = path.join('.devkit', 'pdca-state.json');

function statePath(root) {
  return path.join(root, FILE);
}

/** 상태 읽기. 없거나·깨졌거나·모르는 버전이면 null (throw 금지) */
function readState(root) {
  let raw;
  try {
    raw = fs.readFileSync(statePath(root), 'utf8');
  } catch {
    return null; // 파일 없음 = 진행 중 사이클 없음. 정상 흐름
  }
  try {
    const state = JSON.parse(raw);
    if (!state || state.version !== SCHEMA_VERSION) return null;
    return state;
  } catch (e) {
    process.stderr.write(`[devkit] pdca-state 파싱 실패: ${e.message}\n`);
    return null;
  }
}

/** 상태 저장. `.devkit/`이 없으면 만든다 */
function writeState(root, state) {
  const dir = path.join(root, '.devkit');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(statePath(root), JSON.stringify(state, null, 2) + '\n');
}

/** 진행 중인 사이클인가 (완료됐거나 없으면 false) */
function isActive(state) {
  return !!state && state.stage !== 'done';
}

module.exports = { readState, writeState, isActive, statePath, SCHEMA_VERSION };
