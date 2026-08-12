// verify-classify.js — 검증 실행의 **순수 판정층** 계약 (docs/2026-08-12-verification-runtime/)
//
// 이 파일이 프로세스를 하나도 안 띄우는 게 설계의 핵심이다. 기존 stop-verify의 결함
// (실행 실패를 타입 에러로 보고 · 절단이 뒤를 남김 · 타임아웃 오분류)은 전부 판정 결함인데,
// 판정이 spawn과 같은 파일에 있어서 테스트로 잡을 수가 없었다. 그래서 층을 갈랐다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.join(dir, '..', 'hooks', 'lib', 'verify-classify.js');
const {
  SCRIPT_CANDIDATES,
  TIMEOUTS,
  stripAnsi,
  detectRunner,
  pickScript,
  parseTscDiagnostics,
  classify,
  clipDiagnostics,
  canBypassScript,
  shouldNotify,
} = createRequire(import.meta.url)(modPath);

/** spawnSync 결과 모양. 테스트가 실제 spawn 없이 판정만 먹인다 */
function result(over = {}) {
  return {
    spawnError: null, timedOut: false, signal: null, status: 0,
    stdout: '', stderr: '', ...over,
  };
}

// ── P1~P3 detectRunner ────────────────────────────────────────────
test('P1: packageManager 필드가 lockfile을 이긴다', () => {
  const r = detectRunner({ packageManager: 'pnpm@9.1.0' }, ['package-lock.json', 'yarn.lock']);
  assert.equal(r, 'pnpm');
});

test('P2: lockfile 4종 매핑 + 다중 lockfile은 고정 순서', () => {
  assert.equal(detectRunner(null, ['pnpm-lock.yaml']), 'pnpm');
  assert.equal(detectRunner(null, ['yarn.lock']), 'yarn');
  assert.equal(detectRunner(null, ['bun.lockb']), 'bun');
  assert.equal(detectRunner(null, ['bun.lock']), 'bun');
  assert.equal(detectRunner(null, ['package-lock.json']), 'npm');
  // 이행 잔재(pnpm으로 옮겼는데 package-lock.json이 남음)에서 매 실행 답이 바뀌면 안 된다.
  // mtime 같은 파일시스템 시간에 기대지 않고 상수 순서로 결정한다.
  const many = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];
  assert.equal(detectRunner(null, many), 'pnpm');
  assert.equal(detectRunner(null, [...many].reverse()), 'pnpm', '입력 순서에 흔들리면 안 됨');
});

test('P3: 아무 신호도 없으면 npm', () => {
  assert.equal(detectRunner(null, []), 'npm');
  assert.equal(detectRunner({}, []), 'npm');
  assert.equal(detectRunner({ packageManager: 'unknown@1' }, []), 'npm', '모르는 매니저는 npm으로');
});

// ── P4~P5 pickScript ──────────────────────────────────────────────
test('P4: 후보 순서대로 첫 히트, 하나도 없으면 null', () => {
  assert.equal(pickScript({ 'type-check': 'tsc', typecheck: 'tsc' }, 'typecheck'), 'typecheck');
  assert.equal(pickScript({ 'check-types': 'tsc' }, 'typecheck'), 'check-types');
  assert.equal(pickScript({ build: 'next build' }, 'typecheck'), null);
  assert.equal(pickScript({ 'lint:check': 'eslint .' }, 'lint'), 'lint:check');
  assert.equal(pickScript(null, 'lint'), null, 'scripts 없음도 null');
});

test('P5: types·check는 후보가 아니다 (부작용 회피)', () => {
  // `npm run types`는 .d.ts emit인 경우가 흔하다 — 매 턴 부작용 있는 emit을 돌릴 수 없다.
  // `check`는 프로젝트마다 CI 전체 파이프라인(build+test)을 뜻하는 경우가 많다.
  assert.equal(pickScript({ types: 'tsc --emitDeclarationOnly' }, 'typecheck'), null);
  assert.equal(pickScript({ check: 'npm run build && npm test' }, 'lint'), null);
  for (const cand of SCRIPT_CANDIDATES.typecheck) assert.notEqual(cand, 'types');
  for (const cand of SCRIPT_CANDIDATES.lint) assert.notEqual(cand, 'check');
});

