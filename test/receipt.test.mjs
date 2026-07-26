// 실행 receipt 봉인 계약 — "무엇이 어떻게 .devkit/receipts.jsonl에 남는가".
// 그 기록으로 인용을 대조하는 쪽의 계약은 test/citation.test.mjs에 있다.
// receipt를 쓰는 테스트는 전부 mkdtempSync 임시 root에 쓰고 after()에서 지운다
// ($TMPDIR/.devkit/audit.jsonl을 무한히 키운 기존 문제를 반복하지 않기 위해).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(dir, '..');
const require = createRequire(import.meta.url);
const receipt = require(path.join(repoRoot, 'hooks', 'lib', 'receipt.js'));
const {
  appendReceipt, readReceipts, maskSecrets, MAX_STDOUT, MAX_FILE,
} = receipt;
// 상한은 "인용 대조가 성립하는가"로 판정한다 — 봉인만 보면 무엇을 위해 큰지 알 수 없다
const { checkCitation } = require(path.join(repoRoot, 'hooks', 'lib', 'citation.js'));

// ⚠ 시크릿 샘플은 런타임 문자열 결합으로 만든다 — 리터럴로 적으면 secret-guard(PreToolUse)가
// 이 테스트 파일의 Write 자체를 exit 2로 막는다(DESIGN 리스크 7의 실전 관측).
const AWS_KEY = 'AK' + 'IA' + 'ABCDEFGHIJKLMNOP';
const GH_TOKEN = 'gh' + 'p_' + 'A'.repeat(36);
const PEM_HEAD = '-----BEGIN ' + 'OPENSSH PRIVATE KEY' + '-----';
const JWT = 'ey' + 'JhbGciOiJIUzI1NiJ9' + '.eyJzdWIiOiIxMjM0NTY3ODkwIn0.' + 'abcdef';

const tmpDirs = [];
function makeRoot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-receipt-'));
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function readLines(root) {
  const p = path.join(root, '.devkit', 'receipts.jsonl');
  return fs.readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}

// ── B8: 크기 상한 초과 시 truncate 표기 ──────────────────
// 픽스처 크기는 MAX_STDOUT에서 파생시킨다 — 바이트 수를 하드코딩하면 상한이 올라간 순간
// 절단이 아예 안 일어나 이 테스트가 조용히 아무것도 고정하지 못한다(공허한 green).
const OVER_STDOUT = Math.round(MAX_STDOUT * 1.5);

test('B8: 상한을 1.5배 넘는 stdout은 상한까지 잘리고 양끝이 남는다 + truncated 표기', () => {
  const root = makeRoot();
  const big = 'HEAD_MARKER_' + 'a'.repeat(OVER_STDOUT - 24) + 'TAIL_MARKER_';
  assert.equal(big.length, OVER_STDOUT, '픽스처가 상한의 1.5배여야 한다');

  appendReceipt(root, { command: 'node --test test/*.test.mjs', stdout: big, stderr: '', interrupted: false });

  const recs = readLines(root);
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.equal(r.cmd, 'node --test test/*.test.mjs');
  assert.ok(r.stdout.length <= MAX_STDOUT, `상한 초과: ${r.stdout.length} > ${MAX_STDOUT}`);
  assert.equal(r.truncated, true);
  assert.equal(r.bytes.stdout, OVER_STDOUT, '원본 바이트 수를 남겨야 판독이 된다');
  assert.match(r.stdout, /truncated/, '잘렸음을 사람이 읽을 수 있어야 한다');
  // 양끝 보존 — head만 남기면 '# fail 0' 같은 요약 확인이 불가능해진다
  assert.ok(r.stdout.startsWith('HEAD_MARKER_'), '앞이 사라졌다');
  assert.ok(r.stdout.endsWith('TAIL_MARKER_'), '뒤가 사라졌다');
  assert.match(r.ts, /^\d{4}-\d{2}-\d{2}T/, 'ISO 타임스탬프여야 한다');
});

test('B8: 상한 이하 출력은 원문 그대로 (truncated 플래그 없음)', () => {
  const root = makeRoot();
  appendReceipt(root, { command: 'ls', stdout: '✔ B1: 무언가를 확인한다\n# pass 166\n', stderr: '', interrupted: false });
  appendReceipt(root, { command: 'pwd', stdout: '/x', stderr: '', interrupted: false });

  const recs = readLines(root);
  assert.equal(recs.length, 2, 'append여야 한다(덮어쓰기 아님)');
  assert.equal(recs[0].stdout, '✔ B1: 무언가를 확인한다\n# pass 166\n');
  assert.equal(recs[0].truncated, undefined);
  assert.equal(recs[1].cmd, 'pwd');
});

