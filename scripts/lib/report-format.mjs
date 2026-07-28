// verify-evidence의 출력 포매팅. 판정은 하지 않고 이미 나온 판정을 문자열/JSON으로만 바꾼다.
// 분리 이유: DESIGN §3이 "verify-evidence.mjs가 200줄을 넘으면 여기로 뺀다"를 사전에 정해뒀다.
// 형태 방벽(citable·emit)과 그 상수는 emit.mjs가 정본이다 — 두 벌로 두면 방벽이 조용히 죽는다.
import { SEP } from './emit.mjs';

export { emit } from './emit.mjs';

/** 항목이 없으면 '(없음)'을 찍는다 — 빈 섹션은 "검사 안 함"과 구분되지 않는다 */
function section(icon, title, lines) {
  return [`${icon} ${title}${SEP}${lines.length}건`, ...(lines.length > 0 ? lines : ['  (없음)'])];
}

// 위조자 통제 필드(id·ref·missing·escaped·lineDrift·cmd·target)의 길이 상한.
// cmd는 MAX_COMMAND(4096)까지 채울 수 있고, 그대로 찍으면 보고서가 통째로 위조자 통제가 된다.
// 개행도 여기서 죽인다 — 한 행이 여러 줄로 흩어지면 사람이 읽을 수 있는 표가 아니게 된다.
// ⚠ 원문 축약(preview)으로 이 필드들을 덮을 수는 없다 — V4(ref)·V5(cmd)·V8(lineDrift)·
//   V9(--json ref/missing)가 원문 그대로를 사람/기계 판독 계약으로 고정한다.
// export하는 이유: 이 붕괴가 필요한 보간 지점이 formatHuman 밖에도 있다 —
// verify-evidence.mjs의 조기 종료 출구(사이클 헤더)가 cycleId를 그대로 찍는다.
// 같은 프로세스의 stdout이면 같은 상한을 받아야 한다(방벽을 하나 더 만들지 않는다).
export const MAX_FIELD = 120;
export const field = (v) => {
  const s = String(v).replace(/\s/g, ' '); // 문자 단위 치환 — 길이가 보존돼야 총 N자가 정직하다
  return s.length <= MAX_FIELD ? s : `${s.slice(0, MAX_FIELD)}…(총 ${s.length}자)`;
};

const why = (r) => (r.escaped.length > 0
  ? `루트 밖 경로 ${r.escaped.map(field).join(', ')}`
  : `파일 없음 ${r.missing.map(field).join(', ')}`);

// ★ 불변식: preview(q)는 빈 문자열이 아닌 어떤 q도 부분 문자열로 포함하지 않는다.
// 인용 원문을 그대로 찍으면 이 stdout이 bash-receipt에 봉인되고, 다음 실행에서
// checkCitation의 부분 문자열 검사에 걸려 위조가 'cited'로 뒤집힌다(자기입증).
// 총 길이를 같이 내는 이유: 절단본을 원문으로 오해하고 evidence를 여기에 맞추면 안 된다.
// ⚠ "머리를 q.length-1로 자르면 진부분 접두사라 안전하다"는 **틀렸다**(REVIEW 🟡1).
//   접두사가 접미사와 겹치는 주기적 문자열에서 머리와 마커가 이어져 원문이 재조립된다.
//   그래서 결과를 자기검증하고, 걸리면 길이로 보장되는 형태로 떨어뜨린다.
const QUOTE_HEAD = 24;
const mark = (n) => `…(총 ${n}자)`;
function preview(q) {
  const s = String(q).replace(/\s/g, ' '); // 개행 무력화 — 길이는 보존돼야 총 N자가 정직하다
  if (s === '') return mark(0);
  const out = s.slice(0, Math.min(QUOTE_HEAD, s.length - 1)) + mark(s.length);
  // 자기검증. "머리 = 진부분 접두사"만으로는 부족하다 — 머리가 마커와 이어져 원문이 다시
  // 조립되는 주기적 문자열이 있다('…'×7+'(' → 실측으로 uncited → cited 전환까지 재현).
  // 마커 모양을 흉내 낸 인용('(총 6자)')도 같은 자리에서 샌다.
  // 그때는 **원문보다 짧은** 문자열로 떨어뜨린다 — 길이가 모자라면 담을 수 없다.
  return out.includes(s) ? mark(s.length).slice(0, s.length - 1) : out;
}

