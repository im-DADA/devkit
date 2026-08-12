// 검증 실행의 **IO 경계**. 판정은 전부 verify-classify.js(순수)가 한다 —
// 이 파일은 "무엇을 어떻게 띄우나"만 안다. 두 훅(stop-verify·tsc-on-edit)이 같은 계약을
// 쓰게 해서 판정 로직이 두 벌로 갈라지는 것을 막는다(B15).
// 설계 근거: docs/2026-08-12-verification-runtime/DESIGN.md
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  TIMEOUTS, LOCKFILES, stripAnsi, detectRunner, pickScript,
  classify, bodyFor,
} = require('./verify-classify');
const { parseTscCommand, tsconfigBlocksBypass } = require('./tsc-bypass');
const { acquire, release } = require('./single-flight');

const readJson = (p) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
};

/** lockfile은 워크스페이스 루트에만 있을 수 있다 — 위로 5단계까지 훑는다 */
function presentLockfiles(root) {
  const names = LOCKFILES.map(([n]) => n);
  let dir = path.resolve(root);
  for (let i = 0; i < 5; i++) {
    const here = names.filter((n) => fs.existsSync(path.join(dir, n)));
    if (here.length) return here; // 가장 가까운 디렉터리에서 결정한다
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return [];
}

function readContext(root, kind) {
  const pkg = readJson(path.join(root, 'package.json'));
  const script = pickScript(pkg && pkg.scripts, kind);
  return {
    pkg,
    script,
    command: script && pkg.scripts[script],
    runner: detectRunner(pkg, presentLockfiles(root)),
    tsconfig: readJson(path.join(root, 'tsconfig.json')),
    tscBin: path.join(root, 'node_modules', '.bin', 'tsc'),
  };
}

// yarn berry는 `--silent`를 모르고 에러를 낸다(classic 전용). 배너는 진단 파서가
// 위치 있는 줄만 세므로 보고에 섞이지 않는다 — 그래서 플래그를 빼는 쪽이 안전하다.
function scriptArgv(runner, script) {
  if (runner === 'yarn' || runner === 'bun') return [runner, ['run', script]];
  return [runner, ['run', '--silent', script]];
}

function directArgv(ctx, root, projectArg) {
  const args = [
    '--noEmit', '--pretty', 'false', '--incremental',
    '--tsBuildInfoFile', path.join(root, '.devkit', 'tsbuildinfo'),
  ];
  if (projectArg) args.push('-p', projectArg);
  return [ctx.tscBin, args];
}

/** 우리가 붙인 플래그 때문에 죽은 것인가 — 그렇다면 사용자 코드 문제로 보고하면 안 된다 */
const OUR_FLAG_FAILURE = /error TS5\d+[^\n]*(incremental|tsBuildInfoFile|noEmit|tsbuildinfo)/i;

function exec(cmd, args, { root, timeoutMs, env }) {
  const started = Date.now();
  const r = spawnSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: timeoutMs,
    shell: process.platform === 'win32', // Node 20의 .cmd 실행 제약 대응
    // 인젝션 표면은 닫혀 있다: cmd는 상수 러너 4개 또는 우리가 만든 절대경로이고,
    // script명은 SCRIPT_CANDIDATES 상수에 있는 이름만 통과한다(사용자 입력 미도달).
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', ...(env || {}) },
  });
  return {
    spawnError: r.error || null,
    timedOut: !!(r.error && r.error.code === 'ETIMEDOUT'),
    signal: r.signal || null,
    status: r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    durationMs: Date.now() - started,
  };
}

/**
 * @param {string} root 검증 대상 패키지 루트
 * @param {{kind:'typecheck'|'lint', timeoutMs?:number, mode?:'auto'|'script',
 *          env?:object, dryRun?:boolean}} opts
 * @returns {{status:string, diagnostics:string, meta:object}}
 */
