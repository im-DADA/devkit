// 커버리지 판정 계약 — "evidence가 가리키는 코드가 실제로 실행됐는가".
// ref(파일 실존)·receipt(인용)와 다른 축이다: 여기서만 "테스트가 그 줄을 지나갔는가"를 본다.
// 이 층은 절대 throw하지 않는다 — lcov 부재·파싱 실패는 no-data로 degrade한다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(dir, '..');
const require = createRequire(import.meta.url);
const { parseLcov, parseTarget, classifyTarget } = require(path.join(repoRoot, 'hooks', 'lib', 'lcov.js'));

const tmpDirs = [];
function makeRoot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-lcov-'));
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

// ── B13: lcov 파싱 ───────────────────────────────────────
// 실측 형식(node v24.7.0 --test-reporter=lcov): SF는 레포 루트 기준 상대경로로 나온다.
const LCOV = [
  'TN:',
  'SF:hooks/lib/behaviors.js',
  'FN:12,summarize',
  'FNDA:3,summarize',
  'DA:12,3',
  'DA:13,0',
  'DA:14,1',
  'BRDA:12,0,0,3',
  'BRDA:12,0,1,-',
  'BRDA:14,0,0,0',
  'LF:3',
  'LH:2',
  'BRF:3',
  'BRH:1',
  'end_of_record',
  'TN:',
  'SF:hooks/lib/audit.js',
  'DA:1,5',
  'end_of_record',
  '',
].join('\n');

test('B13: DA는 라인별 실행 횟수, BRDA는 분기별 taken으로 파싱한다', () => {
  const cov = parseLcov(LCOV, repoRoot);

  assert.deepEqual(Object.keys(cov).sort(), ['hooks/lib/audit.js', 'hooks/lib/behaviors.js']);
  assert.deepEqual(cov['hooks/lib/behaviors.js'].lines, { 12: 3, 13: 0, 14: 1 });
  assert.deepEqual(cov['hooks/lib/audit.js'].lines, { 1: 5 });
});

// lcov 표준에서 taken '-'는 "블록 자체가 실행되지 않음"이고 0은 "분기를 안 탐"이다.
// 둘 다 미실행인데 '-'를 NaN이나 문자열로 두면 dead-branch 판정이 조용히 새어나간다.
test("B13: BRDA taken이 '-' 이든 0이든 미실행(0)으로 파싱된다", () => {
  const cov = parseLcov(LCOV, repoRoot);
  assert.deepEqual(cov['hooks/lib/behaviors.js'].branches, [
    { line: 12, block: 0, branch: 0, taken: 3 },
    { line: 12, block: 0, branch: 1, taken: 0 },
    { line: 14, block: 0, branch: 0, taken: 0 },
  ]);
});

// SF가 절대경로로 나오는 환경(다른 Node 버전/러너)에서도 키가 같아야 한다.
// macOS의 /var → /private/var 심볼릭 링크가 섞이면 상대경로 계산이 어긋난다 —
// mkdtempSync 임시 디렉터리를 쓰는 테스트는 이 함정을 실제로 밟는다.
test('B13: SF가 절대경로여도 root 기준 상대 posix 경로로 정규화한다', () => {
  const root = makeRoot();
  const real = fs.realpathSync(root);
  const text = [
    `SF:${path.join(real, 'src', 'a.js')}`, 'DA:1,1', 'end_of_record',
    `SF:${path.join(root, 'src', 'b.js')}`, 'DA:2,0', 'end_of_record', '',
  ].join('\n');

  const cov = parseLcov(text, root);
  assert.deepEqual(Object.keys(cov).sort(), ['src/a.js', 'src/b.js'], `심볼릭 링크 정규화 실패: ${Object.keys(cov)}`);
});

test('B13: 빈 입력·비문자열·알 수 없는 레코드에 throw하지 않는다', () => {
  assert.deepEqual(parseLcov('', repoRoot), {});
  assert.deepEqual(parseLcov(null, repoRoot), {});
  assert.deepEqual(parseLcov('GARBAGE\nSF:\nDA:x,y\n', repoRoot), {});
});

// ── B14: 도달 불가 분기 검출 (이번 사이클의 가설 판정 항목) ──
// D12는 "테스트가 통과했으니 검증됐다"는 주장이 거짓인 사례였다. 여기서는 그 시드를
// 그대로 재현해 커버리지가 실제로 잡아내는지를 라이브로 판정한다.
// ⚠ 이 테스트가 실패하면(=lcov가 BRDA taken=0을 내지 않으면) 지우거나 기대값을
//   낮추지 않는다. 그건 정확히 이 사이클이 막으려는 행위다 — RED로 남기고 L3b로 이월한다.
const SEED_DIR = path.join(dir, 'fixtures', 'dead-branch');
const SRC = 'seed/discount.js';

