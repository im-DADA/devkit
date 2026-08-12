// verify-runner.js — 실행 계약(IO 경계). tmp 프로젝트를 실제로 만들어 spawn한다.
// (docs/2026-08-12-verification-runtime/ X1~X9)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { runVerification } = require_(path.join(dir, '..', 'hooks', 'lib', 'verify-runner.js'));
const { acquire, release } = require_(path.join(dir, '..', 'hooks', 'lib', 'single-flight.js'));

const tmpDirs = [];
/** scripts를 가진 tmp 프로젝트. 러너는 npm(기본) */
function makeProject(scripts, extra = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-verify-'));
  tmpDirs.push(d);
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'tmp', scripts }));
  for (const [rel, body] of Object.entries(extra)) {
    fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true });
    fs.writeFileSync(path.join(d, rel), body);
  }
  return d;
}
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

const TYPE_ERR = 'src/a.ts(1,1): error TS2322: Type string is not assignable to type number.';

// ⚠ `node -e "…"`로 픽스처를 쓰지 않는다. 스크립트 본문은 package.json → 셸을 거치므로
// 중첩 따옴표가 조용히 깨져 "출력이 없는 실패"가 되고, 그러면 테스트가 파서를 검증하는 게
// 아니라 셸 인용 규칙을 검증하게 된다(실제로 한 번 그렇게 헛돌았다).
let fixtureSeq = 0;
/** 지정한 줄을 stdout에 찍고 code로 종료하는 스크립트 파일을 만들어 명령을 돌려준다 */
function emitsIn(root, line, code = 1) {
  const name = `.fixture-${fixtureSeq++}.js`;
  fs.writeFileSync(
    path.join(root, name),
    `console.log(${JSON.stringify(line)});\nprocess.exit(${code});\n`,
  );
  return `node ${name}`;
}
/** 지정 줄을 찍는 스크립트를 kind로 등록한 프로젝트 */
function makeEmitProject(kind, line, code = 1) {
  const root = makeProject({});
  const cmd = emitsIn(root, line, code);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'tmp', scripts: { [kind]: cmd } }));
  return root;
}
/** 영원히 살아 있는 스크립트 — setTimeout(9e9)는 32비트 오버플로로 즉시 끝난다 */
const FOREVER = 'node -e "setInterval(function(){}, 1000)"';

test('X1: 스크립트 없음 → unavailable/no-script, spawn하지 않는다', () => {
  const root = makeProject({ build: 'echo hi' });
  const r = runVerification(root, { kind: 'typecheck' });
  assert.equal(r.status, 'unavailable');
  assert.equal(r.meta.reason, 'no-script');
  assert.equal(r.meta.script, null);
  assert.equal(r.meta.exitCode, null, 'spawn하지 않았어야 함');
});

test('X2: 성공 → ok, 진단 없음', () => {
  const root = makeProject({ typecheck: 'node -e ""' });
  const r = runVerification(root, { kind: 'typecheck' });
  assert.equal(r.status, 'ok');
  assert.equal(r.diagnostics, '');
});

test('X3: 타입 에러 → found + 본문 포함', () => {
  const root = makeEmitProject('typecheck', TYPE_ERR);
  const r = runVerification(root, { kind: 'typecheck' });
  assert.equal(r.status, 'found');
  assert.match(r.diagnostics, /TS2322/);
  assert.equal(r.meta.totalDiagnostics, 1);
});

test('X4: 느린 스크립트 → failed/timeout, 보고에 "타입 에러"가 없다', () => {
  const root = makeProject({ typecheck: FOREVER });
  const r = runVerification(root, { kind: 'typecheck', timeoutMs: 1500 });
  assert.equal(r.status, 'failed');
  assert.equal(r.meta.reason, 'timeout');
  assert.equal(r.meta.timedOut, true);
  // 이 사이클의 핵심: 실행 실패를 타입 에러라고 말하지 않는다
  assert.doesNotMatch(r.diagnostics, /타입 에러/);
});

