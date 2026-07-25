// verify-evidence의 출력 포매팅. 판정은 하지 않고 이미 나온 판정을 문자열/JSON으로만 바꾼다.
// 분리 이유: DESIGN §3이 "verify-evidence.mjs가 200줄을 넘으면 여기로 뺀다"를 사전에 정해뒀다.

/** 항목이 없으면 '(없음)'을 찍는다 — 빈 섹션은 "검사 안 함"과 구분되지 않는다 */
function section(icon, title, lines) {
  return [`${icon} ${title}`, ...(lines.length > 0 ? lines : ['  (없음)'])];
}

const why = (r) => (r.escaped.length > 0
  ? `루트 밖 경로 ${r.escaped.join(', ')}`
  : `파일 없음 ${r.missing.join(', ')}`);

// ★ 인용 원문을 그대로 찍으면 이 stdout이 bash-receipt에 봉인되고, 다음 실행에서
// checkCitation의 부분 문자열 검사에 걸려 위조가 'cited'로 뒤집힌다(자기입증).
// 앞머리만 남겨 무엇을 못 찾았는지는 알리되 대조에는 안 걸리게 한다. 총 길이를
// 같이 내는 이유: 절단본을 원문으로 오해하고 evidence를 여기에 맞추면 안 된다.
const QUOTE_HEAD = 24;
const preview = (q) => `${q.slice(0, QUOTE_HEAD)}…(총 ${q.length}자)`;

const citeWhy = (r) => `인용 ${preview(r.cite.quotes[0])} 를 receipt에서 못 찾음`
  + (r.cite.truncatedNearby ? ' (receipt가 잘려 있어 오탐 가능)' : '');

// 봉인 자체가 없는 것과 evidence가 봉인보다 앞선 것은 원인이 달라 조치도 다르다
function noReceiptWhy(receipts) {
  return receipts.present !== true
    ? '.devkit/receipts.jsonl이 없다 — 아직 실행이 봉인되지 않았다'
    : `evidence 시각이 receipt 시작(${receipts.firstDate})보다 앞선다`;
}

// 표시용 재구성이다 — 판정은 evidence.js가 이미 끝냈다(규칙 정본은 거기의 CYCLE_RE).
// 어디로 폴백했는지 안 밝히면 폴백이 조용한 우회처럼 보인다.
const archiveDest = (p) => p.replace(/^docs\/(\d{4}-\d{2}-\d{2})-([^/]+)\//, 'docs/archive/$1/$2/');

// 판정 대상이 아니었던 behavior(작업 중·evidence 무효)는 'unresolved 아님'이 아니라
// 'skipped'다. 0으로 뭉개면 "검사했고 깨끗하다"와 구분되지 않는다.
const refView = (r) => (r.refResult === null
  ? { refStatus: 'skipped', missing: [], escaped: [], lineDrift: [], via: {} }
  : {
    refStatus: r.refResult.status,
    missing: r.refResult.missing,
    escaped: r.refResult.escaped,
    lineDrift: r.refResult.lineDrift,
    via: r.refResult.via,
  });

/** --json 출력용 객체 */
export function toJson({ cycle, lcov, counts, rows }) {
  return {
    cycle,
    lcov,
    counts,
    behaviors: rows.map((r) => ({
      id: r.id,
      ref: r.ref,
      ...refView(r),
      citation: r.cite.status,
      quotes: r.cite.quotes,
      hits: r.cite.hits,
      target: r.target,
      coverage: r.cov.status,
      uncoveredLines: r.cov.uncoveredLines,
      deadBranches: r.cov.deadBranches,
    })),
  };
}

/** 사람용 보고 문자열 */
export function formatHuman({
  cycle, lcov, counts, groups, receipts,
}) {
  const {
    unresolved, uncited, noReceipt, deadBranch, uncovered, drifted, viaArchive,
  } = groups;
  return [
    `evidence 검증 — ${cycle}/`,
    `unresolved: ${counts.unresolved}   (게이트 대상 — >0이면 REPORT.md 쓰기가 차단된다)`,
    `uncited: ${counts.uncited} · no-receipt: ${counts.noReceipt}`
    + ` · uncovered: ${counts.uncovered} · dead-branch: ${counts.deadBranch}   (보고 — 차단 아님)`,
    counts.noData > 0
      ? `커버리지 no-data: ${counts.noData}건 (${lcov} 기준)`
      : `커버리지 출처: ${lcov}`,
    '',
    ...section('❌', 'unresolved', unresolved.map(
      (r) => `  ${r.id}  ref "${r.ref}"  ${why(r.refResult)}`,
    )),
    ...section('⚠', 'uncited', uncited.map((r) => `  ${r.id}  ref ${r.ref}  ${citeWhy(r)}`)),
    ...section('⚠', 'no-receipt', noReceipt.map(
      (r) => `  ${r.id}  ref ${r.ref}  ${noReceiptWhy(receipts)}`,
    )),
    ...section('⚠', 'dead-branch', deadBranch.map(
      (r) => `  ${r.id}  target ${r.target}  BRDA taken=0 @ line ${r.cov.deadBranches.map((d) => d.line).join(', ')}`,
    )),
    ...section('⚠', 'uncovered', uncovered.map(
      (r) => `  ${r.id}  target ${r.target}  미실행 라인 ${r.cov.uncoveredLines.join(', ')}`,
    )),
    ...section('ℹ', 'lineDrift (게이트 무관)', drifted.map(
      (r) => `  ${r.id}  ${r.refResult.lineDrift.join(' · ')}`,
    )),
    ...section('ℹ', 'archive 폴백으로 찾음 (게이트 무관)', viaArchive.map(
      (v) => `  ${v.id}  ${v.from} → ${archiveDest(v.from)}`,
    )),
  ].join('\n') + '\n';
}
