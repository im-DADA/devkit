// devkit 전역 설정의 **IO 층** — `~/.devkit/config.json`을 읽어 완전한 설정 객체를 돌려준다.
//
// 설계: docs/2026-09-21-devkit-config/DESIGN.md §3.1·§4.4
// 판정·기본값은 전부 config-schema.js(순수)에 있다. 여기엔 분기 판정을 두지 않는다.
//
// ⚠ **1급 제약: 설정이 없으면 규칙 주입·판정이 지금과 100% 동일하다.** 유일한 예외는
// 첫 실행 안내 한 블록이고(2026-09-22), 그것도 `session-start` 출력 맨 끝에만 붙는다 —
// 규칙 블록·드리프트 비교의 정본은 건드리지 않는다. 그래서 실패는 전부 기본값으로
// degrade한다 — 파일 없음·깨진 JSON·모르는 키·허용값 밖 어느 것도 세션을 막지 않는다.
// 다만 **조용히 떨어지지는 않는다**: 무엇이 왜 떨어졌는지 stderr에 한 줄 남긴다
// (bash-receipt.js:23-26과 같은 이유 — 조용한 무시는 오타를 영원히 숨긴다).
//
// ⚠ **우선순위는 env > config > 기본값이다.** 이 파일은 env를 읽지 않는다(DEVKIT_CONFIG 제외).
// 각 훅이 "env가 미설정일 때만 config를 본다"는 형태로 그 순서를 코드로 표현한다.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { warn } = require('./diag');
const { DEFAULTS, AGENTS, mergeConfig, isDefault } = require('./config-schema');

/** 설정 파일의 경로. `DEVKIT_CONFIG`는 값이 아니라 **위치**를 바꾼다(빈 문자열 = 설정 없음) */
function configPath() {
  const override = process.env.DEVKIT_CONFIG;
  if (override !== undefined) return override === '' ? null : override;
  return path.join(os.homedir(), '.devkit', 'config.json');
}

// 설정 파일은 **모든 훅이 매 실행마다** 읽는다. 홈에 거대 파일이나 FIFO가 놓이면
// (실수든 아니든) 세션 전체가 느려지거나 멈춘다. 정상적인 설정은 수 KB를 넘지 않는다.
const MAX_CONFIG_BYTES = 256 * 1024;

// **파일이 아예 없는가**(ENOENT)를 따로 기억한다. "없음"과 "있는데 못 읽음/깨짐"은 다르다 —
// 전자만 첫 실행 온보딩 대상이고, 후자는 설정을 시도한 사람이라 안내가 아니라 경고를 받아야 한다.
// `loadConfig`가 이미 하는 stat/read를 재사용하므로 추가 IO는 0이다.
let missing = false;

/** 설정 파일 본문. 없으면 `null`(정상 — 설정하지 않은 사람이 다수다) */
function readRaw(p) {
  if (p === null) return null;
  try {
    // ⚠ 읽기 **전에** 종류와 크기를 본다. FIFO를 readFileSync하면 영원히 매달린다.
    const st = fs.statSync(p);
    if (!st.isFile()) {
      warn(`설정 경로가 정규 파일이 아니다(${p}) — 전부 기본값으로 진행한다`);
      return null;
    }
    if (st.size > MAX_CONFIG_BYTES) {
      warn(`설정 파일이 너무 크다(${p}: ${st.size}B) — 전부 기본값으로 진행한다`);
      return null;
    }
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    // 여기서만 "없음"을 인정한다. EACCES·EISDIR 등은 **있는데 못 읽는 것**이라 안내 대상이 아니다.
    if (e && e.code === 'ENOENT') missing = true;
    return null;
  }
}

let cached = null;

/**
 * 프로세스당 1회 읽고 캐시한다(훅은 프로세스당 1회 실행이라 사실상 모듈 상수다).
 *
 * 부수효과: 문제가 있으면 `diag.warn`으로 stderr에 **한 줄** 남긴다. stdout은 건드리지
 * 않는다 — 훅의 stdout은 하네스와의 JSON 계약이라 오염되면 기능이 통째로 깨진다.
 * @returns 항상 완전한 설정 객체. 실패·부재는 전부 기본값이다.
 */
function loadConfig() {
  if (cached) return cached;
  const p = configPath();
  const text = readRaw(p);
  let raw;
  if (text === null) {
    raw = undefined;
  } else {
    try {
      raw = JSON.parse(text);
    } catch {
      // ⚠ `e.message`를 싣지 않는다 — V8의 JSON 에러는 **본문 앞부분을 그대로 담는다.**
      // 설정 자리에 `.env`를 잘못 두면 그 값이 진단으로 새어 나간다(리뷰 1회차 실측).
      warn(`설정 파일이 JSON 형식이 아니다(${p}) — 전부 기본값으로 진행한다`);
      raw = undefined;
    }
  }
  // ⚠ **최후 방어선.** mergeConfig는 throw하지 않도록 짜여 있지만, 그 계약이 깨지면
  // 예외가 훅 프로세스를 죽이고 **가드가 fail-open된다**(리뷰 1회차: 설정 한 줄로
  // bash-guard가 exit 1이었다). 가드는 어떤 경우에도 열리면 안 되므로 여기서 받는다.
  let merged;
  try {
    merged = mergeConfig(raw);
  } catch (e) {
    warn(`설정 병합이 실패했다(${p}: ${e.name}) — 전부 기본값으로 진행한다`);
    merged = { config: JSON.parse(JSON.stringify(DEFAULTS)), problems: [] };
  }
  if (merged.problems.length) warn(`설정(${p}): ${merged.problems.join(' / ')}`);
  cached = merged.config;
  return cached;
}

/**
 * 아직 한 번도 설정한 적 없는 사용자인가 — 맞으면 **설정 파일이 놓일 절대 경로**, 아니면 `null`.
 *
 * 첫 실행 온보딩(`renderOnboardingNote`)의 유일한 판정점이다. 조건 둘:
 *   ① `DEVKIT_CONFIG`가 **미정의**일 것 — 그 변수를 아는 사람은 설정을 아는 사람이고,
 *      기존 테스트의 탈출구(`DEVKIT_CONFIG=`)도 이걸로 보호된다.
 *   ② 기본 경로가 **ENOENT**일 것 — 깨진 파일·권한 오류·디렉터리는 전부 "있음"으로 본다.
 *
 * ⚠ `loadConfig()`를 먼저 부른 뒤에 물어야 한다(그때 파일을 읽으며 `missing`이 정해진다).
 * 호출 순서가 뒤집히면 항상 `null`이라 **안내가 조용히 사라진다** — 그래서 여기서 직접 부른다.
 * @returns {string|null}
 */
function unconfiguredPath() {
  if (process.env.DEVKIT_CONFIG !== undefined) return null;
  loadConfig();
  return missing ? configPath() : null;
}

module.exports = { DEFAULTS, AGENTS, mergeConfig, loadConfig, isDefault, configPath, unconfiguredPath };