test('X5: 설정 오류 → failed/config-error + 원문 보존', () => {
  const root = makeEmitProject('typecheck', "error TS5083: Cannot read file '/x/tsconfig.json'.");
  const r = runVerification(root, { kind: 'typecheck' });
  assert.equal(r.status, 'failed');
  assert.equal(r.meta.reason, 'config-error');
  assert.match(r.diagnostics, /TS5083/, '원인을 그대로 보여야 사용자가 알아본다');
});

test('X6: 러너 실행 불가 → unavailable/runner-missing (throw 없음)', () => {
  const root = makeProject({ typecheck: 'node -e ""' });
  const r = runVerification(root, { kind: 'typecheck', env: { PATH: '' } });
  assert.equal(r.status, 'unavailable');
  assert.equal(r.meta.reason, 'runner-missing');
});

test('X7: 살아 있는 락 → skipped/lock-held, spawn하지 않는다', () => {
  const root = makeEmitProject('typecheck', TYPE_ERR);
  const held = acquire(root, 'typecheck');
  const r = runVerification(root, { kind: 'typecheck' });
  release(held);
  assert.equal(r.status, 'skipped');
  assert.equal(r.meta.reason, 'lock-held');
  assert.equal(r.meta.exitCode, null);
});

test('X8: 죽은 PID + 오래된 락 → 정상 실행된다 (B10)', () => {
  const root = makeProject({ typecheck: 'node -e ""' });
  const lock = path.join(root, '.devkit', 'verify-typecheck.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, JSON.stringify({ pid: 999999, host: os.hostname(), kind: 'typecheck' }));
  const old = Date.now() - 10 * 60 * 1000;
  fs.utimesSync(lock, old / 1000, old / 1000);
  const r = runVerification(root, { kind: 'typecheck' });
  assert.equal(r.status, 'ok', '버려진 락에 영원히 막히면 안 된다');
});

test('X9: 실행 후 락이 남지 않는다 (성공·진단·타임아웃 3경로)', () => {
  const cases = [
    ['clean', {}],
    ['diag', {}],
    ['timeout', { timeoutMs: 1200 }],
  ];
  for (const [mode, opts] of cases) {
    const root = mode === 'diag'
      ? makeEmitProject('typecheck', TYPE_ERR)
      : makeProject({ typecheck: mode === 'timeout' ? FOREVER : 'node -e ""' });
    runVerification(root, { kind: 'typecheck', ...opts });
    assert.equal(
      fs.existsSync(path.join(root, '.devkit', 'verify-typecheck.lock')), false,
      `락이 남았다: ${mode}`,
    );
  }
});

test('X3b: lint는 exit 1 + 출력 = found, exit 2 = failed', () => {
  const found = makeEmitProject('lint', 'a.ts:1:1  error  no-unused-vars', 1);
  assert.equal(runVerification(found, { kind: 'lint' }).status, 'found');
  const failed = makeProject({ lint: 'node -e "process.exit(2)"' });
  const r = runVerification(failed, { kind: 'lint' });
  assert.equal(r.status, 'failed');
});

test('R1: 패키지 매니저 감지 결과가 meta에 남는다', () => {
  const root = makeProject({ typecheck: 'node -e ""' });
  assert.equal(runVerification(root, { kind: 'typecheck' }).meta.runner, 'npm');
  const pnpm = makeProject({ typecheck: 'node -e ""' }, { 'pnpm-lock.yaml': '' });
  assert.equal(runVerification(pnpm, { kind: 'typecheck', dryRun: true }).meta.runner, 'pnpm');
});

test('R2: direct-tsc는 tsc 바이너리가 있을 때만 선택된다', () => {
  // 바이너리가 없으면 안전 조건 4가 깨지므로 스크립트 경로로 간다.
  const root = makeProject({ typecheck: 'tsc --noEmit' }, { 'tsconfig.json': '{}' });
  assert.equal(runVerification(root, { kind: 'typecheck', dryRun: true }).meta.mode, 'script');
});

test('R3: 복합 명령은 우회하지 않는다 (놓치는 일이 생기면 안 된다)', () => {
  const root = makeProject(
    { typecheck: 'npm run gen && tsc --noEmit' },
    { 'tsconfig.json': '{}', 'node_modules/.bin/tsc': '#!/bin/sh\nexit 0\n' },
  );
  fs.chmodSync(path.join(root, 'node_modules', '.bin', 'tsc'), 0o755);
  assert.equal(runVerification(root, { kind: 'typecheck', dryRun: true }).meta.mode, 'script');
});

test('R4: 단일 tsc + 바이너리 존재 → direct-tsc + incremental 플래그', () => {
  const root = makeProject(
    { typecheck: 'tsc --noEmit' },
    { 'tsconfig.json': '{}', 'node_modules/.bin/tsc': '#!/bin/sh\nexit 0\n' },
  );
  fs.chmodSync(path.join(root, 'node_modules', '.bin', 'tsc'), 0o755);
  const r = runVerification(root, { kind: 'typecheck', dryRun: true });
  assert.equal(r.meta.mode, 'direct-tsc');
  assert.ok(r.meta.argv.includes('--incremental'), 'B4: incremental이 붙어야 함');
  assert.ok(
    r.meta.argv.some((a) => a.endsWith(path.join('.devkit', 'tsbuildinfo'))),
    'tsBuildInfo가 .devkit/ 아래여야 함',
  );
});

test('R5: DEVKIT_VERIFY_MODE=script는 우회를 강제로 끈다 (탈출구)', () => {
  const root = makeProject(
    { typecheck: 'tsc --noEmit' },
    { 'tsconfig.json': '{}', 'node_modules/.bin/tsc': '#!/bin/sh\nexit 0\n' },
  );
  fs.chmodSync(path.join(root, 'node_modules', '.bin', 'tsc'), 0o755);
  const r = runVerification(root, { kind: 'typecheck', mode: 'script', dryRun: true });
  assert.equal(r.meta.mode, 'script');
});

test('R6: 프로젝트가 아니어도(package.json 없음) throw하지 않는다', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-nopkg-'));
  tmpDirs.push(d);
  const r = runVerification(d, { kind: 'typecheck' });
  assert.equal(r.status, 'unavailable');
});

