// 인용 대조 — evidence.output의 인용 조각이 "그 evidence가 주장한 명령을 실제로 실행한"
// receipt 안에 있는지 본다. 봉인(receipt.js)과 분리된 순수 모듈이다: fs를 안 만지고
// readReceipts가 준 레코드 배열만 받는다. 훅 경로(bash-receipt.js)는 이 파일을 로드하지 않는다.
//
// 이 층은 보고이지 차단이 아니다 — 어떤 입력에도 throw하지 않는다.

// evidence.output의 실측 구분자. **export한다** — 검증 도구의 출력 형태 규칙이 이 값에
// 걸려 있고(report-format.mjs emit), 두 벌로 두면 한쪽만 바뀌는 순간 방벽이 조용히 죽는다.
const SEP = ' · ';
const MIN_QUOTE = 8;

/** 소요시간 표기는 evidence와 receipt가 서로 다르다 — 그대로 두면 영원히 불일치 */
function normalize(text) {
  return String(text).replace(/\s+/g, ' ').replace(/\s\(\d+(?:\.\d+)?m?s\)/g, '').trim();
}

/**
 * 대조할 인용 조각을 뽑는다. kind:'test'만 대상 — manual/visual은 사람이 눈으로 본
 * 결과라 Bash receipt에 있을 이유가 없다. 이 한 줄이 오탐의 대부분을 없앤다.
 *
 * 마커(✔)로 조각을 거르지 않는다: 그러면 마커를 안 찍는 러너를 쓰는 프로젝트에서
 * quotes=0(skipped)이 되어 이 층이 조용히 무검증이 된다. 서술형 조각('라이브: …')은
 * 후보에서 빼는 게 아니라 **무해하게 안 맞을 뿐**이다(판정은 "하나라도 맞으면 cited").
 *
 * 줄 → 조각 순서다. 여러 줄을 붙여넣으면 줄마다 후보가 되고, 자르기는 정규화 **뒤에**
 * 한다 — 그래야 "인용 조각은 SEP를 포함할 수 없다"가 참이 되고 report-format.mjs의
 * 형태 규칙이 성립한다(`"a\t·\tb"`가 normalize 후 SEP를 품는 구멍을 막는다).
 */
function extractQuotes(evidence) {
  if (!evidence || typeof evidence !== 'object') return [];
  if (evidence.kind !== 'test' || typeof evidence.output !== 'string') return [];

  const out = [];
  for (const line of evidence.output.split('\n')) {
    for (const frag of normalize(line).split(SEP)) {
      if (frag.length >= MIN_QUOTE) out.push(frag);
    }
  }
  return out;
}

/**
 * 명령을 토큰 집합으로 쪼갠다. 셸 문법을 해석하지 않는다 — 구분자로 자르고 따옴표만 벗긴다.
 * 대소문자는 보존한다(경로·플래그는 대소문자 민감).
 */
