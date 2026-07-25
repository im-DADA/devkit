// verify-evidence CLI 계약 — 3층 판정(ref 실존·receipt 인용·커버리지)을 조합해 "보고"한다.
// 차단은 오직 pdca-gate 훅이 한다. 그래서 이 CLI의 exit code는 어떤 상황에도 0이다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(dir, '..');
const CLI = path.join(repoRoot, 'scripts', 'verify-evidence.mjs');

const tmpDirs = [];
function makeRoot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-verify-'));
  fs.mkdirSync(path.join(d, '.git')); // findProjectRoot가 여기를 루트로 잡게 한다
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

// ⚠ node --test는 자식 프로세스에 NODE_TEST_CONTEXT=child-v8을 심는다. 그대로 물려주면
// 손자(이 CLI)가 v8 직렬화 보고 모드로 붙어 stdout이 통째로 사라지는데도 exit=0이 난다.
// 반드시 지우고 띄운다(test/lcov.test.mjs가 같은 함정을 밟았다).
function run(root, args = []) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8', env });
}

function writeCycle(root, id, behaviors) {
  const cycle = path.join(root, 'docs', id);
  fs.mkdirSync(cycle, { recursive: true });
  fs.writeFileSync(
    path.join(cycle, 'behaviors.json'),
    JSON.stringify({ version: 1, cycleId: id, behaviors }, null, 2),
  );
  return cycle;
}