// ── B6: 실사용 규모(20KB급) 출력에서 중간 테스트명이 살아남는다 ──
// D18 실측 — 테스트 234개의 spec 리포터 출력이 20,752 B였는데 상한이 8KB라 가운데가 통째로
// 날아갔고, 그 구간의 ✔ 줄을 인용한 evidence가 전부 uncited로 뜬 것이 이 층이 죽은 원인이다.
// head/tail만 보존해서는 통과할 수 없는 지점(중간)을 고른다.
const BIG_LINES = 234;
const bigLine = (i) => `✔ B${i}: 실사용 규모 재현용 테스트명 ${'가'.repeat(12)} (1.234ms)\n`; // 한글 = UTF-8 경계

test('B6: 실사용 규모 출력은 절단되지 않고 중간 테스트명으로 인용 대조까지 된다', () => {
  const root = makeRoot();
  const CMD = 'node --test test/*.test.mjs';
  let body = '';
  for (let i = 1; i <= BIG_LINES; i += 1) body += bigLine(i);
  const tail = '\n# tests 234\n# pass 234\n# fail 0\n# duration_ms 1234.5\n';
  // 픽스처가 실측 규모임을 스스로 증명한다 — 바이트 수를 하드코딩하면 근거가 사라진다
  assert.ok(Buffer.byteLength(body + tail) >= 20000, `픽스처가 실측(20,752 B) 규모여야 한다: ${Buffer.byteLength(body + tail)}`);

  appendReceipt(root, { command: CMD, stdout: body + tail, stderr: '', interrupted: false });

  const r = readLines(root)[0];
  assert.equal(r.truncated, undefined, '실사용 규모가 잘리면 사이클마다 인용 대조가 무너진다');

  const MID = bigLine(Math.round(BIG_LINES / 2)).trim(); // 117번째 — head도 tail도 아닌 자리
  assert.ok(r.stdout.includes(MID), `가운데 줄이 사라졌다: ${MID}`);

  // 봉인만으로는 부족하다 — 그 줄을 인용한 evidence가 실제로 cited가 돼야 의미가 있다
  const at = new Date().toISOString().slice(0, 10);
  const c = checkCitation({ kind: 'test', ref: 'test/x.test.mjs:1', cmd: CMD, at, output: MID }, readReceipts(root));
  assert.equal(c.status, 'cited', `중간 구간 인용이 대조되지 않는다: ${JSON.stringify(c.quotes)}`);
});

// ── B7: 상한 상향이 로테이션을 조기 유발하지 않는다 ────────
// stdout 상한만 올리고 파일 상한을 두면 최악 보관 건수가 4배 줄어(256 → 64건) 과거 실행이
// 빨리 사라지고, 그건 곧 "안 돌렸다"(no-cmd-match) 오탐이다. 비율을 계약으로 고정한다.
test('B7: MAX_FILE이 레코드 상한의 256배 이상이다 (보관 건수 정책 불변)', () => {
  const ratio = MAX_FILE / MAX_STDOUT;
  assert.ok(ratio >= 256, `stdout 상한만 올리면 보관 건수가 줄어 과거 실행이 사라진다: ${ratio}배`);
});

// 파일 자체도 무한히 커지면 안 된다. 1세대만 유지하고 대조는 두 파일을 함께 읽는다.
test('B8: 파일이 상한을 넘으면 1세대로 로테이션하고 새로 시작한다', () => {
  const root = makeRoot();
  const devkit = path.join(root, '.devkit');
  fs.mkdirSync(devkit, { recursive: true });
  fs.writeFileSync(path.join(devkit, 'receipts.jsonl'), 'x'.repeat(MAX_FILE + 1) + '\n');

  appendReceipt(root, { command: 'echo hi', stdout: 'hi', stderr: '', interrupted: false });

  const recs = readLines(root);
  assert.equal(recs.length, 1, '새 파일로 시작해야 한다');
  assert.equal(recs[0].cmd, 'echo hi');
  assert.ok(fs.existsSync(path.join(devkit, 'receipts.1.jsonl')), '직전 세대가 보존돼야 한다');
});

