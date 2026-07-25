// 실행 receipt — Bash 실행의 command/stdout/stderr를 `.devkit/receipts.jsonl`에 봉인하고,
// evidence.output의 인용 조각이 그 안에 실제로 있는지 대조한다.
// 기록이 훅을 죽이면 안 되므로 실패는 stderr에 남기고 계속한다(audit.js와 동일 degrade).
const fs = require('node:fs');
const path = require('node:path');
const { HIGH, SUSPECT } = require('./secret-patterns');

// secret-patterns.js의 패턴을 그대로 재사용한다(신규 패턴을 만들지 않는다).
// scanHigh/scanSuspect는 why 배열만 주므로 치환에 못 쓴다 → re에 'g'만 덧붙인다.
const MASKS = [...HIGH, ...SUSPECT].map((p) => ({
  re: new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : p.re.flags + 'g'),
  to: `[REDACTED:${p.why}]`,
}));

/** 시크릿을 가린다. 절단보다 먼저 불러야 한다 — 순서가 반대면 경계에서 반토막 난 토큰이 안 걸린다 */
function maskSecrets(text) {
  if (typeof text !== 'string') return '';
  let out = text;
  for (const m of MASKS) out = out.replace(m.re, m.to);
  return out;
}

// 크기 정책. stdout만 양끝을 살린다 — node:test spec 리포터는 앞에 테스트명(✔ …),
// 끝에 요약(# pass 166)을 내는데 head만 남기면 판독(fail 0 확인)이 불가능해진다.
const MAX_STDOUT = 8192;
const TAIL_STDOUT = 2048;
const MAX_STDERR = 2048;
const MAX_COMMAND = 4096;
const MAX_FILE = 2 * 1024 * 1024;

const FILE = 'receipts.jsonl';
const PREV = 'receipts.1.jsonl';

/** 상한을 넘으면 앞(+뒤)만 남기고 잘린 자리에 표기를 넣는다. 표기까지 포함해 max 이하 */
function clip(value, max, tailSize) {
  const s = typeof value === 'string' ? value : '';
  const bytes = Buffer.byteLength(s);
  if (bytes <= max) return { text: s, bytes, truncated: false };

  // 표기 길이가 예산에 영향을 주므로 자릿수 상한(bytes)으로 먼저 예산을 잡는다
  const budget = max - Buffer.byteLength(`\n…[devkit] truncated ${bytes} bytes…\n`);
  const marker = `\n…[devkit] truncated ${bytes - budget} bytes…\n`;
  const tail = Math.min(tailSize, budget);
  const head = budget - tail;
  const buf = Buffer.from(s, 'utf8');
  const text = buf.subarray(0, head).toString('utf8')
    + marker
    + (tail > 0 ? buf.subarray(bytes - tail).toString('utf8') : '');
  return { text, bytes, truncated: true };
}

/** 파일이 상한을 넘으면 1세대로 밀어낸다(기존 .1은 덮어씀). 대조는 두 파일을 함께 읽는다 */
function rotate(dir) {
  let size;
  try {
    size = fs.statSync(path.join(dir, FILE)).size;
  } catch (e) {
    if (e.code !== 'ENOENT') process.stderr.write(`[devkit] receipt 크기 확인 실패: ${e.message}\n`);
    return;
  }
  if (size <= MAX_FILE) return;
  fs.renameSync(path.join(dir, FILE), path.join(dir, PREV));
}

/** 한 줄 append. 쓰기 실패는 stderr 기록 후 계속(비차단 경로) */
function appendReceipt(root, rec) {
  try {
    // 마스킹 먼저, 절단 나중 (DESIGN §1.3). 반대면 절단 경계에서 토큰이 반토막 나
    // 정규식에 안 걸리고 원문 조각이 그대로 남는다.
    const cmd = clip(maskSecrets(rec && rec.command), MAX_COMMAND, 0);
    const out = clip(maskSecrets(rec && rec.stdout), MAX_STDOUT, TAIL_STDOUT);
    const err = clip(maskSecrets(rec && rec.stderr), MAX_STDERR, 0);

    const line = {
      ts: new Date().toISOString(), cmd: cmd.text, stdout: out.text, stderr: err.text,
    };
    if (cmd.truncated || out.truncated || err.truncated) {
      line.truncated = true;
      line.bytes = { cmd: cmd.bytes, stdout: out.bytes, stderr: err.bytes };
    }
    if (rec && rec.interrupted === true) line.interrupted = true;

    const d = path.join(root, '.devkit');
    fs.mkdirSync(d, { recursive: true });
    rotate(d);
    fs.appendFileSync(path.join(d, FILE), JSON.stringify(line) + '\n');
  } catch (e) {
    process.stderr.write(`[devkit] receipt 기록 실패: ${e.message}\n`);
  }
}