// ── P8~P10 parseTscDiagnostics ────────────────────────────────────
test('P8: 위치 있음 / 위치 없음 / tsconfig 위치를 3분류', () => {
  const out = [
    'src/a.ts(12,3): error TS2322: Type string is not assignable to type number.',
    'error TS5023: Unknown compiler option \'foo\'.',
    'tsconfig.json(3,5): error TS5024: Compiler option requires a value.',
  ].join('\n');
  const { source, compiler } = parseTscDiagnostics(out);
  assert.equal(source.length, 1, '소스 진단은 1건');
  assert.equal(source[0].file, 'src/a.ts');
  assert.equal(source[0].code, 'TS2322');
  assert.equal(compiler.length, 2, '위치 없는 것 + tsconfig 위치 = 컴파일러 레벨 2건');
});

test('P9: tsc 요약 줄은 진단이 아니다', () => {
  const { source, compiler } = parseTscDiagnostics('Found 12 errors in 3 files.\n\nErrors  Files\n');
  assert.equal(source.length, 0);
  assert.equal(compiler.length, 0);
});

test('P10: yarn 배너가 진단으로 세지지 않는다', () => {
  // yarn classic은 `--silent`를 붙일 수 없어(berry가 거부) 배너가 그대로 온다.
  // 파서가 위치 있는 줄만 세기 때문에 안 섞인다는 게 그 결정의 전제다 — 여기서 고정한다.
  const out = [
    'yarn run v1.22.19',
    '$ tsc --noEmit',
    'src/a.ts(1,1): error TS2322: nope',
    'error Command failed with exit code 1.',
    'info Visit https://yarnpkg.com/en/docs/cli/run for documentation.',
  ].join('\n');
  const { source, compiler } = parseTscDiagnostics(out);
  assert.equal(source.length, 1);
  assert.deepEqual(compiler, [], 'yarn의 `error Command failed`는 TS 진단이 아니다');
});

// ── P6~P7 classify — 결정 4의 판정표와 1:1 ────────────────────────
const TYPE_ERR = 'src/a.ts(1,1): error TS2322: Type string is not assignable to type number.';

test('P6-1: 러너 없음(ENOENT) → unavailable', () => {
  const r = classify('typecheck', result({ spawnError: { code: 'ENOENT' }, status: null }));
  assert.equal(r.status, 'unavailable');
  assert.equal(r.reason, 'runner-missing');
});

test('P6-2: timedOut → failed (exit 0이어도)', () => {
  // B7. 시간 초과는 진단이 아니다. status가 0이어도 timedOut이 이긴다.
  assert.equal(classify('typecheck', result({ timedOut: true, status: 0 })).status, 'failed');
  assert.equal(classify('typecheck', result({ timedOut: true })).reason, 'timeout');
  assert.equal(classify('lint', result({ signal: 'SIGKILL', status: null })).status, 'failed');
});

test('P6-3: exit 0 → ok', () => {
  assert.equal(classify('typecheck', result({ status: 0 })).status, 'ok');
  assert.equal(classify('lint', result({ status: 0, stdout: '뭐라도 출력' })).status, 'ok');
});

test('P6-4: 스크립트 부재 시그니처 → unavailable', () => {
  for (const sig of ['npm ERR! Missing script: "typecheck"', 'ERR_PNPM_NO_SCRIPT', 'sh: tsc: command not found']) {
    const r = classify('typecheck', result({ status: 1, stderr: sig }));
    assert.equal(r.status, 'unavailable', sig);
  }
});