// ── /iterate: GAP이 실측으로 반증한 것들 ──────────────────────────
// GAP이 세 가지를 잡았다. 전부 "테스트 이름은 맞는데 테스트가 그걸 검증하지 않던" 유형이다.

test('G1: DEVKIT_VERIFY_MODE=script(env)가 실제로 우회를 끈다', () => {
  // 기존 R5는 { mode:'script' } 옵션을 직접 넘겨서, env 배선이 통째로 빠진 걸 못 잡았다.
  // README가 존재하지 않는 탈출구를 문서화하는 상태였다 — 결정 3 🔴의 유일한 사용자측 수단.
  const root = makeProject(
    { typecheck: 'tsc --noEmit' },
    { 'tsconfig.json': '{}', 'node_modules/.bin/tsc': '#!/bin/sh\nexit 0\n' },
  );
  fs.chmodSync(path.join(root, 'node_modules', '.bin', 'tsc'), 0o755);
  const before = process.env.DEVKIT_VERIFY_MODE;
  try {
    delete process.env.DEVKIT_VERIFY_MODE;
    assert.equal(runVerification(root, { kind: 'typecheck', dryRun: true }).meta.mode, 'direct-tsc');
    process.env.DEVKIT_VERIFY_MODE = 'script';
    assert.equal(runVerification(root, { kind: 'typecheck', dryRun: true }).meta.mode, 'script');
  } finally {
    if (before === undefined) delete process.env.DEVKIT_VERIFY_MODE;
    else process.env.DEVKIT_VERIFY_MODE = before;
  }
});