function tokenizeCmd(cmd) {
  if (typeof cmd !== 'string') return [];
  const out = new Set();
  for (const raw of cmd.split(/[\s;&|]+/)) { // `&&`·`||`는 자연히 소멸
    const t = raw.replace(/^['"`()]+/, '').replace(/['"`()]+$/, '');
    if (t !== '') out.add(t);
  }
  return [...out];
}

/**
 * evidence가 주장한 명령이 이 receipt에서 실제로 실행됐는가.
 * 방향은 evidence ⊆ receipt다 — 실제 실행은 항상 주장의 확장이다
 * (`cd … &&` 접두 · 커버리지 옵션 · 뒤따르는 `&& grep …`).
 * 토큰 1개(`node`)면 모든 node 실행이 걸려 자기입증 경로가 되살아나므로 하한은 2다.
 */
function matchesCmd(evTokens, receiptCmd) {
  if (!Array.isArray(evTokens) || evTokens.length < 2) return false;
  const rec = new Set(tokenizeCmd(receiptCmd));
  return evTokens.every((t) => rec.has(t));
}

/**
 * 대조에 쓸 후보. 후보 receipt의 stdout/stderr를 **정규화된 줄의 집합**으로 만든다.
 * 마커를 보지 않는다 — 거르는 것은 문자가 아니라 형태다: "실행 로그의 한 줄은 통째로
 * 그 줄이다". 대조가 부분 문자열 포함이 아니라 집합 멤버십이라 인정 조건이 좁아지고,
 * cmd를 맞춰 적은 위조(`echo "… → ✔ …"` · `cat behaviors.json` · `git diff`)는
 * 위조 문자열이 **줄 가운데 박혀 있어** 전부 안 맞는다. 러너가 무엇이든 성립한다.
 *
 * ⚠ 잔여 미탐 (DESIGN §7과 나란히 둔다 — 숨기지 않는다. **테스트로 단언하지 않는다**:
 *   단언하면 구멍이 계약으로 굳는다):
 *  1. 복합 명령(`node --test … && cat behaviors.json`)은 한 receipt 안에서 매칭과 오염이
 *     동시에 일어나 못 가른다.
 *  2. (d) evidence.cmd를 receipt와 맞춰 적고 인용 줄을 **단독 줄로 직접 출력**하면
 *     (`echo "ZZZ: …"`) 여전히 통과한다. 마커가 없어졌으므로 ✔조차 필요 없다 —
 *     직전 사이클보다 비용이 낮아진 것을 인정한다. 그 경우 보고서에 그 cmd가 남는다.
 *  3. "그 줄이 이 behavior의 증거인가"는 원래부터 안 본다. 정직한 실행의 *다른* 줄을
 *     인용하는 위조는 tick 시절에도 전부 열려 있었다.
 *  4. 32KB 절단 경계에서 잘린 줄은 반토막이라 전체 일치가 원리적으로 불가하다
 *     (truncatedNearby가 보고에 나온다).
 * 1·2를 닫으려면 receipt 하나 안에서 "어느 조각의 출력인가"를 갈라야 하고 그건 셸 파서다.
 */
function candidateLines(records) {
  const lines = new Set();
  for (const r of records) {
    for (const line of `${(r && r.stdout) || ''}\n${(r && r.stderr) || ''}`.split('\n')) {
      if (line.length < MIN_QUOTE) continue; // normalize는 길이를 늘리지 않는다 — 안전한 사전 컷
      const s = normalize(line);
      if (s.length >= MIN_QUOTE) lines.add(s);
    }
  }
  return lines;
}

// 같은 receipts view 안에서 evidence.cmd가 같으면 후보 집합도 줄 집합도 똑같다. 이 레포의 실측은
// 모든 evidence.cmd가 같은 문자열이고 모든 테스트 실행 receipt가 그 상위집합이라 후보가 하나도
// 안 줄어든다 — behavior마다 8MB를 다시 훑으면 그대로 N배가 된다(REVIEW 🟡3).
// 키는 receipts view 객체(WeakMap)라 view가 바뀌면 캐시도 같이 사라진다. 캐시가 도는 동안
// records를 갈아끼우면 안 된다 — readReceipts는 호출마다 새 객체를 주므로 성립한다.
const candidateCache = new WeakMap();

function candidatesFor(rs, records, cmd, evTokens) {
  let byCmd = candidateCache.get(rs);
  if (byCmd === undefined) {
    byCmd = new Map();
    candidateCache.set(rs, byCmd);
  }
  let entry = byCmd.get(cmd);
  if (entry === undefined) {
    const matched = records.filter((r) => matchesCmd(evTokens, r && r.cmd));
    entry = { matched, lines: matched.length > 0 ? candidateLines(matched) : new Set() };
    byCmd.set(cmd, entry);
  }
  return entry;
}

/** 보고이지 차단이 아니다 — 어떤 결과도 throw하지 않는다 */
function checkCitation(evidence, receipts) {
  const rs = (receipts && typeof receipts === 'object')
    ? receipts : { records: [], present: false, firstDate: null };
  const quotes = extractQuotes(evidence);
  const base = {
    quotes, hits: [], cmd: null, matched: 0, truncatedNearby: false,
  };
  if (quotes.length === 0) return { ...base, status: 'skipped' };
  // 대조할 receipt가 애초에 없는 것과 인용이 틀린 것은 다른 사건이다
  if (rs.present !== true) return { ...base, status: 'no-receipt' };
  // 날짜 단위 비교. 시각 단위로 비교하면 같은 날 evidence가 전부 no-receipt로 오탐난다
  const at = typeof (evidence && evidence.at) === 'string' ? evidence.at.slice(0, 10) : '';
  if (at !== '' && rs.firstDate && at < rs.firstDate) return { ...base, status: 'no-receipt' };

  const records = Array.isArray(rs.records) ? rs.records : [];
  // 주장한 명령을 실제로 실행한 receipt만 후보다. `git diff`·`cat`·`sed`로 인용 원문이
  // 화면에 나와도 그건 실행 흔적이 아니다 — 이름 블랙리스트 없이 형태로 걸러진다.
  const evTokens = tokenizeCmd(evidence && evidence.cmd);
  // 대조에 쓸 수 없는 cmd(부재·비문자열·토큰 1개)는 cmd:null로 사유를 가른다 —
  // 조치가 "실제 실행 명령을 적어라"이지 "그 명령을 돌려라"가 아니다
  if (evTokens.length < 2) return { ...base, status: 'no-cmd-match' };

  const cmd = evidence.cmd;
  // 줄 집합은 후보 receipt에서만 만든다. 전체 receipt를 훑으면 검증하려고 원문을 화면에
  // 띄운 것만으로(`sed`·`cat`·보고서 자신) 위조가 cited로 뒤집힌다(D20 실측).
  const { matched, lines } = candidatesFor(rs, records, cmd, evTokens);
  if (matched.length === 0) return { ...base, cmd, status: 'no-cmd-match' };

  // 후보 중 하나라도 맞으면 cited — 전부 요구하면 여러 명령에 걸쳐 나온 출력에서 오탐.
  // 부분 문자열 포함이 아니라 **줄 전체 일치**다: 위조 문자열은 줄 가운데 박히므로 안 맞는다.
  const hits = quotes.filter((q) => lines.has(q));
  return {
    quotes,
    hits,
    cmd,
    matched: matched.length,
    // 후보에 대해서만 본다 — 무관한 receipt의 절단은 이 인용의 오탐 근거가 아니다
    truncatedNearby: matched.some((r) => r.truncated === true),
    status: hits.length > 0 ? 'cited' : 'uncited',
  };
}

module.exports = {
  SEP,
  MIN_QUOTE,
  normalize,
  extractQuotes,
  tokenizeCmd,
  matchesCmd,
  checkCitation,
};