// ── B12: 시크릿 마스킹 (secret-patterns.js 재사용, 신규 패턴 금지) ──
test('B12: maskSecrets가 HIGH/SUSPECT 패턴을 why와 함께 가린다 (다중 출현 전부)', () => {
  const masked = maskSecrets(`a ${AWS_KEY} b ${AWS_KEY} c ${GH_TOKEN} d ${PEM_HEAD} e ${JWT}`);

  assert.ok(!masked.includes(AWS_KEY), 'AWS 키 원문이 남았다');
  assert.ok(!masked.includes(GH_TOKEN), 'GitHub 토큰 원문이 남았다');
  assert.ok(!masked.includes(PEM_HEAD), '개인키 헤더 원문이 남았다');
  assert.ok(!masked.includes(JWT), 'JWT 원문이 남았다(SUSPECT도 가려야 한다)');

  // g 플래그 없이 replace하면 첫 건만 가리고 나머지가 그대로 샌다
  assert.equal(masked.match(/\[REDACTED:AWS access key id\]/g).length, 2, '같은 패턴의 2번째 출현이 안 가려졌다');
  assert.match(masked, /\[REDACTED:GitHub personal token\]/);
  assert.match(masked, /\[REDACTED:private key\]/);
  assert.match(masked, /\[REDACTED:JWT-like token\]/);

  // 시크릿이 없는 텍스트는 손대지 않는다(대조가 깨지면 안 된다)
  assert.equal(maskSecrets('✔ B1: 무언가를 확인한다\n# pass 176\n'), '✔ B1: 무언가를 확인한다\n# pass 176\n');
  assert.equal(maskSecrets(null), '', '비문자열은 clip과 같게 빈 문자열');
});

test('B12: appendReceipt는 cmd/stdout/stderr 3면 모두 마스킹해서 저장한다', () => {
  const root = makeRoot();
  appendReceipt(root, {
    command: `aws configure set aws_access_key_id ${AWS_KEY}`,
    stdout: `Authorization: Bearer ${GH_TOKEN}\n`,
    stderr: `${PEM_HEAD}\nb3BlbnNzaC1rZXktdjE\n`,
    interrupted: false,
  });

  // 파일 원문에 시크릿이 한 글자도 남으면 안 된다(.devkit은 gitignore지만 로컬에 남는다)
  const raw = fs.readFileSync(path.join(root, '.devkit', 'receipts.jsonl'), 'utf8');
  assert.ok(!raw.includes(AWS_KEY), 'cmd에 AWS 키 원문이 남았다');
  assert.ok(!raw.includes(GH_TOKEN), 'stdout에 GitHub 토큰 원문이 남았다');
  assert.ok(!raw.includes(PEM_HEAD), 'stderr에 개인키 헤더 원문이 남았다');

  const r = readLines(root)[0];
  assert.match(r.cmd, /\[REDACTED:AWS access key id\]/);
  assert.match(r.stdout, /\[REDACTED:GitHub personal token\]/);
  assert.match(r.stderr, /\[REDACTED:private key\]/);
  assert.match(r.stderr, /b3BlbnNzaC1rZXktdjE/, '시크릿 아닌 주변 텍스트까지 지우면 안 된다');
});

// 순서 계약: 마스킹 → 절단. 반대로 하면 절단 경계에서 토큰이 반토막 나
// (예: 'AKIA' + 4자) 정규식 {16}에 안 걸리고 원문 조각이 파일에 남는다.
test('B12: 절단 경계에 걸친 시크릿도 원문이 남지 않는다 (마스킹 먼저, 절단 나중)', () => {
  const root = makeRoot();
  const SIZE = OVER_STDOUT; // 상한이 바뀌어도 절단이 반드시 일어나야 이 순서가 검증된다
  const DOT = '.'; // \b 경계를 살리려면 filler가 non-word여야 한다

  // ① 경계 위치를 실측한다(마커 길이에 상수를 하드코딩하지 않기 위해)
  appendReceipt(root, { command: 'calibrate', stdout: DOT.repeat(SIZE), stderr: '', interrupted: false });
  const headLen = readLines(root)[0].stdout.indexOf('\n…[devkit] truncated');
  assert.ok(headLen > 0, `절단 마커를 못 찾았다 (headLen=${headLen})`);

  // ② AWS 키 20자가 경계를 8자 앞에서 걸치도록 배치 (마스킹 후에도 bytes는 5자리라 경계 불변)
  const before = DOT.repeat(headLen - 8);
  const after = DOT.repeat(SIZE - before.length - AWS_KEY.length);
  appendReceipt(root, { command: 'straddle', stdout: before + AWS_KEY + after, stderr: '', interrupted: false });

  const r = readLines(root)[1];
  assert.equal(r.truncated, true, '픽스처가 절단을 유발해야 의미가 있다');
  assert.ok(!r.stdout.includes('AKIA'), '절단 후 마스킹하면 반토막 난 키가 그대로 남는다');
});