// ⚠ 실측(node v24.7.0): 경로에 `test/` 세그먼트가 있는 파일은 전부 "테스트 파일"로
// 간주돼 커버리지 리포트에서 제외된다(`**/test/**/*.js` 기본 매처). cwd를 바꿔도,
// --test-coverage-include를 줘도 되돌아오지 않는다 — 시드를 test/fixtures/에 그대로
// 두면 SF 레코드가 아예 안 나온다. 시드 위치는 기본 실행 glob 회피 때문에 못 옮기므로
// 커버리지 수집만 임시 디렉터리 사본에서 한다(소스·주장 테스트 모두 레포 원본 그대로).
function collectCoverage() {
  const work = makeRoot();
  fs.cpSync(SEED_DIR, path.join(work, 'seed'), { recursive: true });
  const out = path.join(work, 'lcov.info');
  // node --test는 자식 테스트 프로세스에 NODE_TEST_CONTEXT=child-v8을 심는다.
  // 그대로 물려주면 손자 프로세스가 v8 직렬화 보고 모드로 붙어 --test-reporter를 무시하고
  // lcov 파일을 아예 안 쓴다(실측: ENOENT). 반드시 지우고 띄운다.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;

  const r = spawnSync(process.execPath, [
    '--test', '--experimental-test-coverage',
    '--test-reporter=lcov', `--test-reporter-destination=${out}`,
    'seed/discount.fixture.test.mjs',
  ], { cwd: work, encoding: 'utf8', env });
  assert.equal(r.status, 0, `픽스처 테스트가 통과해야 커버리지가 의미 있다:\n${r.stdout}\n${r.stderr}`);
  return { text: fs.readFileSync(out, 'utf8'), work };
}

/** 실패 메시지에 실측 lcov 원문을 싣는다 — 가설 기각을 원문으로 판단할 수 있어야 한다 */
function sfBlock(text, key) {
  const m = text.split('SF:').find((b) => b.startsWith(key));
  return m === undefined ? `(SF:${key} 블록 없음)\n${text}` : `SF:${m}`;
}

test('B14: 도달 불가 분기를 dead-branch로 검출한다 (D12 시드 재현)', () => {
  const { text, work } = collectCoverage();
  const cov = parseLcov(text, work);
  assert.ok(cov[SRC], `lcov에 시드 소스가 없다:\n${text}`);

  const r = classifyTarget(cov, `${SRC}:2`);
  assert.equal(r.status, 'dead-branch', `가설 기각 — 실측 lcov:\n${sfBlock(text, SRC)}`);
  assert.ok(
    r.deadBranches.some((b) => b.line === 2),
    `분기 조건 라인(2)이 지목되지 않았다: ${JSON.stringify(r.deadBranches)}\n${sfBlock(text, SRC)}`,
  );
});

// 우선순위 계약: dead-branch > uncovered. 블록 안(line 3)은 DA hits=0이라 두 신호가
// 동시에 뜨는데, uncovered를 먼저 보면 "테스트를 안 짰네"로 오독된다.
test('B14: 블록 안 미실행 라인까지 범위에 넣어도 dead-branch가 우선한다', () => {
  const { text, work } = collectCoverage();
  const cov = parseLcov(text, work);

  const r = classifyTarget(cov, `${SRC}:2-3`);
  assert.equal(r.status, 'dead-branch', `우선순위가 뒤집혔다:\n${sfBlock(text, SRC)}`);
  assert.ok(
    r.uncoveredLines.includes(3),
    `블록 안 미실행 라인을 잃어버렸다: ${JSON.stringify(r.uncoveredLines)}\n${sfBlock(text, SRC)}`,
  );
});

// ── B15: 실행되지 않은 라인 보고 ─────────────────────────
test('B15: 범위 안에 hits=0 라인이 있으면 uncovered로 보고한다', () => {
  const cov = parseLcov([
    'SF:src/a.js', 'DA:10,1', 'DA:11,0', 'DA:12,0', 'DA:20,0', 'end_of_record', '',
  ].join('\n'), repoRoot);

  const r = classifyTarget(cov, 'src/a.js:10-12');
  assert.equal(r.status, 'uncovered');
  assert.deepEqual(r.uncoveredLines, [11, 12], '범위 밖(20)까지 끌고 오면 안 된다');
  assert.deepEqual(r.deadBranches, []);

  // 전부 실행된 범위는 covered — uncovered를 남발하면 보고가 소음이 된다
  assert.equal(classifyTarget(cov, 'src/a.js:10').status, 'covered');
});

