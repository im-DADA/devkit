// 커버리지 판정 — "evidence가 가리키는 코드를 테스트가 실제로 지나갔는가".
// ref 실존(evidence.js)·인용 대조(receipt.js)와 다른 축이다. 여기서만 도달 불가 분기를 본다.
// 이 파일은 어떤 경우에도 throw하지 않는다 — lcov 부재·파싱 실패는 no-data로 degrade한다.

const fs = require('node:fs');
const path = require('node:path');

function isInt(v) {
  return typeof v === 'string' && /^\d+$/.test(v);
}

/** ENOENT는 정상(커버리지가 가리키는 파일이 이미 없을 수 있다). 그 외 에러만 남긴다 */
function realpathOr(p) {
  try {
    return fs.realpathSync(p);
  } catch (e) {
    if (e.code !== 'ENOENT') process.stderr.write(`[devkit] lcov 경로 정규화 실패 (${p}): ${e.message}\n`);
    return p;
  }
}

const toPosix = (p) => p.split(path.sep).join('/').replace(/^\.\//, '');

/**
 * SF 값을 root 기준 상대 posix 경로로 정규화한다(키 일관성).
 * 실측(node v24.7.0)은 상대경로를 내지만 절대경로도 받는다 — 그때 macOS의
 * /var → /private/var 심볼릭 링크가 섞이면 path.relative가 '../..'로 어긋나므로
 * 원본/realpath 조합을 전부 시도한다.
 */
function toKey(sf, root) {
  const s = sf.trim();
  if (s === '') return null;
  if (!path.isAbsolute(s)) return toPosix(s);

  for (const f of [s, realpathOr(s)]) {
    for (const r of [root, realpathOr(root)]) {
      const rel = path.relative(r, f);
      if (rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)) return toPosix(rel);
    }
  }
  return toPosix(s); // 루트 밖 — 정보를 버리지 않고 원문 그대로 둔다
}

/**
 * lcov 텍스트 → { [relPosixPath]: { lines: {n: hits}, branches: [{line, block, branch, taken}] } }
 * FN/FNDA/LF/LH 등 나머지 레코드는 무시한다. block/branch 인덱스는 저장만 하고 해석하지 않는다.
 */
function parseLcov(text, root) {
  const cov = {};
  if (typeof text !== 'string') return cov;

  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();

    if (line.startsWith('SF:')) {
      const key = toKey(line.slice(3), root);
      cur = key === null ? null : (cov[key] || (cov[key] = { lines: {}, branches: [] }));
      continue;
    }
    if (line === 'end_of_record') { cur = null; continue; }
    if (cur === null) continue;

    if (line.startsWith('DA:')) {
      const [n, hits] = line.slice(3).split(',');
      if (isInt(n) && isInt(hits)) cur.lines[Number(n)] = Number(hits);
      continue;
    }
    if (line.startsWith('BRDA:')) {
      const [ln, block, branch, taken] = line.slice(5).split(',');
      if (!isInt(ln) || !isInt(block) || !isInt(branch)) continue;
      // lcov 표준에서 '-'는 "블록 자체가 미실행". 0과 함께 미실행으로 뭉친다 —
      // 문자열로 남겨두면 dead-branch 판정이 조용히 새어나간다.
      cur.branches.push({
        line: Number(ln),
        block: Number(block),
        branch: Number(branch),
        taken: isInt(taken) ? Number(taken) : 0,
      });
    }
  }
  return cov;
}

/**
 * "파일:라인" | "파일:시작-끝" | "파일"(전체) → {path, from, to}. 해석 불가면 null(=skipped).
 * 콜론 뒤가 식별자(`x.js:handler`)면 라인을 알 수 없다 — 파일 전체로 승격하면
 * 'x.js:handler'라는 없는 경로를 조회해 no-data(=커버리지 미수집)로 오독된다.
 */
function parseTarget(target) {
  if (typeof target !== 'string' || target.trim() === '') return null;
  const s = target.trim();
  const m = /^(.*):(\d+)(?:-(\d+))?$/.exec(s);
  if (m !== null) return { path: toPosix(m[1]), from: Number(m[2]), to: m[3] ? Number(m[3]) : Number(m[2]) };
  if (s.includes(':')) return null; // 콜론 뒤가 식별자 — 라인을 알 수 없다
  return { path: toPosix(s), from: 1, to: Infinity };
}

/**
 * target 범위가 실제로 실행됐는가. 우선순위는 dead-branch > uncovered > covered다.
 * 도달 불가 분기는 조건 라인이 실행되면서(DA hits>0) 분기만 안 타므로(BRDA taken=0),
 * uncovered를 먼저 보면 "테스트를 안 짰네"로 오독된다. 두 목록은 둘 다 반환한다.
 */
function classifyTarget(cov, target) {
  const none = { uncoveredLines: [], deadBranches: [] };
  const t = parseTarget(target);
  // target이 없는 것(기존 사이클)과 커버리지가 없는 것은 다른 사건이다. 뭉치면
  // 과거 behaviors.json 전부가 경고로 보여 보고가 못 쓰게 된다.
  if (t === null) return { status: 'skipped', ...none };

  const file = (cov && typeof cov === 'object') ? cov[t.path] : undefined;
  if (!file) return { status: 'no-data', ...none };
  const inRange = (n) => n >= t.from && n <= t.to;

  const uncoveredLines = Object.keys(file.lines).map(Number)
    .filter((n) => inRange(n) && file.lines[n] === 0)
    .sort((a, b) => a - b);
  const deadBranches = file.branches
    .filter((b) => inRange(b.line) && b.taken === 0)
    .map(({ line, block, branch }) => ({ line, block, branch }));

  let status = 'covered';
  if (deadBranches.length > 0) status = 'dead-branch';
  else if (uncoveredLines.length > 0) status = 'uncovered';

  return { status, uncoveredLines, deadBranches };
}

module.exports = { parseLcov, parseTarget, classifyTarget };