test('G2: references 검사가 -p 대상 tsconfig에 걸린다 (root만 보면 안 된다)', () => {
  // root tsconfig.json은 깨끗한데 -p 대상에 references가 있는 배치. 이걸 통과시키면
  // 참조 프로젝트를 안 도는 direct-tsc가 ok를 보고한다 = 조용한 거짓 음성.
  const root = makeProject(
    { typecheck: 'tsc --noEmit -p tsconfig.build.json' },
    {
      'tsconfig.json': '{}',
      'tsconfig.build.json': JSON.stringify({ references: [{ path: '../x' }] }),
      'node_modules/.bin/tsc': '#!/bin/sh\nexit 0\n',
    },
  );
  fs.chmodSync(path.join(root, 'node_modules', '.bin', 'tsc'), 0o755);
  assert.equal(runVerification(root, { kind: 'typecheck', dryRun: true }).meta.mode, 'script');
});

test('G2b: composite도 -p 대상에서 잡힌다', () => {
  const root = makeProject(
    { typecheck: 'tsc --noEmit --project cfg.json' },
    {
      'tsconfig.json': '{}',
      'cfg.json': JSON.stringify({ compilerOptions: { composite: true } }),
      'node_modules/.bin/tsc': '#!/bin/sh\nexit 0\n',
    },
  );
  fs.chmodSync(path.join(root, 'node_modules', '.bin', 'tsc'), 0o755);
  assert.equal(runVerification(root, { kind: 'typecheck', dryRun: true }).meta.mode, 'script');
});

test('G3: incremental을 거부하는 TS에서 스크립트로 폴백한다 (unproven 해소)', () => {
  // GAP: 이 분기는 코드에 있는데 한 번도 실행된 적이 없었다(lcov 미실행).
  // TS 4.5.5·5.9.3이 조합을 받아들여 현실에서 필요가 없었을 뿐, 낮은 버전에서 도는지는 몰랐다.
  // --incremental을 받으면 TS5074로 죽고, 없으면 통과하는 가짜 tsc로 그 버전을 재현한다.
  const stub = [
    '#!/bin/sh',
    'for a in "$@"; do',
    '  if [ "$a" = "--incremental" ]; then',
    "    echo \"error TS5074: Option '--incremental' cannot be specified with option '--noEmit'.\"",
    '    exit 1',
    '  fi',
    'done',
    'exit 0',
  ].join('\n');
  const root = makeProject(
    { typecheck: 'tsc --noEmit' },
    { 'tsconfig.json': '{}', 'node_modules/.bin/tsc': stub },
  );
  fs.chmodSync(path.join(root, 'node_modules', '.bin', 'tsc'), 0o755);

  // ⚠ buildinfo를 **미리 만들어 둔다.** 안 그러면 stub이 즉시 죽어 파일이 애초에 안 생기고,
  // "지워졌다" 단언이 자명하게 참이 된다(REVIEW 뮤테이션으로 실증: rmSync를 지워도 통과했다).
  fs.mkdirSync(path.join(root, '.devkit'), { recursive: true });
  fs.writeFileSync(path.join(root, '.devkit', 'tsbuildinfo'), 'stale');

  const r = runVerification(root, { kind: 'typecheck' });
  assert.equal(r.meta.fallback, 'incremental-unsupported', '폴백이 발동해야 함');
  assert.equal(r.meta.mode, 'script', '스크립트 경로로 넘어가야 함');
  assert.equal(r.status, 'ok', '우리가 붙인 플래그 때문에 생긴 실패를 사용자 코드 문제로 보고하면 안 된다');
  assert.equal(
    fs.existsSync(path.join(root, '.devkit', 'tsbuildinfo')), false,
    '폴백하면서 우리가 만든 buildinfo를 지워야 한다',
  );
});