/** receipts.jsonl + 직전 세대를 병합해 읽는다. 깨진 줄은 버리되 전체를 버리지 않는다 */
function readReceipts(root) {
  const dir = path.join(root, '.devkit');
  const records = [];
  let present = false;
  let broken = 0;
  let firstBrokenMsg = '';

  for (const name of [PREV, FILE]) { // 오래된 세대 먼저
    let raw;
    try {
      raw = fs.readFileSync(path.join(dir, name), 'utf8');
    } catch (e) {
      if (e.code !== 'ENOENT') process.stderr.write(`[devkit] receipt 읽기 실패 (${name}): ${e.message}\n`);
      continue;
    }
    present = true;
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue;
      try {
        records.push(JSON.parse(line));
      } catch (e) {
        broken += 1;
        if (firstBrokenMsg === '') firstBrokenMsg = e.message;
      }
    }
  }
  if (broken > 0) process.stderr.write(`[devkit] receipt 깨진 줄 ${broken}개 건너뜀: ${firstBrokenMsg}\n`);

  const dates = records.map((r) => (typeof r.ts === 'string' ? r.ts.slice(0, 10) : '')).filter(Boolean).sort();
  return { records, present, firstDate: dates[0] ?? null };
}

// ── 인용 대조 ──────────────────────────────────────────
const SEP = ' · '; // evidence.output의 실측 구분자
const TICK_RE = /^[✔✓]\s+/;
const MIN_QUOTE = 8;
// 이 명령의 출력은 "실행 흔적"이 아니라 "판정 결과"다 — 대조 후보에서 뺀다
const SELF_RE = /verify-evidence/;

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

/** 보고이지 차단이 아니다 — 어떤 결과도 throw하지 않는다 */
function checkCitation(evidence, receipts) {
  const rs = (receipts && typeof receipts === 'object')
    ? receipts : { records: [], present: false, firstDate: null };
  const quotes = extractQuotes(evidence);
  const base = { quotes, hits: [], truncatedNearby: false };
  if (quotes.length === 0) return { ...base, status: 'skipped' };
  // 대조할 receipt가 애초에 없는 것과 인용이 틀린 것은 다른 사건이다
  if (rs.present !== true) return { ...base, status: 'no-receipt' };
  // 날짜 단위 비교. 시각 단위로 비교하면 같은 날 evidence가 전부 no-receipt로 오탐난다
  const at = typeof (evidence && evidence.at) === 'string' ? evidence.at.slice(0, 10) : '';
  if (at !== '' && rs.firstDate && at < rs.firstDate) return { ...base, status: 'no-receipt' };

  const records = Array.isArray(rs.records) ? rs.records : [];
  // 자기입증 차단: verify-evidence의 출력에는 uncited 인용이 그대로 실려 있고 그게 다시
  // 봉인된다. 대조가 부분 문자열 검사라 다음 실행에서 위조가 'cited'로 뒤집힌다
  // (실측: 코드·evidence 변경 없이 3회 실행만으로 uncited 1 → 0). 보고서로 보고서를
  // 입증하는 경로를 끊는다 — 이 층은 "실제로 실행된 적 있는가"만 봐야 한다.
  const evidential = records.filter((r) => !SELF_RE.test(String(r && r.cmd)));
  const hay = normalize(evidential.map((r) => `${r.stdout || ''}\n${r.stderr || ''}`).join('\n'));
  // 후보 중 하나라도 맞으면 cited — 전부 요구하면 여러 명령에 걸쳐 나온 출력에서 오탐
  const hits = quotes.filter((q) => hay.includes(q));
  return {
    quotes,
    hits,
    truncatedNearby: records.some((r) => r.truncated === true),
    status: hits.length > 0 ? 'cited' : 'uncited',
  };
}

module.exports = {
  appendReceipt,
  maskSecrets,
  readReceipts,
  extractQuotes,
  checkCitation,
  MAX_STDOUT,
  MAX_STDERR,
  MAX_COMMAND,
  MAX_FILE,
  FILE,
  PREV,
};