// 조치를 한 조각 더 단다 — 이제 인용 단위가 "러너가 낸 줄 통째"라, 부분만 붙여넣으면
// 정직한 실행도 uncited가 된다(DESIGN §4: 완화하지 않고 읽을 수 있게 만든다).
const citeWhy = (r) => `인용 ${preview(r.cite.quotes[0])} 를 receipt에서 못 찾음`
  + (r.cite.truncatedNearby ? ' (receipt가 잘려 있어 오탐 가능)' : '')
  // 그 줄 자체가 SEP를 품으면 인용은 조각나고 후보 줄은 안 잘려 영원히 안 맞는다 — 다른 줄을 골라야 한다
  + `${SEP}러너가 낸 줄을 통째로 붙였는지 · 그 줄에 ' · '가 있진 않은지 확인`;

// 한 상태 두 사유. cmd가 없으면 조치는 "실제 실행 명령을 적어라"이고, cmd는 있는데 매칭이
// 0건이면 "그 명령을 그대로 돌리고 다시 검증하라"다. no-receipt의 면죄 문구를 물려주지 않는다.
const noCmdMatchWhy = (r) => (r.cite.cmd === null
  ? 'evidence에 cmd가 없다(또는 토큰이 1개다) — 실제 실행 명령을 그대로 적어라'
  : `cmd "${field(r.cite.cmd)}"로 실행된 receipt가 없다 — 그 명령을 그대로 돌리고 다시 검증하라`);

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
    missing: r.refResult.missing.map(field),
    escaped: r.refResult.escaped.map(field),
    lineDrift: r.refResult.lineDrift.map(field),
    via: r.refResult.via,
  });

/** --json 출력용 객체 */
// --json은 **한 줄로** 찍는다(verify-evidence.mjs). 들여쓰면 각 줄이 `"id": "…",` 형태라
// 위조자 통제 값이 그대로 한 줄이 되어 대조 후보가 된다. 한 줄이면 이 상수 필드가 SEP를
// 실어 그 한 줄이 형태 규칙을 만족한다 — 유효 JSON을 유지하며 indent에 SEP를 넣을 수는 없다.
export function toJson({
  cycle, lcov, lcovPresent, counts, rows,
}) {
  return {
    note: `devkit${SEP}보고이지 차단이 아니다`,
    cycle,
    lcov,
    // 최상위다 — gap-detector가 사람용 문구를 파싱하지 않고 기계 판독으로 옮길 수 있어야 한다
    lcovPresent,
    counts,
    // --json도 같은 stdout이다 — 사람용에 건 상한/개행 무력화를 여기서 풀면 안 된다
    behaviors: rows.map((r) => ({
      id: field(r.id),
      ref: r.ref === null ? null : field(r.ref),
      ...refView(r),
      citation: r.cite.status,
      // --json도 같은 stdout이다 — 원문을 실으면 사람용에서 막은 자기입증이 여기로 샌다
      quotes: r.cite.quotes.map(preview),
      hits: r.cite.hits.map(preview),
      target: r.target === null ? null : field(r.target),
      coverage: r.cov.status,
      uncoveredLines: r.cov.uncoveredLines,
      deadBranches: r.cov.deadBranches,
    })),
  };
}