function writeState(root, id) {
  fs.mkdirSync(path.join(root, '.devkit'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.devkit', 'pdca-state.json'),
    JSON.stringify({ version: 1, cycleId: id, stage: 'gap', status: 'in-progress' }),
  );
}

// ── V1: 사이클을 못 정하는 상황 ──────────────────────────
test('V1: 사이클을 못 정하면 안내만 하고 exit 0', () => {
  const root = makeRoot();
  const r = run(root);

  assert.equal(r.status, 0, `보고 도구는 항상 0이다:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /--cycle/, '무엇을 해야 하는지(=--cycle) 안내해야 한다');
});

// ── V2: behaviors.json이 없는 사이클 ─────────────────────
// 아직 /plan을 안 돌린 사이클이 정상 상태다. 여기서 에러를 내면 보고 도구가
// "아직 시작 안 함"을 사고로 취급하게 된다.
test('V2: behaviors.json이 없으면 안내만 하고 exit 0', () => {
  const root = makeRoot();
  const cycle = path.join(root, 'docs', '2026-07-25-empty');
  fs.mkdirSync(cycle, { recursive: true });

  const r = run(root, ['--cycle', 'docs/2026-07-25-empty']);

  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /behaviors\.json/, '무엇이 없는지 지목해야 한다');
  assert.match(r.stdout, /2026-07-25-empty/, '어느 사이클인지 지목해야 한다');
});

// ── V3: 사이클 결정 순서 ─────────────────────────────────
// /gap이 인자 없이 이 CLI를 부르므로, state를 못 읽으면 도구가 아무것도 못 한다.
test('V3: --cycle이 없으면 pdca-state.json의 cycleId로 사이클을 정한다', () => {
  const root = makeRoot();
  writeCycle(root, '2026-07-25-from-state', []);
  writeState(root, '2026-07-25-from-state');

  const r = run(root);

  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(
    r.stdout, /docs\/2026-07-25-from-state\//,
    `헤더가 어느 사이클을 봤는지 밝혀야 한다:\n${r.stdout}`,
  );
});

// ── V4: unresolved — 유일한 게이트 대상 ──────────────────
// "unresolved 1건"만 알려주면 고칠 수가 없다. 어느 behavior의 어느 ref인지 지목해야 한다.
test('V4: unresolved를 게이트 대상으로 명시하고 어느 behavior의 어느 ref인지 지목한다', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'real.js'), 'module.exports = 1;\n');
  writeCycle(root, '2026-07-25-mixed', [
    {
      id: 'B1',
      passes: true,
      evidence: { kind: 'test', ref: 'src/real.js:1', output: '✔ 실존하는 파일을 가리킨다', at: '2026-07-25' },
    },
    {
      id: 'B2',
      passes: true,
      evidence: { kind: 'test', ref: 't.ts', output: '✔ 위조된 통과 주장이다', at: '2026-07-25' },
    },
  ]);

  const r = run(root, ['--cycle', 'docs/2026-07-25-mixed']);

  assert.match(r.stdout, /unresolved: 1/, `게이트 대상 개수를 리터럴로 내야 gap-detector가 옮겨 적는다:\n${r.stdout}`);
  assert.match(r.stdout, /게이트/, `차단되는 층임을 밝혀야 한다:\n${r.stdout}`);
  assert.match(r.stdout, /B2/, `어느 behavior인지 지목:\n${r.stdout}`);
  assert.match(r.stdout, /t\.ts/, `어느 ref인지 지목:\n${r.stdout}`);
  assert.doesNotMatch(r.stdout, /^.*B1.*파일 없음/m, `정직한 B1을 걸면 안 된다:\n${r.stdout}`);
});

/** receipt 봉인 상태를 만든다. ts는 no-receipt(소급 오탐) 판정의 기준선이 된다 */
function writeReceipts(root, records) {
  fs.mkdirSync(path.join(root, '.devkit'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.devkit', 'receipts.jsonl'),
    records.map((r) => JSON.stringify(r)).join('\n') + '\n',
  );
}

// ── V5: 인용 대조 층은 보고이지 차단이 아니다 ────────────
// uncited(인용이 틀림)와 no-receipt(대조할 receipt가 애초에 없음)는 다른 사건이다.
// 뭉치면 봉인 이전 사이클 전부가 경고로 보여 보고가 소음이 된다.
test('V5: uncited와 no-receipt를 구분해 "차단 아님"으로 보고한다', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'real.js'), 'module.exports = 1;\n');
  writeReceipts(root, [
    { ts: '2026-07-25T10:00:00.000Z', cmd: 'node --test', stdout: '✔ 실제로 실행된 문구다', stderr: '' },
  ]);
  const ev = (output, at) => ({ kind: 'test', ref: 'src/real.js', output, at });
  writeCycle(root, '2026-07-25-cite', [
    { id: 'B1', passes: true, evidence: ev('✔ 실제로 실행된 문구다', '2026-07-25') },
    { id: 'B2', passes: true, evidence: ev('✔ receipt에 없는 문구다', '2026-07-25') },
    { id: 'B3', passes: true, evidence: ev('✔ 봉인 이전에 기록된 문구다', '2026-07-24') },
  ]);

  const r = run(root, ['--cycle', 'docs/2026-07-25-cite']);

  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /uncited: 1/, `요약:\n${r.stdout}`);
  assert.match(r.stdout, /no-receipt: 1/, `봉인 이전은 uncited가 아니다:\n${r.stdout}`);
  assert.match(r.stdout, /차단 아님/, `게이트 층과 구분해야 한다:\n${r.stdout}`);
  assert.match(r.stdout, /B2 .*receipt에 없는 문구다/, `어느 인용이 안 맞는지 지목:\n${r.stdout}`);
  assert.match(r.stdout, /B3/, `no-receipt 항목도 지목:\n${r.stdout}`);
  assert.doesNotMatch(r.stdout, /B1 /, `cited는 조용해야 한다(소음 방지):\n${r.stdout}`);
});

// ⚠ 실측: node는 경로에 test/ 세그먼트가 있는 파일을 커버리지에서 제외한다(**/test/** 기본 매처).
// 그래서 여기서는 실제 커버리지를 뽑지 않고 lcov 텍스트를 직접 써넣는다 — 판정 대상은
// verify-evidence의 조합 로직이지 node의 커버리지 수집기가 아니다(그건 lcov.test.mjs가 본다).
const LCOV_FIXTURE = [
  'TN:',
  'SF:src/discount.js',
  'DA:2,3',
  'DA:3,0',
  'BRDA:2,0,0,3',
  'BRDA:2,0,1,-',
  'end_of_record',
  '',
].join('\n');

// ── V6: 커버리지 층의 기본 경로 (열린질문 ②) ─────────────
// /gap이 다중 리포터로 .devkit/lcov.info를 떨어뜨린다. --lcov를 매번 적게 하면
// 배선 한 군데만 빠져도 커버리지 층이 조용히 죽는다 — 관례를 코드에 박는다.
test('V6: --lcov 미지정이면 .devkit/lcov.info를 기본 경로로 읽는다', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'discount.js'), 'x\n'.repeat(5));
  fs.mkdirSync(path.join(root, '.devkit'), { recursive: true });
  fs.writeFileSync(path.join(root, '.devkit', 'lcov.info'), LCOV_FIXTURE);
  const ev = { kind: 'test', ref: 'src/discount.js:2', output: '✔ 할인 계산을 검증했다', at: '2026-07-25' };
  writeCycle(root, '2026-07-25-cov', [
    { id: 'B1', passes: true, target: 'src/discount.js:2', evidence: ev },
    { id: 'B2', passes: true, target: 'src/discount.js:3', evidence: ev },
    { id: 'B3', passes: true, target: 'src/nowhere.js:1', evidence: ev },
  ]);

  const r = run(root, ['--cycle', 'docs/2026-07-25-cov']);

  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /dead-branch: 1/, `요약:\n${r.stdout}`);
  assert.match(r.stdout, /uncovered: 1/, `요약:\n${r.stdout}`);
  assert.match(r.stdout, /B1 .*src\/discount\.js:2/, `도달 불가 분기를 지목:\n${r.stdout}`);
  assert.match(r.stdout, /B2 .*src\/discount\.js:3/, `미실행 라인을 지목:\n${r.stdout}`);
});

// lcov를 안 돌린 상태로 /gap을 부르는 것이 정상 경로다. 그때 커버리지 층은 침묵해야 한다 —
// no-data를 경고로 올리면 커버리지를 안 쓰는 사이클이 전부 빨갛게 보인다.
test('V6: .devkit/lcov.info가 없으면 커버리지 층은 전부 no-data (경고 아님)', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'discount.js'), 'x\n'.repeat(5));
  writeCycle(root, '2026-07-25-nocov', [
    {
      id: 'B1',
      passes: true,
      target: 'src/discount.js:2',
      evidence: { kind: 'test', ref: 'src/discount.js:2', output: '✔ 할인 계산을 검증했다', at: '2026-07-25' },
    },
  ]);

  const r = run(root, ['--cycle', 'docs/2026-07-25-nocov']);

  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /uncovered: 0/, `${r.stdout}`);
  assert.match(r.stdout, /dead-branch: 0/, `${r.stdout}`);
  assert.match(r.stdout, /no-data/, `커버리지를 못 봤다는 사실 자체는 밝혀야 한다:\n${r.stdout}`);
});

// ── V7: exit code는 어떤 상황에도 0 ──────────────────────
// unresolved>0을 exit 1로 만들면 gap-detector의 Bash 호출이 "실패"로 보이고,
// 나아가 보고 도구가 작업을 막는 역할 혼선이 생긴다. 차단은 pdca-gate 훅만 한다.
test('V7: unresolved>0이어도 · 입력이 깨져도 · lcov를 못 읽어도 exit 0', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, '.devkit'), { recursive: true });
  fs.writeFileSync(path.join(root, '.devkit', 'receipts.jsonl'), '{깨진 줄\n{"ts":"2026-07-25T00:00:00.000Z","stdout":"x"}\n');
  writeCycle(root, '2026-07-25-hostile', [
    null, 42, 'nope', [],
    { id: 'B1', passes: true, evidence: { kind: 'test', ref: 't.ts', output: '✔ 없는 파일을 가리킨다', at: '2026-07-25' } },
    { id: 'B2', passes: true, evidence: { kind: 'test', ref: '../../etc/passwd', output: '✔ 루트 밖을 가리킨다', at: '2026-07-25' } },
    { id: 'B3', passes: true, target: 42, evidence: { kind: 'test', ref: 42, output: '✔ ref가 문자열이 아니다', at: '2026-07-25' } },
    { id: 'B4', passes: true, evidence: [] },
  ]);
  // 깨진 JSON 사이클 — readBehaviors가 null로 degrade해야 한다
  const broken = path.join(root, 'docs', '2026-07-25-broken');
  fs.mkdirSync(broken, { recursive: true });
  fs.writeFileSync(path.join(broken, 'behaviors.json'), '{ "behaviors": [ }');

  const cases = [
    ['--cycle', 'docs/2026-07-25-hostile'],
    ['--cycle', 'docs/2026-07-25-hostile', '--lcov', '.devkit'], // 디렉터리 (EISDIR)
    ['--cycle', 'docs/2026-07-25-hostile', '--lcov', 'nope/none.info'], // ENOENT
    ['--cycle', 'docs/2026-07-25-broken'],
    ['--cycle'], // 값 누락
    ['--cycle', 'docs/없는-사이클'],
  ];
  for (const args of cases) {
    const r = run(root, args);
    assert.equal(r.status, 0, `${args.join(' ')} → exit ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.equal(r.signal, null, `${args.join(' ')} 이 시그널로 죽었다: ${r.signal}`);
  }

  // 게이트 대상이 실제로 잡히면서도 exit은 0이어야 의미가 있다
  const r = run(root, ['--cycle', 'docs/2026-07-25-hostile']);
  assert.match(r.stdout, /unresolved: 2/, `깨진 엔트리에 가려 진짜 위조를 놓치면 안 된다:\n${r.stdout}`);
  assert.equal(r.status, 0);
});

// ── V8: 정보성 표시 — 게이트와 무관하다 ──────────────────
// lineDrift를 게이트로 올리면 파일이 줄어드는 정직한 리팩터가 위조로 판정된다(DESIGN §1.2).
// archive 폴백은 반대로 "왜 통과했는지"를 밝히지 않으면 폴백이 조용한 우회처럼 보인다.
test('V8: lineDrift와 archive 폴백을 정보성으로 표시한다 (unresolved에 안 센다)', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'short.js'), 'a\nb\nc\n');
  const archived = path.join(root, 'docs', 'archive', '2026-07-25', 'old');
  fs.mkdirSync(archived, { recursive: true });
  fs.writeFileSync(path.join(archived, 'REVIEW.md'), '# 리뷰\n');
  writeCycle(root, '2026-07-25-info', [
    {
      id: 'B1',
      passes: true,
      evidence: { kind: 'manual', ref: 'docs/2026-07-25-old/REVIEW.md', output: '리뷰를 사람이 읽고 확인했다', at: '2026-07-25' },
    },
    {
      id: 'B2',
      passes: true,
      evidence: { kind: 'test', ref: 'src/short.js:99', output: '✔ 짧은 파일을 검증했다', at: '2026-07-25' },
    },
  ]);

  const r = run(root, ['--cycle', 'docs/2026-07-25-info']);

  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /unresolved: 0/, `아카이빙된 사이클 문서를 위조로 몰면 안 된다:\n${r.stdout}`);
  assert.match(r.stdout, /lineDrift/, `${r.stdout}`);
  assert.match(r.stdout, /B2 .*src\/short\.js:99.*총 3줄/, `어느 ref가 몇 줄짜리인지 밝혀야 한다:\n${r.stdout}`);
  assert.match(r.stdout, /게이트 무관/, `게이트가 아님을 명시해야 한다:\n${r.stdout}`);
  assert.match(
    r.stdout, /B1 .*docs\/2026-07-25-old\/REVIEW\.md.*docs\/archive\/2026-07-25\/old\/REVIEW\.md/,
    `어디로 폴백했는지 밝혀야 조용한 우회로 안 보인다:\n${r.stdout}`,
  );
});