test('P6-5: 크래시 시그니처 → failed', () => {
  for (const sig of ['JavaScript heap out of memory', 'FATAL ERROR: x', 'Segmentation fault', 'Maximum call stack size exceeded']) {
    const r = classify('typecheck', result({ status: 134, stderr: sig, stdout: TYPE_ERR }));
    assert.equal(r.status, 'failed', sig);
    assert.equal(r.reason, 'crash');
  }
});

test('P6-6: 위치 없는 error TS → failed (B8)', () => {
  // 이게 이 사이클의 핵심 결함이다. 지금 코드는 이걸 "타입 에러"로 보고한다.
  const r = classify('typecheck', result({ status: 1, stdout: "error TS5023: Unknown compiler option 'foo'." }));
  assert.equal(r.status, 'failed');
  assert.equal(r.reason, 'config-error');
});

test('P6-7: tsconfig 위치 진단 → failed', () => {
  const r = classify('typecheck', result({
    status: 1, stdout: 'tsconfig.json(3,5): error TS5024: Compiler option requires a value.',
  }));
  assert.equal(r.status, 'failed');
  assert.equal(r.reason, 'config-error');
});

test('P6-8: 위치 있는 소스 진단 → found', () => {
  const r = classify('typecheck', result({ status: 1, stdout: `${TYPE_ERR}\nFound 1 error in 1 file.` }));
  assert.equal(r.status, 'found');
});

test('P6-9: exit≠0인데 진단 0개 → failed (거짓 보고 방지)', () => {
  // "타입 에러"라고 말할 근거가 없다. 형식을 모르는 실패는 실패라고 말한다.
  const r = classify('typecheck', result({ status: 1, stdout: '뭔가 알 수 없는 출력' }));
  assert.equal(r.status, 'failed');
  assert.equal(r.reason, 'unparsable');
});

test('P6-10~12: lint exit code 관례', () => {
  assert.equal(classify('lint', result({ status: 1, stdout: 'a.ts:1:1 error no-unused-vars' })).status, 'found');
  assert.equal(classify('lint', result({ status: 2, stderr: 'Invalid config' })).status, 'failed');
  assert.equal(classify('lint', result({ status: 1, stdout: '   \n' })).status, 'failed', '죽었는데 말이 없다');
});

test('P7: 미분류의 기본값은 failed이지 found가 아니다', () => {
  // 기본값 방향이 이 표의 안전장치다. found로 두면 이 사이클이 죽이려는 거짓 보고가 남는다.
  const r = classify('typecheck', result({ status: 77, stdout: '', stderr: '' }));
  assert.equal(r.status, 'failed');
  const l = classify('lint', result({ status: 99, stdout: '', stderr: '' }));
  assert.equal(l.status, 'failed');
});

// ── P11~P13 절단 ──────────────────────────────────────────────────
test('P11: 앞을 남긴다 + 잘린 개수 표기 (현 결함의 직접 회귀)', () => {
  // 지금 코드는 `.slice(-20)`으로 **뒤**를 남긴다. tsc는 에러 뒤에 요약을 찍으므로
  // 마지막 20줄이 요약만일 수 있다 — 에러를 자르고 요약을 남기는 셈이다.
  const items = Array.from({ length: 100 }, (_, i) => `src/f${i}.ts(1,1): error TS2322: e${i}`);
  const { text, truncated, total } = clipDiagnostics(items, { maxItems: 40 });
  assert.equal(truncated, true);
  assert.equal(total, 100);
  assert.match(text, /e0/, '첫 진단이 살아 있어야 함');
  assert.doesNotMatch(text, /e99\b/, '뒤를 남기면 안 됨');
  assert.match(text, /60개 더 있음/, '잘린 개수를 밝혀야 함');
  assert.match(text, /총 100개/);
});