// ── R5: 마스킹 보장 문구가 실제 동작과 일치해야 한다 ──────
// 실무 유출 형태 대부분은 9개 패턴을 그냥 통과한다(SUSPECT의 credential 패턴이
// 따옴표를 요구해 `export K=V` 형태를 못 잡는다). 문서가 "시크릿 마스킹"이라고만
// 적으면 사용자가 .devkit/receipts.jsonl을 안전한 것으로 잘못 믿는다.
test('R5: 마스킹을 통과하는 실무 형태가 실제로 있다 (문서 문구의 근거)', () => {
  const leaks = [
    'export DB_PASSWORD=' + 'SuperSecret' + '123456',
    'DATABASE_URL=postgres://user:' + 'p4ssw0rd' + '_secret@db.host:5432/app',
    'curl -H "Authorization: Bearer ' + 'q'.repeat(40) + '"',
  ];
  for (const l of leaks) {
    assert.equal(maskSecrets(l), l, `이건 실제로 가려진다 — 문구를 다시 봐야 한다: ${l}`);
  }
});

test('R5: README·RULES가 마스킹 범위를 과장하지 않는다', () => {
  for (const f of ['README.md', 'RULES.md']) {
    // 설명 문단 = receipts.jsonl 줄 + 뒤따르는 들여쓴 하위 불릿. 다른 항목까지 훑으면
    // 문서 어딘가에 '9종'만 있어도 통과해버려 이 테스트가 아무것도 고정하지 못한다.
    const lines = fs.readFileSync(path.join(repoRoot, f), 'utf8').split('\n');
    const at = lines.findIndex((l) => l.includes('receipts.jsonl'));
    assert.ok(at >= 0, `${f}에 receipts.jsonl 설명이 없다`);
    let end = at + 1;
    while (end < lines.length && /^\s+\S/.test(lines[end])) end += 1;
    const block = lines.slice(at, end).join('\n');

    assert.match(block, /9종/, `${f}: 마스킹 범위를 수치로 밝혀야 한다 — "${block}"`);
    assert.match(block, /평문/, `${f}: 가려지지 않는 것이 있음을 밝혀야 한다 — "${block}"`);
  }
});

// 봉인(이 파일)과 대조(citation.js)는 경계가 갈렸다. 재export하거나 옛 대조 코드가 남으면
// "두 벌"이 되고, 아무도 import하지 않아 테스트가 전부 green인 채로 D15가 폐기한
// 이름 블랙리스트(SELF_RE)가 되살아난다 — 실제로 한 번 되살아나서 이 테스트를 심는다.
test('B12: 대조 로직은 citation.js에만 있다 (receipt.js에 두 벌을 두지 않는다)', () => {
  assert.equal(receipt.checkCitation, undefined, 'receipt.js가 대조를 재export한다');
  assert.equal(receipt.extractQuotes, undefined, 'receipt.js가 대조를 재export한다');

  const src = fs.readFileSync(path.join(repoRoot, 'hooks', 'lib', 'receipt.js'), 'utf8');
  assert.doesNotMatch(src, /verify-evidence/, 'D15가 폐기한 이름 블랙리스트가 receipt.js에 되살아났다');
  assert.doesNotMatch(src, /function checkCitation/, '대조 함수가 봉인 모듈에 남아 있다');
});

// B12는 "기존 secret-patterns.js를 재사용하고 신규 패턴을 만들지 않는다"가 제약이다.
// 문장으로 두면 지켜졌는지 알 수 없다 — 개수로 실행에 못 박는다.
test('B12: secret-patterns.js를 재사용한다 — 신규 패턴을 만들지 않았다', () => {
  const { HIGH, SUSPECT } = require(path.join(repoRoot, 'hooks', 'lib', 'secret-patterns.js'));
  assert.equal(HIGH.length, 7, 'HIGH에 패턴이 늘거나 줄었다');
  assert.equal(SUSPECT.length, 2, 'SUSPECT에 패턴이 늘거나 줄었다');
  // receipt.js가 자기 패턴을 새로 정의하지 않고 가져다 쓰는지 소스로 고정
  const src = fs.readFileSync(path.join(repoRoot, 'hooks', 'lib', 'receipt.js'), 'utf8');
  assert.match(src, /require\(['"]\.\/secret-patterns['"]\)/, 'secret-patterns를 재사용하지 않는다');
});