// ── R4: 보고서가 인용 원문을 싣지 않는다 ─────────────────
// 이 stdout은 bash-receipt가 그대로 봉인한다. 원문이 실리면 다음 실행에서
// checkCitation의 부분 문자열 검사에 걸려 위조가 'cited'로 뒤집힌다.
test('R4: uncited 보고는 인용 원문 대신 앞 24자만 싣는다', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'real.js'), 'module.exports = 1;\n');
  writeReceipts(root, [
    { ts: '2026-07-25T10:00:00.000Z', cmd: 'node --test', stdout: '✔ 전혀 관계없는 출력이다', stderr: '' },
  ]);
  const QUOTE = 'B9: 한 번도 실행된 적 없는 위조 주장이고 길이가 24자를 넘는다';
  assert.ok(QUOTE.length > 24, '픽스처가 24자를 넘어야 의미가 있다');
  writeCycle(root, '2026-07-25-selfseal', [
    {
      id: 'B1',
      passes: true,
      evidence: { kind: 'test', ref: 'src/real.js', output: `✔ ${QUOTE}`, at: '2026-07-25' },
    },
  ]);

  const r = run(root, ['--cycle', 'docs/2026-07-25-selfseal']);

  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /uncited: 1/, `${r.stdout}`);
  assert.ok(
    !r.stdout.includes(QUOTE),
    `인용 원문이 보고서에 실렸다 — 봉인되면 다음 실행에서 cited로 뒤집힌다:\n${r.stdout}`,
  );
  assert.ok(
    r.stdout.includes(QUOTE.slice(0, 24)),
    `무엇을 못 찾았는지는 알아볼 수 있어야 한다:\n${r.stdout}`,
  );
  assert.match(
    r.stdout, new RegExp(`총 ${QUOTE.length}자`),
    `절단본과 원문을 구분하려면 총 길이를 밝혀야 한다:\n${r.stdout}`,
  );
});

