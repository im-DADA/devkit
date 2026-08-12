// 검증 실행의 **순수 판정층**. fs·child_process를 절대 require하지 않는다 —
// 이 파일이 프로세스 없이 테스트되는 것이 층을 가른 이유다. 기존 stop-verify의 결함
// (실행 실패를 타입 에러로 보고 · 절단이 뒤를 남김 · 타임아웃 오분류)은 전부 판정 결함인데
// 판정이 spawn과 같은 파일에 있어 테스트로 잡을 수가 없었다.
// 설계 근거: docs/2026-08-12-verification-runtime/DESIGN.md 결정 2·3·4·6
// (결정 3의 우회 판정은 200줄 규칙 때문에 ./tsc-bypass.js로 분리했다 — 아래에서 재수출한다)
const bypass = require('./tsc-bypass');

const TIMEOUTS = { typecheck: 30000, lint: 15000 };

// `types`는 .d.ts emit인 경우가 흔해 제외한다(매 턴 부작용 있는 emit 금지).
// `check`는 프로젝트마다 CI 전체 파이프라인(build+test)을 뜻해 제외한다.
const SCRIPT_CANDIDATES = {
  typecheck: ['typecheck', 'type-check', 'check-types', 'ts:check', 'tsc'],
  lint: ['lint', 'lint:check', 'eslint', 'biome'],
};

// 검사 순서가 상수인 것이 핵심이다. mtime 비교 같은 규칙을 쓰면 이행 잔재
// (pnpm으로 옮겼는데 package-lock.json이 남음)에서 매 실행 답이 바뀐다.
const LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['package-lock.json', 'npm'],
];
const RUNNERS = ['npm', 'pnpm', 'yarn', 'bun'];

const TS_LOCATED = /^(.*?)\((\d+),(\d+)\):\s*(?:error|warning)\s+(TS\d+):\s*(.*)$/;
const TS_PRETTY = /^(.*?):(\d+):(\d+)\s+-\s+(?:error|warning)\s+(TS\d+):\s*(.*)$/;
const TS_BARE = /^\s*(?:error|warning)\s+(TS\d+):\s*(.*)$/;
const CONFIG_FILE = /(?:^|[/\\])[jt]sconfig(?:\.[^/\\]+)?\.json$/i;

// ⚠ 두 가지를 갈라야 한다. 합치면 `lint: "eslint"`가 있는데 eslint가 안 깔린 프로젝트에서
// "스크립트를 찾지 못했다"고 말한다 — 있는 걸 없다고 하는 거짓 원인이고, 세션당 1회 규칙
// 때문에 그 뒤로는 조용해진다(실사용에서 발견).
const NO_SCRIPT_SIG = /Missing script|ERR_PNPM_NO_SCRIPT|Command ".*" not found/i;
const TOOL_MISSING_SIG = /command not found|: not found$|Cannot find module/im;
const CRASH_SIG = /JavaScript heap out of memory|FATAL ERROR:|Segmentation fault|Maximum call stack size exceeded/i;

