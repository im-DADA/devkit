// 실행 receipt 봉인·대조 계약 — "evidence가 인용한 출력이 실제로 실행된 적 있는가".
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
  appendReceipt, readReceipts, extractQuotes, checkCitation, maskSecrets, MAX_STDOUT, MAX_FILE, FILE,
} = receipt;

// ⚠ 시크릿 샘플은 런타임 문자열 결합으로 만든다 — 리터럴로 적으면 secret-guard(PreToolUse)가
// 이 테스트 파일의 Write 자체를 exit 2로 막는다(DESIGN 리스크 7의 실전 관측).
const AWS_KEY = 'AK' + 'IA' + 'ABCDEFGHIJKLMNOP';
const GH_TOKEN = 'gh' + 'p_' + 'A'.repeat(36);
const PEM_HEAD = '-----BEGIN ' + 'OPENSSH PRIVATE KEY' + '-----';
const JWT = 'ey' + 'JhbGciOiJIUzI1NiJ9' + '.eyJzdWIiOiIxMjM0NTY3ODkwIn0.' + 'abcdef';

// receipt ts는 UTC ISO다. 시스템 날짜가 무엇이든 같은 기준으로 비교해야 테스트가 안 흔들린다.
const TODAY = new Date().toISOString().slice(0, 10);
const ev = (o) => ({ kind: 'test', ref: 'test/x.test.mjs:1', cmd: 'node --test', at: TODAY, ...o });

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
test('B8: 12KB stdout은 상한까지 잘리고 양끝이 남는다 + truncated 표기', () => {
  const root = makeRoot();
  const big = 'HEAD_MARKER_' + 'a'.repeat(12288 - 24) + 'TAIL_MARKER_';
  assert.equal(big.length, 12288, '픽스처가 12KB여야 한다');

  appendReceipt(root, { command: 'node --test test/*.test.mjs', stdout: big, stderr: '', interrupted: false });

  const recs = readLines(root);
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.equal(r.cmd, 'node --test test/*.test.mjs');
  assert.ok(r.stdout.length <= MAX_STDOUT, `상한 초과: ${r.stdout.length} > ${MAX_STDOUT}`);
  assert.equal(r.truncated, true);
  assert.equal(r.bytes.stdout, 12288, '원본 바이트 수를 남겨야 판독이 된다');
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

// ── B10: 인용 조각 대조 (보고이지 차단이 아니다) ──────────
// 실측 output(v0.11.0 아카이브 B1). ' · '로 나뉜 3조각 중 실행 로그는 첫 조각뿐이고
// '라이브: …'·'뮤테이션 M1 …'은 서술이라 receipt에 문자열로 존재할 수 없다.
// 후보에 넣으면 100% uncited가 나와 보고가 소음이 된다.
const ARCHIVE_B1 = "✔ B1: REVIEW.md 없이 REPORT.md를 쓰면 차단 + 생성 커맨드 안내 · 라이브: 실제 사이클 폴더 REPORT.md Write → exit=2, stderr 'REVIEW.md → /review' · 뮤테이션 M1(STAGE_REQUIREMENTS에서 REVIEW.md 제거) → 이 테스트 실패";

test('B10: 후보는 ✔ 조각만 — 서술(라이브·뮤테이션)은 인용이 아니다', () => {
  assert.deepEqual(
    extractQuotes(ev({ output: ARCHIVE_B1 })),
    ['B1: REVIEW.md 없이 REPORT.md를 쓰면 차단 + 생성 커맨드 안내'],
  );
  // ✔ 조각이 2개인 실측 형식(아카이브 B3)
  assert.equal(extractQuotes(ev({ output: '✔ B3: 없는 것만 정확히 지목한다 · ✔ gatePrerequisite: REVIEW.md만 없으면 그것만 지목' })).length, 2);
});

test('B10: kind가 test가 아니면 대조하지 않는다 (오탐 방지)', () => {
  const out = 'matcher: startup|resume|clear|compact / pre-compact.js: No such file (의도대로 부재)';
  assert.deepEqual(extractQuotes(ev({ kind: 'manual', output: out })), []);
  assert.deepEqual(extractQuotes(ev({ kind: 'visual', output: '✔ 스크린샷 대조 완료' })), []);
  assert.deepEqual(extractQuotes(null), []);
});

test('B10: 인용이 receipt에 있으면 cited', () => {
  const root = makeRoot();
  appendReceipt(root, {
    command: 'node --test test/*.test.mjs',
    stdout: '✔ B1: REVIEW.md 없이 REPORT.md를 쓰면 차단 + 생성 커맨드 안내 (12.34ms)\n# pass 166\n',
    stderr: '', interrupted: false,
  });
  const c = checkCitation(ev({ output: ARCHIVE_B1 }), readReceipts(root));
  assert.equal(c.status, 'cited');
  assert.equal(c.hits.length, 1);
});

test('B10: 인용을 못 찾으면 uncited로 보고한다 — throw하지 않는다(차단 아님)', () => {
  const root = makeRoot();
  appendReceipt(root, { command: 'node --test', stdout: '✔ 전혀 다른 테스트가 통과함\n', stderr: '', interrupted: false });
  let c;
  assert.doesNotThrow(() => { c = checkCitation(ev({ output: ARCHIVE_B1 }), readReceipts(root)); });
  assert.equal(c.status, 'uncited');
  assert.deepEqual(c.hits, []);
  assert.equal(c.quotes.length, 1, '무엇을 못 찾았는지 알려줘야 판단이 된다');
});

test('B10: 소요시간 표기 차이는 불일치가 아니다', () => {
  const root = makeRoot();
  appendReceipt(root, { command: 'node --test', stdout: '✔ B7: 정상 4필드는 통과 (13.502ms)\n', stderr: '', interrupted: false });
  assert.equal(checkCitation(ev({ output: '✔ B7: 정상 4필드는 통과 (2.1ms)' }), readReceipts(root)).status, 'cited');
});

test('B10: stderr도 대조 대상 (훅 차단 메시지는 stderr로 나온다)', () => {
  const root = makeRoot();
  appendReceipt(root, { command: 'node hooks/pdca-gate.js', stdout: '', stderr: "✔ B1: REVIEW.md 없이 REPORT.md를 쓰면 차단 + 생성 커맨드 안내\n", interrupted: false });
  assert.equal(checkCitation(ev({ output: ARCHIVE_B1 }), readReceipts(root)).status, 'cited');
});

test('B10: 후보가 0개면 skipped (대조 불가는 위반이 아니다)', () => {
  const root = makeRoot();
  appendReceipt(root, { command: 'ls', stdout: 'x', stderr: '', interrupted: false });
  assert.equal(checkCitation(ev({ kind: 'manual', output: '눈으로 확인함 — 배지가 보인다' }), readReceipts(root)).status, 'skipped');
});

// ── B11: 대조할 receipt가 애초에 없는 경우 ────────────────
// receipt가 없는 것과 인용이 틀린 것은 완전히 다른 사건이다. 둘을 uncited로 뭉치면
// "receipt 도입 이전 사이클"이 전부 위반으로 보여 보고가 못 쓰게 된다.
test('B11: receipts 파일 자체가 없으면 no-receipt (uncited가 아니다)', () => {
  const root = makeRoot(); // .devkit 없음
  const rs = readReceipts(root);
  assert.equal(rs.present, false);
  assert.equal(rs.firstDate, null);

  const c = checkCitation(ev({ output: ARCHIVE_B1 }), rs);
  assert.equal(c.status, 'no-receipt');
  assert.deepEqual(c.hits, []);
  assert.equal(c.quotes.length, 1, '무엇을 대조하려 했는지는 남겨야 한다');
});

// ts를 통제해야 firstDate 경계를 볼 수 있다 — appendReceipt는 now를 쓴다
function seedReceipts(root, lines) {
  const d = path.join(root, '.devkit');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, FILE), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return root;
}
const QUOTED = '✔ B1: REVIEW.md 없이 REPORT.md를 쓰면 차단 + 생성 커맨드 안내 (12.3ms)\n';

test('B11: evidence가 receipt 봉인 시작보다 이전 날짜면 no-receipt', () => {
  const root = seedReceipts(makeRoot(), [
    { ts: '2026-07-25T01:00:00.000Z', cmd: 'node --test', stdout: QUOTED, stderr: '' },
    { ts: '2026-07-26T01:00:00.000Z', cmd: 'ls', stdout: '', stderr: '' },
  ]);
  const rs = readReceipts(root);
  assert.equal(rs.present, true);
  assert.equal(rs.firstDate, '2026-07-25', '가장 오래된 ts의 날짜여야 한다');

  // 문자열은 우연히 맞지만(cited로 보일 수 있다) 봉인 이전이라 대조 자체가 성립하지 않는다
  const c = checkCitation(ev({ at: '2026-07-24', output: ARCHIVE_B1 }), rs);
  assert.equal(c.status, 'no-receipt');
});

// 실측 evidence.at은 '2026-07-25'처럼 날짜만인 경우가 많다. 시각 단위로 비교하면
// 같은 날 봉인된 receipt가 전부 '이전'으로 판정돼 이번 사이클 evidence가 몰살당한다.
test('B11: 같은 날짜는 no-receipt가 아니다 (날짜 단위 비교)', () => {
  const root = seedReceipts(makeRoot(), [
    { ts: '2026-07-25T23:59:59.000Z', cmd: 'node --test', stdout: QUOTED, stderr: '' },
  ]);
  const rs = readReceipts(root);

  // ① at이 날짜만 — receipt ts보다 시각상 앞서지만 같은 날이다
  assert.equal(checkCitation(ev({ at: '2026-07-25', output: ARCHIVE_B1 }), rs).status, 'cited');
  // ② at이 전체 ISO여도 같은 날이면 동일
  assert.equal(checkCitation(ev({ at: '2026-07-25T00:00:01.000Z', output: ARCHIVE_B1 }), rs).status, 'cited');
  // ③ 같은 날인데 인용이 다르면 그건 uncited — no-receipt로 뭉개면 안 된다
  assert.equal(checkCitation(ev({ at: '2026-07-25', output: '✔ 전혀 다른 문구가 통과함' }), rs).status, 'uncited');
  // ④ at이 없으면 날짜 판정을 하지 않는다 (없다고 no-receipt로 몰지 않는다)
  assert.equal(checkCitation(ev({ at: undefined, output: ARCHIVE_B1 }), rs).status, 'cited');
});

// ── R4: 보고서 자신이 봉인돼 uncited가 스스로 지워지는 것을 막는다 ──
// verify-evidence는 uncited 항목의 인용을 stdout에 찍고, 그 stdout을 bash-receipt가
// 봉인한다. 대조가 전체 receipt에 대한 부분 문자열 검사라, 다음 실행에서 그 인용이
// 발견돼 한 번도 실행된 적 없는 위조가 'cited'로 뒤집힌다(3회 실행이면 uncited: 0).
// → 자기 출력으로 자기를 입증하는 경로를 끊는다.
test('R4: verify-evidence 자신의 출력은 대조 후보가 아니다 (자기입증 차단)', () => {
  const root = seedReceipts(makeRoot(), [
    {
      ts: '2026-07-25T10:00:00.000Z',
      cmd: 'node scripts/verify-evidence.mjs --cycle docs/2026-07-25-x',
      stdout: '⚠ uncited\n  B1  ref t.ts  인용 "B1: REVIEW.md 없이 REPORT.md를 쓰면 차단 + 생성 커맨드 안내" 를 receipt에서 못 찾음\n',
      stderr: '',
    },
  ]);
  const c = checkCitation(ev({ at: '2026-07-25', output: ARCHIVE_B1 }), readReceipts(root));
  assert.equal(c.status, 'uncited', '보고서 출력이 봉인됐다고 위조가 cited가 되면 안 된다');
  assert.deepEqual(c.hits, []);
});

test('R4: 자기 출력을 빼도 실제 실행 receipt는 그대로 대조한다 (탐지력 유지)', () => {
  const root = seedReceipts(makeRoot(), [
    { ts: '2026-07-25T10:00:00.000Z', cmd: 'node scripts/verify-evidence.mjs', stdout: QUOTED, stderr: '' },
    { ts: '2026-07-25T11:00:00.000Z', cmd: 'node --test test/*.test.mjs', stdout: QUOTED, stderr: '' },
  ]);
  assert.equal(checkCitation(ev({ at: '2026-07-25', output: ARCHIVE_B1 }), readReceipts(root)).status, 'cited');
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
  const SIZE = 12288;
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