function runVerification(root, opts = {}) {
  const kind = opts.kind;
  const timeoutMs = opts.timeoutMs || TIMEOUTS[kind];
  const ctx = readContext(root, kind);
  const meta = {
    kind, runner: ctx.runner, script: ctx.script, mode: 'script', reason: '',
    durationMs: 0, exitCode: null, timedOut: false, totalDiagnostics: 0,
    truncated: false, argv: [],
  };

  if (!ctx.script) {
    meta.reason = 'no-script';
    return { status: 'unavailable', diagnostics: '', items: [], meta };
  }

  // 결정 3: 우회는 "스크립트가 하는 일 == 우리가 할 일"이 정적으로 증명될 때만.
  // 놓칠 게 있으면 canBypassScript가 먼저 거부한다.
  // 탈출구는 opts.mode와 DEVKIT_VERIFY_MODE 둘 다로 열린다. env를 여기서 읽는 이유는
  // 두 훅이 각자 배선을 잊으면 README가 없는 기능을 문서화하는 상태가 되기 때문이다(실제로 그랬다).
  const forcedScript = opts.mode === 'script'
    || String(process.env.DEVKIT_VERIFY_MODE || '').trim().toLowerCase() === 'script';

  // 🔴 Windows에서는 direct-tsc를 쓰지 않는다: `.bin/tsc`가 확장자 없는 sh 스크립트라
  // cmd.exe가 실행하지 못하고, shell:true가 인자를 **인용 없이** 이어붙여 공백 있는 경로
  // (C:\\Users\\First Last\\…)에서 argv가 쪼개진다. 스크립트 경로는 러너가 해결해준다.
  const canDirect = process.platform !== 'win32';

  let bypass = { ok: false, projectArg: null };
  if (kind === 'typecheck' && canDirect && !forcedScript && fs.existsSync(ctx.tscBin)) {
    const parsed = parseTscCommand(ctx.command);
    if (parsed.ok) {
      // ⚠ references·composite 검사는 **`-p`가 가리키는 그 파일**에 걸어야 한다.
      // root tsconfig.json만 보면 `tsc --noEmit -p tsconfig.build.json`(references 있음)이
      // 통과해 참조 프로젝트를 안 도는 direct-tsc가 ok를 보고한다 — 조용한 거짓 음성.
      const cfgPath = parsed.projectArg
        ? path.resolve(root, parsed.projectArg)
        : path.join(root, 'tsconfig.json');
      // 파일이 있는데 파싱에 실패하면 **닫는다.** `tsc --init`의 기본 출력이 주석 있는
      // JSONC라 JSON.parse 실패는 예외가 아니라 흔한 경우다 — 열어두면 references·composite를
      // 모르는 채 우회한다.
      const cfg = readJson(cfgPath);
      const state = cfg ? 'parsed' : (fs.existsSync(cfgPath) ? 'unreadable' : 'missing');
      const blocked = tsconfigBlocksBypass(cfg, state);
      bypass = blocked.ok ? parsed : { ok: false, projectArg: null, reason: blocked.reason };
    }
  }
  let [cmd, args] = bypass.ok
    ? directArgv(ctx, root, bypass.projectArg)
    : scriptArgv(ctx.runner, ctx.script);
  meta.mode = bypass.ok ? 'direct-tsc' : 'script';
  meta.argv = [cmd, ...args];

  if (opts.dryRun) return { status: 'skipped', diagnostics: '', items: [], meta };

  const lock = acquire(root, kind, { ttlMs: timeoutMs, isAlive: opts.isAlive });
  if (!lock.ok) {
    meta.reason = 'lock-held';
    return { status: 'skipped', diagnostics: '', items: [], meta };
  }

  try {
    let res = exec(cmd, args, { root, timeoutMs, env: opts.env });
    let verdict = classify(kind, res);

    // 우리가 붙인 플래그가 원인이면 buildinfo를 지우고 스크립트로 1회만 재실행한다.
    // (TS 버전별 지원 범위를 몰라도 안전하게 만드는 장치 — 무한루프 없음)
    if (meta.mode === 'direct-tsc' && verdict.status === 'failed'
        && OUR_FLAG_FAILURE.test(`${res.stdout}${res.stderr}`)) {
      fs.rmSync(path.join(root, '.devkit', 'tsbuildinfo'), { force: true });
      [cmd, args] = scriptArgv(ctx.runner, ctx.script);
      meta.mode = 'script';
      meta.fallback = 'incremental-unsupported';
      meta.argv = [cmd, ...args];
      // 폴백까지 각자 full timeout을 쓰면 30s+30s+lint 15s = 75s로 Stop 예산 60s를 넘긴다.
      // 넘기면 CC가 훅을 죽여 보고가 통째로 사라지므로 남은 예산으로 자른다.
      const left = Math.max(2000, timeoutMs - res.durationMs);
      res = exec(cmd, args, { root, timeoutMs: left, env: opts.env });
      verdict = classify(kind, res);
    }

    const body = bodyFor(kind, verdict.status, res);
    meta.reason = verdict.reason;
    meta.durationMs = res.durationMs;
    meta.exitCode = res.status;
    meta.timedOut = res.timedOut;
    meta.totalDiagnostics = body.total;
    meta.truncated = body.truncated;
    return { status: verdict.status, diagnostics: body.text, items: body.items || [], context: body.context || [], meta };
  } finally {
    release(lock);
  }
}

module.exports = { runVerification, readContext };
