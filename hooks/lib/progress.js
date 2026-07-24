// PROGRESS.md — 사이클의 append-only 저널.
// 컴팩션·세션 종료 후 "어디까지 했나"를 복구하는 재개 정보다. 게이트가 아니다.
//
// 읽기만 여기서 한다. append는 커맨드가 Write로 — 저널 소유권은 커맨드에 있다.
// git이 답할 수 있는 것(무엇이 변했나)은 안 쓰고, "왜 그렇게 판단했나"만 남긴다.
//
// 첫 줄이 정체성 앵커(cycle 경로)다 — 재개 세션이 다른 사이클 저널을 오독하는 것을 막는다.
const fs = require('node:fs');
const path = require('node:path');

const FILE = 'PROGRESS.md';
// "# PROGRESS — docs/2026-07-24-slug/" 형태에서 경로만 뽑는다
const ANCHOR_RE = /^#\s*PROGRESS\s*[—-]\s*(\S.*?)\s*$/;

function readLines(cycleDir) {
  try {
    return fs.readFileSync(path.join(cycleDir, FILE), 'utf8').split('\n');
  } catch {
    return null;
  }
}

/** 첫 줄에서 cycle 경로를 추출. 앵커 형식이 아니거나 파일 없으면 null */
function identityAnchor(cycleDir) {
  const lines = readLines(cycleDir);
  if (!lines || lines.length === 0) return null;
  const m = lines[0].match(ANCHOR_RE);
  return m ? m[1] : null;
}

/** 끝 N줄(앵커·빈 줄 제외). 파일 없으면 빈 배열 */
function tail(cycleDir, n = 10) {
  const lines = readLines(cycleDir);
  if (!lines) return [];
  const body = lines
    .slice(1) // 첫 줄(앵커) 제외
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
  return body.slice(-n);
}

module.exports = { identityAnchor, tail, FILE };