// 리뷰의 라이브 재현 그대로 — 코드도 evidence도 안 건드리고 같은 명령만 3번 돌리면
// 1회차 uncited 1 → 2회차 보고서가 인용을 stdout에 출력 → 3회차 uncited 0 이었다.
// /gap이 이 명령을 Bash로 돌리라고 리터럴로 박아둔 실사용 경로다(commands/gap.md:31).
test('R4: 같은 명령을 3번 돌려도 위조는 uncited로 남는다 (봉인 자기입증 차단)', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'real.js'), 'module.exports = 1;\n');
  writeReceipts(root, [
    { ts: '2026-07-25T09:00:00.000Z', cmd: 'node --test', stdout: '✔ 전혀 관계없는 출력이다', stderr: '' },
  ]);
  writeCycle(root, '2026-07-25-loop', [
    {
      id: 'B1',
      passes: true,
      evidence: {
        kind: 'test',
        ref: 'src/real.js',
        output: '✔ B1: 한 번도 실행된 적 없는 위조 주장이다 — 실행 로그에 존재할 수 없다',
        at: '2026-07-25',
      },
    },
  ]);

  const CMD = 'node scripts/verify-evidence.mjs --cycle docs/2026-07-25-loop';
  const seen = [];
  for (let i = 0; i < 3; i += 1) {
    const r = run(root, ['--cycle', 'docs/2026-07-25-loop']);
    seen.push((/uncited: (\d+)/.exec(r.stdout) || [])[1]);
    // PostToolUse(Bash)가 이 실행을 봉인한다 — 실사용에서 자동으로 일어나는 일이다
    spawnSync(process.execPath, [path.join(repoRoot, 'hooks', 'bash-receipt.js')], {
      input: JSON.stringify({
        tool_input: { command: CMD },
        tool_response: { stdout: r.stdout, stderr: r.stderr, interrupted: false },
      }),
      cwd: root,
      encoding: 'utf8',
    });
  }

  assert.deepEqual(seen, ['1', '1', '1'], `보고서가 스스로를 입증해 탐지력이 0으로 수렴했다: ${seen.join(' → ')}`);
});

