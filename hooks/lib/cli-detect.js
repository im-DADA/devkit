// 설치된 CLI를 감지한다 — **읽기만** 하고, 판정에 쓰는 것은 `PATH` 조각과 홈 디렉터리뿐이다.
//
// 설계: docs/2026-09-30-wizard-slim-multi-cli/DESIGN.md §4.3
//
// ⚠ **셸을 spawn하지 않는다.** `which`·`command -v`를 부르면 훅 경로에 셸 의존이 생기고
// (로그인 셸이 아닌 환경에서 결과가 달라진다) 훅 예산도 먹는다. `PATH`를 직접 훑는다.
//
// 감지는 **편의이고 벽이 아니다**: 바이너리를 못 찾아도 홈 디렉터리가 있으면 고를 수 있게 두고
// (미탐이 기능 상실이 되지 않게), 둘 다 없으면 `--cli=`로 강제 노출할 수 있다.
//
// Windows `PATHEXT`/`.exe`는 다루지 않는다 — devkit 훅은 POSIX 전제다(§3.9).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_PATH_SEGMENTS = 64;              // 훅 예산 방어(실측 PATH는 10~30조각)
const CLI_HOME = { claude: '.claude', codex: '.codex' };
const CLI_LABEL = { claude: 'Claude Code', codex: 'Codex' };
const CLIS = ['claude', 'codex'];           // claude가 먼저다 — 마법사 표기 순서가 이 배열이다
const STATUSES = ['both', 'binary', 'home', 'absent'];
const HINT = {
  home: '설치 흔적만 있다(PATH에서 실행 파일을 찾지 못했다) — 고를 수 있지만 실행이 실패하면 Claude로 폴백한다',
  forced: '감지되지 않았다(--cli로 강제 노출) — 실행이 실패하면 Claude로 폴백한다',
  // PATH 조각 상한을 넘겨 탐색을 포기한 경우 — 모듈 주석의 약속("offered=false인 이유를
  // 마법사가 말할 수 있어야 한다")을 지키려면 이 경우도 말해야 한다(2026-10-01 리뷰).
  truncated: 'PATH 조각이 너무 많아 탐색을 건너뛰었다 — /kit setup --cli=<name>으로 강제 노출할 수 있다',
};

/** `PATH` 조각 중 실행 가능한 파일의 절대경로. 못 찾으면 `null`. throw하지 않는다. */
function findOnPath(name, pathEnv) {
  if (typeof name !== 'string' || name === '' || name.includes(path.sep)) return null;
  const raw = typeof pathEnv === 'string' ? pathEnv : null;
  if (raw === null || raw === '') return null;
  const segments = raw.split(path.delimiter).filter((segment) => segment !== '');
  // 상한을 넘으면 포기한다 — 조용히 오래 도는 것보다 못 찾았다고 하는 쪽이 낫다.
  if (segments.length > MAX_PATH_SEGMENTS) return null;
  for (const segment of segments) {
    const file = path.join(segment, name);
    try {
      if (fs.statSync(file).isFile()) { fs.accessSync(file, fs.constants.X_OK); return file; }
    } catch {
      // 없는 조각·권한 없는 조각은 다음으로 넘어간다
    }
  }
  return null;
}

/** PATH 조각이 상한을 넘어 `findOnPath`가 탐색을 포기했는가. 순수 — 인자만 본다. */
function isPathTruncated(pathEnv) {
  if (typeof pathEnv !== 'string' || pathEnv === '') return false;
  return pathEnv.split(path.delimiter).filter((segment) => segment !== '').length > MAX_PATH_SEGMENTS;
}

/** 바이너리를 정본으로, 홈 디렉터리를 보조로 본다. 홈이 **파일**이면 세지 않는다. */
function detectCli(name, options) {
  const pathEnv = typeof options?.pathEnv === 'string' ? options.pathEnv : process.env.PATH;
  const binPath = findOnPath(name, pathEnv);
  let home = null;
  const base = CLI_HOME[name];
  if (base) {
    try {
      const candidate = path.join(typeof options?.homedir === 'string' ? options.homedir : os.homedir(), base);
      if (fs.statSync(candidate).isDirectory()) home = candidate;
    } catch {
      home = null;
    }
  }
  const status = binPath && home ? 'both' : binPath ? 'binary' : home ? 'home' : 'absent';
  // 상한 초과로 탐색을 포기했다는 사실을 실어 보낸다 — 안 보내면 `absent`의 이유를
  // 마법사가 말할 수 없다(모듈 주석의 약속, 2026-10-01 리뷰 확인②).
  return { status, binPath: binPath ?? null, home, pathTruncated: isPathTruncated(pathEnv) };
}

function detectClis(options) {
  return { claude: detectCli('claude', options), codex: detectCli('codex', options) };
}

/**
 * **순수** — 인자만 본다. 두 CLI를 **항상 둘 다** 돌려준다: `offered=false`인 이유를
 * 마법사가 말할 수 있어야 한다("왜 Codex가 안 보이나"가 침묵이면 사용자는 버그로 읽는다).
 */
function offerableClis(detected, options) {
  const force = Array.isArray(options?.force) ? options.force.filter((v) => typeof v === 'string') : [];
  return CLIS.map((cli) => {
    const raw = detected && typeof detected === 'object' ? detected[cli]?.status : null;
    const status = STATUSES.includes(raw) ? raw : 'absent';
    const forced = force.includes(cli);
    const offered = status !== 'absent' || forced;
    const truncated = detected && typeof detected === 'object' ? detected[cli]?.pathTruncated === true : false;
    // PATH 상한 초과를 forced보다 먼저 본다 — 둘이 겹칠 때 사용자가 들어야 하는 것은
    // "왜 못 찾았나"(PATH)이지 "왜 보이나"(forced)가 아니다(2026-10-01 Gap 2회차).
    const hint = status === 'home' ? HINT.home
      : status === 'absent' && truncated ? HINT.truncated
        : status === 'absent' && forced ? HINT.forced : null;
    return { cli, label: CLI_LABEL[cli], status, offered, forced, hint };
  });
}

module.exports = { MAX_PATH_SEGMENTS, CLI_HOME, CLI_LABEL, CLIS, HINT, isPathTruncated,
  findOnPath, detectCli, detectClis, offerableClis };