function stripAnsi(s) {
  return typeof s === 'string' ? s.replace(/\[[0-9;]*[A-Za-z]/g, '') : '';
}

/** @returns {'npm'|'pnpm'|'yarn'|'bun'} */
function detectRunner(pkgJson, presentFiles) {
  const declared = pkgJson && typeof pkgJson.packageManager === 'string'
    ? pkgJson.packageManager.split('@')[0].trim()
    : null;
  if (declared && RUNNERS.includes(declared)) return declared;
  const present = new Set(Array.isArray(presentFiles) ? presentFiles : []);
  for (const [file, runner] of LOCKFILES) if (present.has(file)) return runner;
  return 'npm'; // Node 동봉 — 없을 확률이 가장 낮다
}

/** @returns {string|null} 후보 순서대로 첫 히트 */
function pickScript(scripts, kind) {
  if (!scripts || typeof scripts !== 'object') return null;
  for (const name of SCRIPT_CANDIDATES[kind] || []) {
    if (typeof scripts[name] === 'string' && scripts[name].trim()) return name;
  }
  return null;
}

/**
 * tsc 출력 → 진단 2분류.
 *   source   = 위치가 있고 그 파일이 tsconfig/jsconfig가 아닌 것 → `found` 후보
 *   compiler = 위치 없음 또는 위치가 설정 파일 → `failed` 근거(컴파일러 레벨 오류)
 * 요약 줄(`Found 12 errors in 3 files.`)과 yarn 배너는 둘 다에 안 들어간다 —
 * TS 코드가 없으면 어느 정규식에도 안 걸린다.
 */
function parseTscDiagnostics(text) {
  const source = [];
  const compiler = [];
  for (const raw of stripAnsi(text).split('\n')) {
    // 괄호 형식(--pretty false)과 콜론-대시 형식(--pretty true, tsc 기본값) 둘 다 본다.
    const loc = TS_LOCATED.exec(raw) || TS_PRETTY.exec(raw);
    if (loc) {
      const d = { file: loc[1], line: +loc[2], col: +loc[3], code: loc[4], message: loc[5], raw };
      (CONFIG_FILE.test(loc[1]) ? compiler : source).push(d);
      continue;
    }
    const bare = TS_BARE.exec(raw);
    if (bare) compiler.push({ file: null, line: null, col: null, code: bare[1], message: bare[2], raw });
  }
  return { source, compiler };
}

/**
 * 실행 결과 → 상태. DESIGN 결정 4의 13행 판정표를 **위에서부터 첫 매치**로 적용한다.
 * ⚠ 미분류의 기본값이 `failed`인 것이 이 표의 안전장치다 — `found`로 두면
 * "타입 에러 N개"라 말하면서 진짜 원인(설정 오류·크래시)을 숨기는 거짓 보고가 남는다.
 * @returns {{status:'ok'|'found'|'unavailable'|'failed', reason:string}}
 */
function classify(kind, r) {
  const code = r.spawnError && r.spawnError.code;
  if (code === 'ENOENT' || code === 'EACCES') return { status: 'unavailable', reason: 'runner-missing' };
  if (r.timedOut) return { status: 'failed', reason: 'timeout' };
  if (r.signal) return { status: 'failed', reason: 'crash' };
  if (r.status === 0) return { status: 'ok', reason: 'clean' };

  const err = stripAnsi(r.stderr);
  if (NO_SCRIPT_SIG.test(err)) return { status: 'unavailable', reason: 'no-script' };
  if (TOOL_MISSING_SIG.test(err)) return { status: 'unavailable', reason: 'tool-missing' };
  if (CRASH_SIG.test(err)) return { status: 'failed', reason: 'crash' };

  const out = stripAnsi(r.stdout);
  if (kind === 'typecheck') {
    const { source, compiler } = parseTscDiagnostics(`${out}\n${err}`);
    if (compiler.length) return { status: 'failed', reason: 'config-error' };
    if (source.length) return { status: 'found', reason: 'diagnostics' };
    return { status: 'failed', reason: 'unparsable' };
  }
  // lint: eslint·biome 공통 관례 — 1 = 진단 발견, 2+ = fatal config error
  if (r.status === 1) {
    return `${out}${err}`.trim()
      ? { status: 'found', reason: 'diagnostics' }
      : { status: 'failed', reason: 'unparsable' }; // 죽었는데 말이 없다
  }
  if (typeof r.status === 'number' && r.status >= 2) return { status: 'failed', reason: 'config-error' };
  return { status: 'failed', reason: 'unparsable' }; // status가 숫자가 아니면 설정 오류라 말할 근거가 없다
}

/**
 * **앞**을 남긴다. 기존 코드는 `.slice(-20)`으로 뒤를 남겼는데, tsc는 에러 뒤에 요약을
 * 찍으므로 마지막 N줄이 요약만일 수 있다 — 에러를 자르고 요약을 남기는 셈이었다.
 * (lib/receipt.js의 `clip`은 바이트 기준 head+tail이고 목적이 "인용 대조용 원문 보존"이라
 *  정책이 정면 반대다. 같은 이름으로 섞으면 receipt의 tail 보존이 조용히 깨진다.)
 */
// 상한을 상수로 노출한다 — verify-delta의 지형 변화 임계가 이 값을 그대로 쓴다.
// 새 임계 숫자를 발명하지 않기 위한 장치다(중복 상수 금지).
const CLIP_DEFAULTS = { maxItems: 40, maxBytes: 8192 };

function clipDiagnostics(items, opts = {}) {
  const list = (Array.isArray(items) ? items : []).filter((l) => typeof l === 'string');
  const maxItems = opts.maxItems || CLIP_DEFAULTS.maxItems;
  const maxBytes = opts.maxBytes || CLIP_DEFAULTS.maxBytes;
  const kept = [];
  let bytes = 0;
  for (const line of list) {
    if (kept.length >= maxItems) break;
    const size = Buffer.byteLength(line, 'utf8') + 1;
    if (kept.length && bytes + size > maxBytes) break;
    kept.push(line);
    bytes += size;
  }
  const hidden = list.length - kept.length;
  if (!hidden) return { text: kept.join('\n'), truncated: false, total: list.length };
  return {
    text: `${kept.join('\n')}\n…[devkit] 진단 ${hidden}개 더 있음 (총 ${list.length}개)`,
    truncated: true,
    total: list.length,
  };
}

/** status별로 무엇을 본문에 실을지. found는 진단만, failed는 원인 원문 그대로 */
function bodyFor(kind, status, res) {
  if (status === 'ok' || status === 'skipped' || status === 'unavailable') {
    return { text: '', total: 0, truncated: false, items: [] };
  }
  const out = `${stripAnsi(res.stdout)}\n${stripAnsi(res.stderr)}`;
  if (kind === 'typecheck') {
    const { source, compiler } = parseTscDiagnostics(out);
    const picked = status === 'found' ? source : compiler;
    if (picked.length) {
      const c = clipDiagnostics(picked.map((d) => d.raw));
      return { text: c.text, total: c.total, truncated: c.truncated, items: picked };
    }
  }
  const c = clipDiagnostics(out.split('\n').filter((l) => l.trim()));
  return { text: c.text, total: c.total, truncated: c.truncated, items: lines(out) };
}

/** lint는 형식 파서가 없다 — 줄 자체가 진단 단위다(사이클 B 결정 5) */
const lines = (out) => out.split('\n').filter((l) => l.trim()).map((raw) => ({ raw }));

/**
 * 세션당 1회만 알린다. 같은 문장을 매 턴 반복하면 그 경고 전체가 무시된다
 * (session-start.js의 drift 경고가 남긴 교훈).
 * 상태가 깨져 있으면 **알리는 쪽으로 연다** — 이 사이클이 죽이려는 건 침묵 no-op이다.
 */
function shouldNotify(state, key, kind) {
  const valid = state && typeof state === 'object'
    && typeof state.key === 'string' && Array.isArray(state.kinds);
  if (!valid || state.key !== key) return { notify: true, nextState: { key, kinds: [kind] } };
  if (state.kinds.includes(kind)) return { notify: false, nextState: state };
  return { notify: true, nextState: { key, kinds: [...state.kinds, kind] } };
}

module.exports = {
  SCRIPT_CANDIDATES, LOCKFILES, TIMEOUTS, CLIP_DEFAULTS,
  stripAnsi, detectRunner, pickScript, parseTscDiagnostics,
  classify, clipDiagnostics, bodyFor, shouldNotify,
  ...bypass,
};