test('P11b: 바이트 상한도 앞을 남기고 표기한다', () => {
  const items = Array.from({ length: 30 }, (_, i) => `src/f${i}.ts(1,1): error TS2322: ${'x'.repeat(500)}`);
  const { text, truncated } = clipDiagnostics(items, { maxItems: 40, maxBytes: 2048 });
  assert.equal(truncated, true);
  assert.ok(Buffer.byteLength(text, 'utf8') <= 2048 + 200, '표기 포함해도 상한 근처를 넘지 않아야 함');
  assert.match(text, /f0\.ts/);
});

test('P12: 상한 이하면 무손실 + 멱등', () => {
  const items = ['a.ts(1,1): error TS1: x', 'b.ts(2,2): error TS2: y'];
  const first = clipDiagnostics(items, { maxItems: 40 });
  assert.equal(first.truncated, false);
  assert.equal(first.text, items.join('\n'));
  const again = clipDiagnostics(first.text.split('\n'), { maxItems: 40 });
  assert.equal(again.text, first.text, '멱등이어야 함');
});

test('P13: stripAnsi 후 길이 계산이 정확', () => {
  const colored = '[31msrc/a.ts(1,1): error TS2322[39m';
  assert.equal(stripAnsi(colored), 'src/a.ts(1,1): error TS2322');
  assert.equal(stripAnsi(''), '');
  assert.equal(stripAnsi(null), '', 'null도 throw하지 않는다');
});

// ── P14~P15 canBypassScript (결정 3의 안전 조건) ──────────────────
test('P14: 단일 tsc 호출만 허용, 나머지는 전부 거부', () => {
  const ok = ['tsc --noEmit', 'npx tsc --noEmit', 'pnpm exec tsc --noEmit', 'tsc --noEmit --pretty false'];
  for (const cmd of ok) assert.equal(canBypassScript(cmd, {}).ok, true, `허용돼야 함: ${cmd}`);

  // 놓칠 게 있으면 조건 1이 먼저 깨진다 — 이게 결정 3의 안전장치다.
  const reject = [
    'tsc -b', 'tsc --build',
    'tsc --noEmit && eslint .', 'tsc --noEmit; echo done', 'tsc --noEmit | tee out',
    'next build', 'vue-tsc --noEmit', 'svelte-check',
    'cross-env NODE_ENV=test tsc --noEmit',
    'npm run gen && tsc --noEmit',
    'tsc --noEmit -p a.json && tsc --noEmit -p b.json',
  ];
  for (const cmd of reject) assert.equal(canBypassScript(cmd, {}).ok, false, `거부돼야 함: ${cmd}`);
});

test('P14b: -p/--project는 허용하고 그 값을 돌려준다', () => {
  assert.equal(canBypassScript('tsc --noEmit -p tsconfig.build.json', {}).projectArg, 'tsconfig.build.json');
  assert.equal(canBypassScript('tsc --noEmit --project ./cfg.json', {}).projectArg, './cfg.json');
  assert.equal(canBypassScript('tsc --noEmit', {}).projectArg, null);
});

test('P15: references·composite는 거부', () => {
  assert.equal(canBypassScript('tsc --noEmit', { references: [{ path: '../x' }] }).ok, false);
  assert.equal(canBypassScript('tsc --noEmit', { compilerOptions: { composite: true } }).ok, false);
  assert.equal(canBypassScript('tsc --noEmit', { compilerOptions: { strict: true } }).ok, true);
  assert.equal(canBypassScript('tsc --noEmit', null).ok, true, 'tsconfig를 못 읽어도 명령이 안전하면 통과');
});

// ── P18 shouldNotify ──────────────────────────────────────────────
test('P18: 같은 key·kind는 2회째부터 침묵, key가 바뀌면 다시 알린다', () => {
  const a = shouldNotify(null, 'sess-1', 'typecheck');
  assert.equal(a.notify, true);
  const b = shouldNotify(a.nextState, 'sess-1', 'typecheck');
  assert.equal(b.notify, false, '같은 세션에서 두 번 말하면 무시 학습이 된다');
  const c = shouldNotify(b.nextState, 'sess-1', 'lint');
  assert.equal(c.notify, true, 'kind가 다르면 별개');
  const d = shouldNotify(c.nextState, 'sess-2', 'typecheck');
  assert.equal(d.notify, true, '세션이 바뀌면 다시');
});

