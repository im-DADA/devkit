// 인용 대조 — evidence.output의 인용 조각이 "그 evidence가 주장한 명령을 실제로 실행한"
// receipt 안에 있는지 본다. 봉인(receipt.js)과 분리된 순수 모듈이다: fs를 안 만지고
// readReceipts가 준 레코드 배열만 받는다. 훅 경로(bash-receipt.js)는 이 파일을 로드하지 않는다.
//
// 이 층은 보고이지 차단이 아니다 — 어떤 입력에도 throw하지 않는다.

const SEP = ' · '; // evidence.output의 실측 구분자
const TICK_RE = /^[✔✓]\s+/;
// 대조 대상 줄. 앞 공백은 허용한다 — node:test spec 리포터가 중첩 테스트를 들여쓴다.
// ⚠ 이 허용 때문에 "들여쓴 표의 첫 칸"도 대조 후보가 된다. 그래서 검증 보고서 쪽은
//   '어떤 줄도 ✔로 시작하지 않는다'를 출력 시점에 강제한다(report-format.mjs detick).
const TICK_LINE_RE = /^\s*[✔✓]\s/;
const MIN_QUOTE = 8;

/** 소요시간 표기는 evidence와 receipt가 서로 다르다 — 그대로 두면 영원히 불일치 */
function normalize(text) {
  return String(text).replace(/\s+/g, ' ').replace(/\s\(\d+(?:\.\d+)?m?s\)/g, '').trim();
}

/**
 * 대조할 인용 조각을 뽑는다. kind:'test'만 대상 — manual/visual은 사람이 눈으로 본
 * 결과라 Bash receipt에 있을 이유가 없다. 이 한 줄이 오탐의 대부분을 없앤다.
 * ✔로 시작하는 조각만 후보 — '라이브: …'·'뮤테이션 …'은 서술이라 실행 로그에 없다.
 */
function extractQuotes(evidence) {
  if (!evidence || typeof evidence !== 'object') return [];
  if (evidence.kind !== 'test' || typeof evidence.output !== 'string') return [];

  const out = [];
  for (const piece of evidence.output.split(SEP)) {
    const frag = piece.trim();
    if (!TICK_RE.test(frag)) continue;
    const q = normalize(frag.replace(TICK_RE, ''));
    if (q.length >= MIN_QUOTE) out.push(q);
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
 * 대조에 쓸 건초더미. 후보 receipt의 stdout/stderr 중 **✔로 시작하는 줄만** 남긴다.
 * extractQuotes가 이미 ✔로 시작하는 조각만 후보로 뽑으므로 대조 양쪽의 형태를 맞추는 것이고,
 * 규칙 추가가 아니라 인정 조건 축소다. cmd 매칭이 "무관한 receipt"를 뺐다면 이건
 * "관계있는 receipt의 무관한 줄"을 뺀다 — evidence.cmd를 정하는 것도 위조자이기 때문이다
 * (`echo "node --test … → ✔ …"` · `cat behaviors.json` · `git diff`는 전부 cmd를 맞춰 적을 수 있다).
 *
 * ⚠ 잔여 미탐 (DESIGN §1.5와 나란히 둔다 — 숨기지 않는다):
 *  1. 복합 명령(`node --test … && cat behaviors.json`)은 한 receipt 안에서 매칭과 오염이
 *     동시에 일어나 못 가른다.
 *  2. evidence.cmd를 receipt와 맞춰 적고 `✔`로 시작하는 줄을 **직접 출력**하면
 *     (`echo "✔ ZZZ: …"`) 여전히 통과한다. 그 경우 보고서에 그 cmd가 그대로 남아
 *     사람 눈에 띈다.
 * 둘 다 닫으려면 receipt 하나 안에서 "어느 조각의 출력인가"를 갈라야 하고 그건 셸 파서다.
 */
function tickLines(records) {
  const out = [];
  for (const r of records) {
    for (const line of `${(r && r.stdout) || ''}\n${(r && r.stderr) || ''}`.split('\n')) {
      if (TICK_LINE_RE.test(line)) out.push(line);
    }
  }
  return normalize(out.join('\n'));
}

// 같은 receipts view 안에서 evidence.cmd가 같으면 후보 집합도 hay도 똑같다. 이 레포의 실측은
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
    entry = { matched, hay: matched.length > 0 ? tickLines(matched) : '' };
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
  // hay는 후보에서만, 그중에서도 ✔로 시작하는 줄에서만 만든다(tickLines).
  // 전체 receipt를 훑으면 검증하려고 원문을 화면에 띄운 것만으로(`sed`·`cat`·보고서 자신)
  // 위조가 cited로 뒤집힌다(D20 실측).
  const { matched, hay } = candidatesFor(rs, records, cmd, evTokens);
  if (matched.length === 0) return { ...base, cmd, status: 'no-cmd-match' };

  // 후보 중 하나라도 맞으면 cited — 전부 요구하면 여러 명령에 걸쳐 나온 출력에서 오탐
  const hits = quotes.filter((q) => hay.includes(q));
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
  normalize,
  extractQuotes,
  tokenizeCmd,
  matchesCmd,
  checkCitation,
};
