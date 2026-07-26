// verify-evidence의 출력 포매팅. 판정은 하지 않고 이미 나온 판정을 문자열/JSON으로만 바꾼다.
// 분리 이유: DESIGN §3이 "verify-evidence.mjs가 200줄을 넘으면 여기로 뺀다"를 사전에 정해뒀다.

/** 항목이 없으면 '(없음)'을 찍는다 — 빈 섹션은 "검사 안 함"과 구분되지 않는다 */
function section(icon, title, lines) {
  return [`${icon} ${title}`, ...(lines.length > 0 ? lines : ['  (없음)'])];
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

// ★ 불변식(출력 경로 전체): 이 보고서의 어떤 줄도 ✔/✓로 시작하지 않는다.
// 이 stdout은 bash-receipt가 봉인하고, 대조는 '✔로 시작하는 줄'에서만 일어난다
// (citation.js tickLines). 그래서 보고서가 자기입증 채널이 되는 조건은 정확히 하나 —
// 이 출력에 그 형태의 줄이 생기는 것이다.
//
// ⚠ 이 불변식을 **필드 함수에 걸었던 두 번의 시도는 둘 다 샜다**: preview는 quotes/hits만
//   덮어 cmd로 샜고, field는 개행만 죽여 id로 샜다. 후자가 근거로 삼은
//   "모든 필드는 줄 선두가 아니다"는 거짓이었다 — 각 행이 `  ${field(r.id)}  …` 형태라
//   id가 줄의 첫 non-space 문자이고 대조식은 앞 공백을 허용한다(개행이 필요 없었다).
//   그래서 세 번째 처방은 규칙을 더 얹지 않고 **조건을 좁힌다**: 어느 필드가 어느 자리에
//   놓이는지를 세는 대신, 완성된 문자열을 줄 단위로 훑어 불변식을 직접 강제한다.
//   채널이 늘어도, 새 섹션이 생겨도 안 깨진다.
// 포기한 것: 보고서는 앞으로 ✔로 시작하는 줄을 **정상적으로도** 낼 수 없다. 지금 그런 줄은
//   없고(섹션 머리글은 ❌/⚠/ℹ), 낼 이유도 없다 — 이 출력은 테스트 러너가 아니다.
// 대조식보다 한 칸 넓게 잡는다(뒤따르는 공백을 요구하지 않는다) — 방어는 넓은 쪽이 안전하다.
const TICK_AT_LINE_START = /^(\s*)[✔✓]/;
const detick = (text) => text.split('\n')
  .map((line) => line.replace(TICK_AT_LINE_START, '$1·'))
  .join('\n');

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

const citeWhy = (r) => `인용 ${preview(r.cite.quotes[0])} 를 receipt에서 못 찾음`
  + (r.cite.truncatedNearby ? ' (receipt가 잘려 있어 오탐 가능)' : '');

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
// --json은 detick을 안 거친다 — JSON.stringify가 값 안의 개행을 \n으로 이스케이프하므로
// 모든 줄이 공백+`"`/`{`/`[`로 시작한다. 형태상 ✔로 시작하는 줄이 나올 수 없다(B4가 잠근다).
export function toJson({ cycle, lcov, counts, rows }) {
  return {
    cycle,
    lcov,
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

/** 사람용 보고 문자열 */
export function formatHuman({
  cycle, lcov, counts, groups, receipts,
}) {
  const {
    unresolved, uncited, noCmdMatch, noReceipt, deadBranch, uncovered, drifted, viaArchive,
  } = groups;
  // detick은 조립이 끝난 뒤 한 번만 건다 — 중간 단계에 걸면 어느 조각이 줄 선두가 되는지를
  // 다시 세야 하고, 그 셈이 틀렸던 것이 이 불변식이 두 번 샌 원인이다.
  return detick([
    `evidence 검증 — ${cycle}/`,
    `unresolved: ${counts.unresolved}   (게이트 대상 — >0이면 REPORT.md 쓰기가 차단된다)`,
    `uncited: ${counts.uncited} · no-cmd-match: ${counts.noCmdMatch} · no-receipt: ${counts.noReceipt}`
    + ` · uncovered: ${counts.uncovered} · dead-branch: ${counts.deadBranch}   (보고 — 차단 아님)`,
    counts.noData > 0
      ? `커버리지 no-data: ${counts.noData}건 (${lcov} 기준)`
      : `커버리지 출처: ${lcov}`,
    '',
    ...section('❌', 'unresolved', unresolved.map(
      (r) => `  ${field(r.id)}  ref "${field(r.ref)}"  ${why(r.refResult)}`,
    )),
    ...section('⚠', 'uncited', uncited.map((r) => `  ${field(r.id)}  ref ${field(r.ref)}  ${citeWhy(r)}`)),
    ...section('⚠', 'no-cmd-match', noCmdMatch.map(
      (r) => `  ${field(r.id)}  ref ${field(r.ref)}  ${noCmdMatchWhy(r)}`,
    )),
    ...section('⚠', 'no-receipt', noReceipt.map(
      (r) => `  ${field(r.id)}  ref ${field(r.ref)}  ${noReceiptWhy(receipts)}`,
    )),
    ...section('⚠', 'dead-branch', deadBranch.map(
      (r) => `  ${field(r.id)}  target ${field(r.target)}  BRDA taken=0 @ line ${r.cov.deadBranches.map((d) => d.line).join(', ')}`,
    )),
    ...section('⚠', 'uncovered', uncovered.map(
      (r) => `  ${field(r.id)}  target ${field(r.target)}  미실행 라인 ${r.cov.uncoveredLines.join(', ')}`,
    )),
    ...section('ℹ', 'lineDrift (게이트 무관)', drifted.map(
      (r) => `  ${field(r.id)}  ${r.refResult.lineDrift.map(field).join(' · ')}`,
    )),
    ...section('ℹ', 'archive 폴백으로 찾음 (게이트 무관)', viaArchive.map(
      (v) => `  ${field(v.id)}  ${field(v.from)} → ${field(archiveDest(v.from))}`,
    )),
  ].join('\n')) + '\n';
}