test('P18b: 깨진 상태를 받아도 throw하지 않고 알리는 쪽으로 연다', () => {
  for (const bad of [undefined, 'not an object', { key: 1 }, { kinds: 'x' }]) {
    const r = shouldNotify(bad, 'k', 'typecheck');
    assert.equal(r.notify, true, `fail-open이어야 함: ${JSON.stringify(bad)}`);
  }
});

// ── P19 순수성 ────────────────────────────────────────────────────
test('P19: verify-classify.js는 fs·child_process를 require하지 않는다', () => {
  // 층을 가른 이유가 이것이다. 순수 파일에 IO가 새어들어오면 다음 사람이
  // "테스트하려면 프로세스를 띄워야 하는" 원래 상태로 조용히 되돌아간다.
  const src = fs.readFileSync(modPath, 'utf8');
  assert.doesNotMatch(src, /require\(['"]node:fs['"]\)/);
  assert.doesNotMatch(src, /require\(['"]node:child_process['"]\)/);
  assert.doesNotMatch(src, /require\(['"]fs['"]\)/);
});

test('TIMEOUTS 상한이 hooks.json 예산 안에 들어간다', () => {
  // Stop 훅 timeout 60s를 넘기면 CC가 훅을 죽여 보고가 통째로 사라진다.
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '..', 'hooks', 'hooks.json'), 'utf8'));
  const stopTimeout = cfg.hooks.Stop[0].hooks[0].timeout;
  assert.ok(
    TIMEOUTS.typecheck + TIMEOUTS.lint < stopTimeout,
    `kind 상한 합(${TIMEOUTS.typecheck + TIMEOUTS.lint})이 Stop 예산(${stopTimeout}) 안이어야 함`,
  );
});

// ── 두 세션 핑퐁 (사이클 B가 새로 만든 결함) ──────────────────────
// 알림 슬롯이 하나뿐이고 키가 session_id라, 같은 레포에 두 세션이 붙으면 서로의 이력을
// 지워 매 턴 반복된다. 실측: A1=158 A2=0 B1=177 **A3=177 B2=177 A4=177**.
// 반복은 이 기능이 없애려던 바로 그 무시 학습이다.

test('P20: 두 세션이 교차해도 각자 1회만 알린다', () => {
  let s = null;
  const step = (key) => { const r = shouldNotify(s, key, 'typecheck'); s = r.nextState; return r.notify; };
  assert.equal(step('A'), true, 'A 첫 턴');
  assert.equal(step('A'), false, 'A 두 번째는 침묵');
  assert.equal(step('B'), true, 'B는 처음이니 알린다');
  assert.equal(step('A'), false, 'B가 끼어들어도 A의 이력이 살아 있어야 한다');
  assert.equal(step('B'), false);
  assert.equal(step('A'), false);
});

test('P21: 세션 이력은 상한이 있고 오래된 것부터 버린다', () => {
  let s = null;
  for (let i = 0; i < 20; i++) s = shouldNotify(s, 'sess-' + i, 'typecheck').nextState;
  const size = JSON.stringify(s).length;
  assert.ok(size < 800, '상태가 무한히 자라면 안 된다: ' + size);
  assert.equal(shouldNotify(s, 'sess-19', 'typecheck').notify, false, '최근 세션은 기억한다');
});

test('P22: 옛 형식({key,kinds}) 상태도 읽는다 (기존 사용자 무손실)', () => {
  const legacy = { key: 'A', kinds: ['typecheck'] };
  assert.equal(shouldNotify(legacy, 'A', 'typecheck').notify, false, '옛 이력을 잃으면 한 번 더 떠든다');
  assert.equal(shouldNotify(legacy, 'A', 'lint').notify, true);
  assert.equal(shouldNotify(legacy, 'B', 'typecheck').notify, true);
});