// lcov 부재는 behavior 단위가 아니라 **실행 단위 사실**이라 "몇 건"이 무의미하다 — 새 카운트도
// no-data 합치기도 아니고 헤더 표기다(DESIGN §3.2). counts 불변·⚠ 섹션 없음·exit 0 불변이
// 게이트 아님을 형태로 보장한다. 늘어나는 건 줄 하나가 아니라 그 줄의 뒷부분이다.
// `=== false`인 이유: 부재는 명시적으로 알려질 때만 말한다(호출자가 안 넘기면 침묵이 기본값).
function covLine(lcov, counts, lcovPresent) {
  const base = counts.noData > 0
    ? `커버리지 no-data: ${counts.noData}건${SEP}${lcov} 기준`
    : `커버리지 출처: ${lcov}`;
  return lcovPresent === false
    ? `${base}${SEP}없음 — 이번 판정에 커버리지가 반영되지 않았다`
    : base;
}

/** 사람용 보고 문자열 */
export function formatHuman({
  cycle, lcov, lcovPresent, counts, groups, receipts,
}) {
  const {
    unresolved, uncited, noCmdMatch, noReceipt, deadBranch, uncovered, drifted, viaArchive,
  } = groups;
  // 행 구분자는 전부 SEP다 — 이중 공백이던 자리를 바꿨다. 사람에게는 읽는 구분자이고
  // 형태 규칙에는 "이 줄은 인용 조각이 될 수 없다"는 증명이다(한 문자열이 두 일을 한다).
  // 요약 4줄은 `devkit${SEP}` 접두로 같은 보장을 받는다.
  const head = `devkit${SEP}`;
  return [
    `${head}evidence 검증 — ${cycle}/`,
    `${head}unresolved: ${counts.unresolved}${SEP}게이트 대상 — >0이면 REPORT.md 쓰기가 차단된다`,
    `${head}uncited: ${counts.uncited} · no-cmd-match: ${counts.noCmdMatch} · no-receipt: ${counts.noReceipt}`
    + ` · uncovered: ${counts.uncovered} · dead-branch: ${counts.deadBranch}${SEP}보고 — 차단 아님`,
    `${head}${covLine(lcov, counts, lcovPresent)}`,
    '',
    ...section('❌', 'unresolved', unresolved.map(
      (r) => `  ${field(r.id)}${SEP}ref "${field(r.ref)}"${SEP}${why(r.refResult)}`,
    )),
    ...section('⚠', 'uncited', uncited.map((r) => `  ${field(r.id)}${SEP}ref ${field(r.ref)}${SEP}${citeWhy(r)}`)),
    ...section('⚠', 'no-cmd-match', noCmdMatch.map(
      (r) => `  ${field(r.id)}${SEP}ref ${field(r.ref)}${SEP}${noCmdMatchWhy(r)}`,
    )),
    ...section('⚠', 'no-receipt', noReceipt.map(
      (r) => `  ${field(r.id)}${SEP}ref ${field(r.ref)}${SEP}${noReceiptWhy(receipts)}`,
    )),
    ...section('⚠', 'dead-branch', deadBranch.map(
      (r) => `  ${field(r.id)}${SEP}target ${field(r.target)}${SEP}BRDA taken=0 @ line ${r.cov.deadBranches.map((d) => d.line).join(', ')}`,
    )),
    ...section('⚠', 'uncovered', uncovered.map(
      (r) => `  ${field(r.id)}${SEP}target ${field(r.target)}${SEP}미실행 라인 ${r.cov.uncoveredLines.join(', ')}`,
    )),
    ...section('ℹ', 'lineDrift (게이트 무관)', drifted.map(
      (r) => `  ${field(r.id)}${SEP}${r.refResult.lineDrift.map(field).join(SEP)}`,
    )),
    ...section('ℹ', 'archive 폴백으로 찾음 (게이트 무관)', viaArchive.map(
      (v) => `  ${field(v.id)}${SEP}${field(v.from)} → ${field(archiveDest(v.from))}`,
    )),
  ].join('\n') + '\n';
}