// ── R3: 막는 쪽과 보고하는 쪽의 root가 같아야 한다 ────────
// 게이트는 findProjectRoot(cycleDir), CLI는 findProjectRoot(process.cwd())였다.
// 워크스페이스 패키지가 자기 package.json을 가지면 두 값이 갈리고, 사용자는
// "unresolved: 0"을 보고 REPORT.md를 쓰다가 원인 불명으로 차단된다
// (DESIGN 설계원칙 6 — 막는 쪽과 만드는 쪽의 판정 근거는 대칭).
test('R3: 모노레포에서 CLI가 게이트와 같은 root로 판정한다', () => {
  const mono = makeRoot(); // .git + 여기가 cwd
  fs.writeFileSync(path.join(mono, 'package.json'), '{"name":"mono"}\n');
  const pkg = path.join(mono, 'pkg');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), '{"name":"pkg"}\n'); // 여기가 게이트의 root

  // 파일은 모노레포 루트에만 있다 — pkg를 root로 보면 없는 파일이다
  fs.mkdirSync(path.join(mono, 'src'));
  fs.writeFileSync(path.join(mono, 'src', 'real.js'), 'module.exports = 1;\n');

  const cycle = path.join(pkg, 'docs', '2026-07-25-mono');
  fs.mkdirSync(cycle, { recursive: true });
  fs.writeFileSync(path.join(cycle, 'GAP.md'), '# gap\n');
  fs.writeFileSync(path.join(cycle, 'REVIEW.md'), '# review\n');
  fs.writeFileSync(path.join(cycle, 'behaviors.json'), JSON.stringify({
    version: 1,
    cycleId: '2026-07-25-mono',
    behaviors: [{
      id: 'B1',
      passes: true,
      evidence: { kind: 'test', ref: 'src/real.js:1', output: '✔ 모노레포 경로를 검증했다', at: '2026-07-25' },
    }],
  }));

  // 게이트: REPORT.md Write를 시도한다
  const gate = spawnSync(
    process.execPath, [path.join(repoRoot, 'hooks', 'pdca-gate.js')],
    {
      input: JSON.stringify({ tool_input: { file_path: path.join(cycle, 'REPORT.md'), content: '# 보고\n' } }),
      cwd: mono,
      encoding: 'utf8',
    },
  );
  const blocked = gate.status === 2;

  const r = run(mono, ['--cycle', 'pkg/docs/2026-07-25-mono']);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const reported = /unresolved: 0/.test(r.stdout);

  assert.equal(
    blocked, !reported,
    '게이트와 CLI가 갈렸다 — CLI는 "unresolved: 0"인데 REPORT.md가 차단되면 원인 불명 데드락이다\n'
    + `gate exit=${gate.status} stderr=${gate.stderr}\nCLI:\n${r.stdout}`,
  );
  // 방향까지 고정한다 — 둘 다 "통과"로 수렴해도 대칭은 성립하므로 그것만 보면 위조가 샌다.
  // pkg가 root이므로 src/real.js는 실제로 없는 파일이고, 양쪽 다 그렇게 말해야 한다.
  assert.equal(blocked, true, `게이트가 막아야 한다: exit=${gate.status}`);
  assert.match(r.stdout, /unresolved: 1/, `CLI도 같은 판정을 내야 한다:\n${r.stdout}`);
});

