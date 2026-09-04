// 실행 receipt 봉인 — Bash 실행의 command/stdout/stderr를 `.devkit/receipts.jsonl`에 남기고
// 다시 읽어준다. 그 기록으로 인용을 대조하는 쪽은 citation.js다.
// 기록이 훅을 죽이면 안 되므로 실패는 stderr에 남기고 계속한다(audit.js와 동일 degrade).
const fs = require('node:fs');
const path = require('node:path');
const { HIGH, SUSPECT, MASK_ONLY } = require('./secret-patterns');
const { warn } = require('./diag');

// secret-patterns.js의 패턴을 그대로 재사용한다(신규 패턴을 만들지 않는다).
// scanHigh/scanSuspect는 why 배열만 주므로 치환에 못 쓴다 → re에 'g'만 덧붙인다.
const MASKS = [...HIGH, ...SUSPECT, ...MASK_ONLY].map((p) => ({
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
// 끝에 요약(# pass 234)을 내는데 head만 남기면 판독(fail 0 확인)이 불가능해진다.
//
// 32KB의 근거: 전체 테스트 출력 실측 20,752 B의 1.58배 = 테스트 약 370개까지 무절단
// (줄당 평균 84 B). 8KB에서는 가운데가 통째로 날아가 그 구간을 인용한 evidence가
// 전부 uncited로 뜨면서 대조 층이 사실상 죽었다(D18). 16KB는 실측을 겨우 넘어 마진이 없다.
// 370개를 넘으면 다시 절단이다 — 그때는 상한이 아니라 다른 축(사이클별 분리)을 봐야 한다.
const MAX_STDOUT = 32768;
// 절단이 실제로 걸리는 상황은 대개 테스트가 "실패한" 경우이고, spec 리포터는 실패 상세
// (assert diff + stack)를 끝에 낸다. tail이 얇으면 왜 실패했는지가 통째로 사라진다. head:tail = 7:1.
const TAIL_STDOUT = 4096;
const MAX_STDERR = 2048; // 훅 차단 메시지는 수백 바이트다 — 근거 없이 올리지 않는다
// ⚠ 여기서 절단이 걸리면 뒤쪽 토큰(=대상 인자)이 날아가 citation.js의 cmd 매칭이 실패하고,
// 정직한 실행이 no-cmd-match 오탐이 된다. 실측 receipt.cmd 최장이 300 B 미만이라 지금은
// 여유 10배 이상이므로 올리지 않는다 — 밟히면 그때 올린다.
const MAX_COMMAND = 4096;
// MAX_FILE / MAX_STDOUT = 256을 불변으로 유지한다. 이 비율이 최악 보관 건수(256건 × 2세대)라,
// stdout 상한만 올리면 과거 실행이 4배 빨리 사라지고 그건 곧 no-cmd-match 오탐이다.
const MAX_FILE = 8 * 1024 * 1024;

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
    if (e.code !== 'ENOENT') warn(`receipt 크기 확인 실패: ${e.message}`);
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
    warn(`receipt 기록 실패: ${e.message}`);
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
      if (e.code !== 'ENOENT') warn(`receipt 읽기 실패 (${name}): ${e.message}`);
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
  if (broken > 0) warn(`receipt 깨진 줄 ${broken}개 건너뜀: ${firstBrokenMsg}`);

  const dates = records.map((r) => (typeof r.ts === 'string' ? r.ts.slice(0, 10) : '')).filter(Boolean).sort();
  return { records, present, firstDate: dates[0] ?? null };
}

// 인용 대조(normalize·extractQuotes·tokenizeCmd·matchesCmd·checkCitation)는 citation.js에 있다.
// 경계는 봉인(쓰기·읽기) vs 대조(판정)다 — 훅 경로(bash-receipt.js)는 대조를 로드하지 않는다.

module.exports = {
  appendReceipt,
  maskSecrets,
  readReceipts,
  MAX_STDOUT,
  MAX_STDERR,
  MAX_COMMAND,
  MAX_FILE,
  FILE,
  PREV,
};