test('G4: direct-tsc가 실제로 spawn되고 tsBuildInfo 인자를 그대로 받는다', () => {
  // 기존 R2~R5는 전부 dryRun이라 direct 경로의 실제 실행을 아무도 안 봤다.
  // stub이 --tsBuildInfoFile의 값을 찾아 그 경로에 파일을 만든다 — 인자가 실제로 전달됐다는 증거.
  const stub = [
    '#!/bin/sh',
    'prev=""',
    'for a in "$@"; do',
    '  if [ "$prev" = "--tsBuildInfoFile" ]; then : > "$a"; fi',
    '  prev="$a"',
    'done',
    'exit 0',
  ].join('\n');
  const root = makeProject(
    { typecheck: 'tsc --noEmit' },
    { 'tsconfig.json': '{}', 'node_modules/.bin/tsc': stub },
  );
  fs.chmodSync(path.join(root, 'node_modules', '.bin', 'tsc'), 0o755);
  const r = runVerification(root, { kind: 'typecheck' });
  assert.equal(r.meta.mode, 'direct-tsc');
  assert.equal(r.status, 'ok');
  assert.ok(r.meta.argv.includes('--incremental'));
  assert.ok(
    fs.existsSync(path.join(root, '.devkit', 'tsbuildinfo')),
    '--tsBuildInfoFile 인자가 실제로 tsc에 전달돼야 한다',
  );
});

// DESIGN 배선: 외부 TS 프로젝트가 필요한 측정이 CI를 깨지 않게 하되, 있으면 자동으로 돈다.
test('B5 bench: DEVKIT_BENCH_PROJECT가 있으면 실측, 없으면 skip', { skip: !process.env.DEVKIT_BENCH_PROJECT }, () => {
  const out = execFileSync('node', [
    path.join(dir, '..', 'scripts', 'bench-verify.mjs'),
    '--project', process.env.DEVKIT_BENCH_PROJECT, '--runs', '2',
  ], { encoding: 'utf8', timeout: 600000 });
  const json = JSON.parse(out.trim().split('\n').pop());
  assert.equal(json.mode, 'direct-tsc');
  assert.equal(json.allWarmFasterThanCold, true, `warm이 cold보다 느리다: ${JSON.stringify(json)}`);
});

// ── REVIEW 대응: 실측으로 잡힌 🔴들 ───────────────────────────────

test('R7: pretty 형식(tsc 기본값) 출력도 found로 분류된다', () => {
  // 🔴 script 모드에서는 --pretty false를 우리가 못 붙인다. 파서가 괄호 형식만 알면
  // **진짜 타입 에러가 "검증이 실행되지 못했다"로 나간다** — 거짓 보고의 반대 방향이다.
  const root = makeEmitProject('typecheck', "src/a.ts:1:7 - error TS2322: Type 'string' is not assignable to type 'number'.");
  const r = runVerification(root, { kind: 'typecheck' });
  assert.equal(r.status, 'found', 'pretty 출력을 못 읽으면 실행 실패로 오보한다');
  assert.match(r.diagnostics, /TS2322/);
});

test('R11: tsconfig를 읽을 수 없으면 우회하지 않는다 (JSONC는 tsc --init 기본값)', () => {
  // 못 읽으면 references·composite가 있는지 **알 수 없다**. 여는 쪽으로 틀리면
  // 참조 프로젝트를 안 도는 direct-tsc가 ok를 보고한다.
  const root = makeProject(
    { typecheck: 'tsc --noEmit' },
    {
      'tsconfig.json': '{\n  // tsc --init이 만드는 주석\n  "compilerOptions": { "strict": true }\n}',
      'node_modules/.bin/tsc': '#!/bin/sh\nexit 0\n',
    },
  );
  fs.chmodSync(path.join(root, 'node_modules', '.bin', 'tsc'), 0o755);
  assert.equal(runVerification(root, { kind: 'typecheck', dryRun: true }).meta.mode, 'script');
});

test('R12: lockfile은 가까운 디렉터리가 이긴다', () => {
  // 조상의 pnpm-lock.yaml이 자기 package-lock.json을 이기면, pnpm이 없는 프로젝트에서
  // 매 턴 runner-missing이 난다.
  const parent = makeProject({}, { 'pnpm-lock.yaml': '' });
  const child = path.join(parent, 'packages', 'app');
  fs.mkdirSync(child, { recursive: true });
  fs.writeFileSync(path.join(child, 'package.json'), JSON.stringify({ name: 'c', scripts: { typecheck: 'node -e ""' } }));
  fs.writeFileSync(path.join(child, 'package-lock.json'), '{}');
  assert.equal(runVerification(child, { kind: 'typecheck', dryRun: true }).meta.runner, 'npm');
});
