// 직전 실행의 진단 키 집합. IO 경계 — 차분 계산은 verify-delta.js(순수)가 한다.
//
// 무효화는 임계치 추측이 아니라 **fingerprint**로 한다. 브랜치 전환·mode 전환·스크립트/러너
// 교체·tsconfig/의존성 변경은 전부 "지형이 바뀐 사건"이라 기준선을 버려야 하는데,
// 건수로 짐작하는 대신 원인을 직접 본다.
//
// ⚠ 부분 저장을 절대 하지 않는다. 상한을 넘으면 keys를 통째로 버리고 overflow만 남긴다 —
// "저장 안 된 키"와 "없어진 키"가 구분 불가해지면 **거짓 new**가 생긴다.
// 설계 근거: docs/2026-08-12-scoped-verification/DESIGN.md 결정 6
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = 'devkit-verify-baseline/1';
const BASELINE_MAX_KEYS = 5000;

const filePath = (root) => path.join(root, '.devkit', 'verify-baseline.json');

function statPart(p) {
  try {
    const s = fs.statSync(p);
    return `${s.size}:${Math.round(s.mtimeMs)}`;
  } catch {
    return '-';
  }
}

/**
 * ⚠ 여기서 mtime을 쓰는 건 A의 "러너 감지에 mtime 금지"와 모순이 아니다. A가 금지한 건
 * **판정**이 파일시각에 의존하는 것이고, 여기 mtime은 "세상이 바뀌었으니 기준선을 버린다"는
 * **안전 방향 트리거**다. 틀리면 기준선을 한 번 더 잡을 뿐이다.
 *
 * commit sha는 넣지 않는다 — 커밋할 때마다 기준선이 날아가 전문이 다시 쏟아진다.
 */
function fingerprintOf(root, meta = {}, branch = '') {
  const cfg = ['tsconfig.json', 'package.json', 'pnpm-lock.yaml', 'yarn.lock', 'package-lock.json', 'bun.lockb']
    .map((n) => statPart(path.join(root, n)))
    .join(',');
  return [
    `branch=${branch}`,
    `mode=${meta.mode || ''}`,
    `script=${meta.script || ''}`,
    `runner=${meta.runner || ''}`,
    `cfg=${cfg}`,
  ].join('|');
}

function readAll(root) {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath(root), 'utf8'));
    if (!raw || raw.schema !== SCHEMA || !raw.kinds) return null; // 버전 불일치 = 읽기 실패
    return raw;
  } catch {
    return null;
  }
}

/** @returns {{keys:string[], total:number, notice?:object}|null} null이면 "기준선 없음"(폴백) */
function readBaseline(root, kind, fingerprint) {
  const all = readAll(root);
  const entry = all && all.kinds[kind];
  if (!entry || entry.overflow || !Array.isArray(entry.keys)) return null;
  if (fingerprint !== undefined && entry.fp !== fingerprint) return null; // 지형이 바뀌었다
  return entry;
}

/** @returns {boolean} 실패해도 throw하지 않는다 — 기준선을 못 남기는 건 다음 턴에 한 번 더 말하는 것뿐 */
function writeBaseline(root, kind, entry) {
  const all = readAll(root) || { schema: SCHEMA, kinds: {} };
  const keys = Array.isArray(entry.keys) ? entry.keys : [];
  all.kinds[kind] = keys.length > BASELINE_MAX_KEYS
    ? { fp: entry.fp, at: entry.at, notice: entry.notice, overflow: true, total: entry.total ?? keys.length }
    : { fp: entry.fp, at: entry.at, notice: entry.notice, keys, total: entry.total ?? keys.length };

  const p = filePath(root);
  const tmp = `${p}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(all));
    fs.renameSync(tmp, p); // 부분 쓰기가 남지 않게 한 번에 교체
    return true;
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch { /* 정리 실패는 무시 */ }
    return false;
  }
}

module.exports = { fingerprintOf, readBaseline, writeBaseline, BASELINE_MAX_KEYS, SCHEMA };
