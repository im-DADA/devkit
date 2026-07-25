// behaviors.json — 사이클의 behavior 체크리스트.
//
// 왜 JSON인가: 모델이 마크다운보다 JSON을 함부로 덮어쓰지 않는다(Anthropic 관측).
// 핵심은 "전체 재작성이 필요 없는 형식" — 여기서는 passes/evidence 두 필드만 건드린다.
//
// 왜 evidence가 필수인가: 자기가 쓴 설계를 자기가 채점하면 점수가 인플레된다
// (실사용 관측: 40여 사이클에서 90% 미만이 0건). "실행 흔적 없으면 통과로 안 센다"는
// 규칙이 프롬프트 훈계보다 강하다.
const fs = require('node:fs');
const path = require('node:path');
const { classifyRef } = require('./evidence');

const FILE = 'behaviors.json';
const EVIDENCE_KINDS = new Set(['test', 'visual', 'manual']);
const MIN_OUTPUT_LEN = 10; // "통과" 두 글자로 때우는 걸 막는 최소 길이

function nonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/** 실행 흔적으로 인정할 수 있는 evidence인가 */
function isEvidenceValid(ev) {
  if (!ev || typeof ev !== 'object') return false;
  if (!EVIDENCE_KINDS.has(ev.kind)) return false;
  if (!nonEmptyString(ev.ref)) return false;
  // output이 실행 흔적의 본체다. 이 검사가 인플레이션을 막는다.
  if (!nonEmptyString(ev.output) || ev.output.trim().length < MIN_OUTPUT_LEN) return false;
  return true;
}

/**
 * 실제 통과 여부. passes:true라도 증거가 없으면 false로 강등한다.
 * 파일을 고치지 않고 읽는 시점에 판정하는 이유: 파일을 고치면 모델이 다시 true로
 * 되돌린다(무한 왕복). 읽는 쪽이 항상 강등하면 되돌릴 대상이 없다.
 */
function effectivePasses(behavior) {
  if (!behavior || behavior.passes !== true) return false;
  return isEvidenceValid(behavior.evidence);
}

/**
 * 집계. unproven(증거 없는 통과 주장)이 0이어야 게이트를 통과한다.
 * opts.root를 주면 unresolved(증거가 가리키는 파일이 없음)까지 센다.
 * 안 주면 null — 0으로 두면 "검사했고 깨끗하다"와 구분되지 않는다.
 */
function summarize(doc, opts = {}) {
  const list = (doc && Array.isArray(doc.behaviors)) ? doc.behaviors : [];
  const total = list.length;
  const passed = list.filter(effectivePasses).length;
  const unproven = list.filter((b) => b && b.passes === true && !isEvidenceValid(b.evidence)).length;
  // 게이트(gateEvidence)와 같은 분모를 써야 "0이라는데 왜 막히나"가 안 생긴다
  const root = (opts && typeof opts.root === 'string') ? opts.root : null;
  const unresolved = root === null ? null : list.filter(
    (b) => effectivePasses(b) && classifyRef(b.evidence.ref, root).status === 'unresolved',
  ).length;
  // matchRate는 리포트용 신호일 뿐 통과 판정 기준이 아니다
  const matchRate = total === 0 ? 0 : Math.round((passed / total) * 100);
  return {
    total, passed, unproven, unresolved, matchRate,
  };
}

/** 사이클 폴더에서 behaviors.json 읽기. 실패는 전부 null로 degrade */
function readBehaviors(cycleDir) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(cycleDir, FILE), 'utf8');
  } catch {
    return null; // 파일 없음 = 아직 안 만든 사이클. 정상 흐름
  }
  try {
    const doc = JSON.parse(raw);
    if (!doc || !Array.isArray(doc.behaviors)) return null;
    return doc;
  } catch (e) {
    process.stderr.write(`[devkit] behaviors.json 파싱 실패: ${e.message}\n`);
    return null;
  }
}

module.exports = {
  readBehaviors,
  isEvidenceValid,
  effectivePasses,
  summarize,
  FILE,
  EVIDENCE_KINDS,
};