// DESIGN §5.3의 관례("target은 분기 *조건* 라인을 가리킨다")를 라이브로 고정한다.
// 블록 안(:3)을 겨냥하면 dead-branch가 아니라 uncovered만 나온다 — 이 차이를 모르면
// target을 한 줄 아래로 적어놓고 "도달 불가 분기를 검출한다"고 오해한다.
test('B15: 같은 시드라도 블록 안(:3)을 겨냥하면 uncovered다 (dead-branch가 아니다)', () => {
  const { text, work } = collectCoverage();
  const r = classifyTarget(parseLcov(text, work), `${SRC}:3`);
  assert.equal(r.status, 'uncovered', sfBlock(text, SRC));
  assert.deepEqual(r.uncoveredLines, [3]);
  assert.deepEqual(r.deadBranches, [], '분기는 조건 라인(2)에 붙는다');
});

// ── B16: target이 없으면 판정을 건너뛴다 (하위호환) ────────
// 기존 사이클의 behaviors.json에는 target 필드가 아예 없다. 그걸 no-data(= 커버리지
// 미수집)로 뭉치면 과거 사이클 전부가 경고로 보여 보고가 못 쓰게 된다. 둘은 다른 사건이다.
test('B16: parseTarget — 라인 · 범위 · 파일 전체 · 해석 불가', () => {
  assert.deepEqual(parseTarget('hooks/lib/lcov.js:2'), { path: 'hooks/lib/lcov.js', from: 2, to: 2 });
  assert.deepEqual(parseTarget('hooks/lib/lcov.js:2-9'), { path: 'hooks/lib/lcov.js', from: 2, to: 9 });
  assert.deepEqual(parseTarget('hooks/lib/lcov.js'), { path: 'hooks/lib/lcov.js', from: 1, to: Infinity });
  assert.deepEqual(parseTarget(' ./hooks/lib/lcov.js:2 '), { path: 'hooks/lib/lcov.js', from: 2, to: 2 }, 'parseLcov 키와 같은 형태로 정규화돼야 조회가 된다');

  // 콜론 뒤가 식별자면 라인을 알 수 없다 — 파일 전체로 승격하면 없는 경로를 조회해
  // no-data(=커버리지 미수집)로 오독된다. 해석 불가는 그냥 건너뛴다.
  assert.equal(parseTarget('hooks/lib/lcov.js:classifyTarget'), null);
  for (const t of [null, undefined, '', '   ', 42, {}]) assert.equal(parseTarget(t), null, String(t));
});

test('B16: target이 없는 behavior는 skipped (no-data가 아니다)', () => {
  const cov = parseLcov('SF:src/a.js\nDA:1,0\nend_of_record\n', repoRoot);
  for (const t of [null, undefined, '', 42]) {
    const r = classifyTarget(cov, t);
    assert.equal(r.status, 'skipped', String(t));
    assert.deepEqual(r.uncoveredLines, []);
    assert.deepEqual(r.deadBranches, []);
  }
});

// 이 층은 보고 도구다. 커버리지를 안 돌린 상태에서 판정을 부르는 일이 정상 경로에 있다.
test('B16: lcov가 없거나 그 파일이 안 잡혔으면 no-data — throw하지 않는다', () => {
  const empty = parseLcov(fsReadOrEmpty(path.join(makeRoot(), 'nope.info')), repoRoot);
  let r;
  assert.doesNotThrow(() => { r = classifyTarget(empty, 'hooks/lib/lcov.js:2'); });
  assert.equal(r.status, 'no-data');
  assert.deepEqual(r.uncoveredLines, []);
  assert.deepEqual(r.deadBranches, []);

  assert.equal(classifyTarget({}, 'src/a.js').status, 'no-data');
  assert.equal(classifyTarget(null, 'src/a.js').status, 'no-data', 'cov 자체가 없어도 죽지 않는다');
});

/** lcov 파일이 없는 정상 상황 — 읽기 실패를 판정 계층까지 끌고 가지 않는다 */
function fsReadOrEmpty(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return '';
  }
}
