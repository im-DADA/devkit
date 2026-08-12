// 스크립트를 우회해 우리가 직접 tsc를 돌려도 **같은 일**인가 — 순수 판정.
// verify-classify.js에서 분리했다(200줄 규칙). 재수출되므로 기존 import 경로도 산다.
// 설계 근거: docs/2026-08-12-verification-runtime/DESIGN.md 결정 3

const PREFIX_TOKENS = new Set(['npx', 'pnpm', 'yarn', 'bun', 'exec', 'dlx', 'run']);
const FLAG_WITH_VALUE = new Set(['-p', '--project', '--pretty']);
const FLAG_ALONE = new Set(['--noEmit', '--incremental']);

/**
 * 놓칠 게 있으면 여기서 먼저 걸린다 — 여러 tsconfig·사전 codegen·`tsc -b`·
 * `next build` 기반 체크는 전부 셸 연산자나 다른 실행 파일로 나타나기 때문이다.
 * @returns {{ok:boolean, reason:string, projectArg:string|null}}
 */
function parseTscCommand(cmd) {
  const no = (reason) => ({ ok: false, reason, projectArg: null });
  if (typeof cmd !== 'string' || !cmd.trim()) return no('no-command');
  if (/[&;|><\n]/.test(cmd)) return no('compound-command'); // 다른 일을 같이 한다

  const tokens = cmd.trim().split(/\s+/);
  while (tokens.length && PREFIX_TOKENS.has(tokens[0])) tokens.shift();
  if (tokens.shift() !== 'tsc') return no('not-plain-tsc'); // vue-tsc·next·cross-env 등

  let projectArg = null;
  while (tokens.length) {
    const flag = tokens.shift();
    if (FLAG_ALONE.has(flag)) continue;
    if (FLAG_WITH_VALUE.has(flag)) {
      const value = tokens.shift();
      if (value === undefined) return no('malformed-flag');
      if (flag === '-p' || flag === '--project') projectArg = value;
      continue;
    }
    return no(`unknown-flag:${flag}`); // -b·--build 포함. 모르는 플래그는 우회하지 않는다
  }
  return { ok: true, reason: 'plain-tsc', projectArg };
}

/**
 * ⚠ 이 검사는 **`-p`가 가리키는 그 tsconfig**에 걸어야 한다. root의 tsconfig.json만 보면
 * `tsc --noEmit -p tsconfig.build.json`(references 있음)이 통과해 참조 프로젝트를 안 도는
 * direct-tsc가 `ok`를 보고한다 — 이 사이클이 죽이려던 조용한 거짓 음성이다.
 *
 * @param {object|null} tsconfig 파싱된 tsconfig
 * @param {'missing'|'parsed'|'unreadable'} state 파일이 있었는데 못 읽었는지까지 구분한다.
 *   ⚠ `unreadable`을 통과시키면 안 된다 — `tsc --init`의 기본 출력이 **주석 있는 JSONC**라
 *   JSON.parse가 실패하는 게 예외가 아니라 흔한 경우다. 못 읽었으면 references·composite가
 *   있는지 **알 수 없으므로** 우회하지 않는다(닫는 쪽).
 */
function tsconfigBlocksBypass(tsconfig, state = 'parsed') {
  if (state === 'unreadable') return { ok: false, reason: 'tsconfig-unreadable' };
  if (!tsconfig || typeof tsconfig !== 'object') return { ok: true, reason: 'no-tsconfig' };
  if (Array.isArray(tsconfig.references) && tsconfig.references.length) {
    return { ok: false, reason: 'project-references' };
  }
  if (tsconfig.compilerOptions && tsconfig.compilerOptions.composite === true) {
    return { ok: false, reason: 'composite' };
  }
  return { ok: true, reason: 'plain-tsconfig' };
}

/** 편의 합성 — 대상 tsconfig를 이미 읽어둔 경우에 쓴다 */
function canBypassScript(cmd, tsconfig) {
  const parsed = parseTscCommand(cmd);
  if (!parsed.ok) return parsed;
  const cfg = tsconfigBlocksBypass(tsconfig);
  return cfg.ok ? parsed : { ok: false, reason: cfg.reason, projectArg: null };
}

module.exports = { parseTscCommand, tsconfigBlocksBypass, canBypassScript };