// ── V9: --json — 기계가 읽는 출력 ────────────────────────
// 사람용 출력에 JSON을 섞으면 둘 다 못 쓴다. --json이면 파싱 가능한 JSON 하나만 낸다.
test('V9: --json은 파싱 가능한 JSON 하나만 내고 counts가 사람용과 일치한다', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'discount.js'), 'x\n'.repeat(5));
  fs.mkdirSync(path.join(root, '.devkit'), { recursive: true });
  fs.writeFileSync(path.join(root, '.devkit', 'lcov.info'), LCOV_FIXTURE);
  writeCycle(root, '2026-07-25-json', [
    {
      id: 'B1',
      passes: true,
      target: 'src/discount.js:2',
      evidence: { kind: 'test', ref: 't.ts', output: '✔ 없는 파일을 가리킨다', at: '2026-07-25' },
    },
  ]);

  const r = run(root, ['--cycle', 'docs/2026-07-25-json', '--json']);

  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  let doc;
  assert.doesNotThrow(() => { doc = JSON.parse(r.stdout); }, `JSON 하나만 나와야 한다:\n${r.stdout}`);
  assert.equal(doc.cycle, 'docs/2026-07-25-json');
  assert.equal(doc.counts.unresolved, 1);
  assert.equal(doc.counts.deadBranch, 1);

  const b1 = doc.behaviors.find((b) => b.id === 'B1');
  assert.equal(b1.ref, 't.ts', `어느 ref인지 기계도 알아야 한다:\n${r.stdout}`);
  assert.equal(b1.refStatus, 'unresolved');
  assert.deepEqual(b1.missing, ['t.ts']);
  assert.equal(b1.coverage, 'dead-branch');

  // 사람용과 같은 판정이어야 한다 — 두 출력이 갈리면 어느 쪽을 믿을지 알 수 없다
  const human = run(root, ['--cycle', 'docs/2026-07-25-json']);
  assert.match(human.stdout, /unresolved: 1/, human.stdout);
  assert.match(human.stdout, /dead-branch: 1/, human.stdout);
});
