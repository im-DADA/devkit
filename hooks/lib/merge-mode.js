// `scripts/list-models.mjs --merge`의 본체 — 설정 **원문**과 patch를 합친 결과를 계산한다.
//
// 설계: docs/2026-10-02-role-model-choice-ux/DESIGN.md §6
//
// ⚠ 이 모듈이 있는 이유 셋:
//   ① `list-models.mjs`가 209줄로 **저장소 자기 규칙(200줄)을 넘겼다**(2026-10-02 REPORT가 찾았다).
//      `S26`은 순수 3모듈만 보므로 `scripts/`에는 래칫이 없어 **아무 테스트도 빨개지지 않았다.**
//   ② 리뷰 1회차 🟡 구조: `} else {`로 90여 줄을 감싸면서 들여쓰기를 올리지 않아 분기 경계가
//      눈으로 안 보였다.
//   ③ `hooks/lib/`에 두면 `INTEGRITY.sha256` 범위에 들어간다 — `scripts/`에만 있던 이 계산에
//      해시 안전망이 생긴다.
//
// ⚠ **파일을 쓰지 않는다.** 쓰기는 커맨드가 한다. 이 모듈은 그 계산을 커맨드의 산문에서
//   걷어내 기계가 하게 하는 것이다(2026-10-02 Gap 2회차: 순수 함수를 만들어 두고 **아무도
//   안 불러** 증명이 겉돌았다).
const { configPath, readConfigText } = require('./config');
const { mergeConfigFile } = require('./setup-plan');

/** patch 문자열을 객체로. 받아들일 수 없으면 사유를 돌려준다. */
function readPatch(seen, arg) {
  // ⚠ "플래그는 왔는데 값을 못 얻었다"를 침묵시키지 않는다(`--codex-model`의 선례와 같다).
  if (!seen) return { patch: null, problem: '--merge에 patch를 주지 않았다' };
  let patch;
  try { patch = JSON.parse(arg ?? 'null'); } catch { return { patch: null, problem: 'patch가 JSON이 아니다' }; }
  // 배열·문자열·null을 조용히 무시하면 "적용했다"는 거짓 보고가 된다.
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return { patch: null, problem: 'patch가 객체가 아니다' };
  }
  return { patch, problem: null };
}

/** 설정 파일의 현재 내용. 못 읽거나 깨졌으면 사유를 돌려준다. */
function readExisting(file) {
  // ⚠ **맨몸 readFileSync를 쓰지 않는다** — FIFO면 영원히 매달려 "항상 exit 0"이 깨진다
  //   (2026-10-02 리뷰 🔴1 실측: 5초를 넘겨도 안 끝났다). `config.js`의 가드를 공유한다.
  const raw = readConfigText(file);
  if (raw.state === 'unreadable') return { state: raw.state, existing: null, problem: raw.reason };
  if (raw.state !== 'ok') return { state: raw.state, existing: null, problem: null };
  let existing;
  try { existing = JSON.parse(raw.text); } catch { existing = undefined; }
  if (existing === undefined || existing === null || typeof existing !== 'object' || Array.isArray(existing)) {
    // ⚠ **"없음"으로 뭉개지 않는다** — 깨진 파일을 없다고 보면 그 위에 patch만 써서
    //   사용자 설정을 통째로 지운다(2026-10-02 리뷰 🔴2).
    return { state: raw.state, existing: null, problem: '설정 파일이 깨졌다 — 고치거나 지운 뒤 다시 시도하라' };
  }
  return { state: raw.state, existing, problem: null };
}

/**
 * `--merge`의 출력 한 줄과 진단. **파일은 쓰지 않는다.**
 * @returns `{ json, diagnostic }` — `diagnostic`이 null이 아니면 stderr에 그대로 낸다.
 *   `problem`이 null이 아니면 `merged`는 **항상 null**이다(커맨드가 쓸 것이 없어야 한다).
 */
function mergeMode({ note, mergeSeen, mergeArg }) {
  const p = readPatch(mergeSeen, mergeArg);
  const file = configPath();
  const e = readExisting(file);
  const problem = p.problem ?? e.problem;
  const merged = problem ? null : mergeConfigFile(e.existing, p.patch);
  return {
    json: { note, mode: 'merge', path: file, state: e.state,
      existed: e.state === 'ok' && e.existing !== null, problem, merged },
    diagnostic: problem ? `[devkit] · --merge를 수행하지 않았다 — ${problem}\n` : null,
  };
}

module.exports = { mergeMode };
