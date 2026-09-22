// devkit 전역 설정의 **IO 층** — `~/.devkit/config.json`을 읽어 완전한 설정 객체를 돌려준다.
//
// 설계: docs/2026-09-21-devkit-config/DESIGN.md §3.1·§4.4
// 판정·기본값은 전부 config-schema.js(순수)에 있다. 여기엔 분기 판정을 두지 않는다.
//
// ⚠ **1급 제약: 설정이 없으면 지금과 100% 동일하게 동작한다.** 그래서 실패는 전부 기본값으로
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
  } catch {
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

module.exports = { DEFAULTS, AGENTS, mergeConfig, loadConfig, isDefault, configPath };
