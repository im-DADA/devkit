// 보호 파일 패턴 — protected-file(Write/Edit)과 bash-guard(리다이렉트) 양쪽에서 공유.
//
// ⚠ `.env`는 `overwriteOnly`다. Read는 애초에 훅이 안 보므로(matcher가 Write|Edit) 이 규칙이
// 지키는 건 유출이 아니라 **소실**이다 — .env는 gitignore라 통째로 날리면 복구가 안 된다.
// 부분 수정(Edit)·추가(`>>`)는 소실을 만들 수 없으니 막을 이유가 없고, 막아 두면 값 하나
// 고치는 실사용까지 전부 걸려 사용자가 직접 하게 된다(그게 지금 상태였다).
// ⚠ `.env.example`·`.env.sample`·`.env.template`·`.env.dist`는 뺀다. 값이 없는 **커밋되는
// 템플릿**이라 소실될 시크릿이 애초에 없고, 막아 두면 플레이스홀더 한 줄 고치는 것까지
// 걸린다(실측: 21개 프로젝트 감사에서 `.env.example` 차단 2건).
// 부정 전방탐색이 `[\w.-]*`로 시작하는 이유는 `.env.local.example`처럼 **마지막** 접미사가
// 템플릿인 경우를 잡기 위해서다.
//
// `decision` — 되돌릴 수 없으면 `deny`, 사고는 아니지만 확인이 필요하면 `ask`(사용자 확인 창).
//   `.env` 덮어쓰기: gitignore라 복구 불가 → deny
//   `.git/` 내부: 저장소 손상은 복구가 어렵다 → deny
//   lockfile·`node_modules/`: 패키지 매니저로 다시 만들 수 있다 → ask
const ENV_TEMPLATE = String.raw`(?![\w.-]*\.(example|sample|template|dist)$)`;

// `id`는 설정(`guards.protectedFiles`)의 키다. 없는 id는 오버라이드 대상이 아니다.
const PROTECTED = [
  { id: 'env', re: new RegExp(String.raw`(^|/)\.env${ENV_TEMPLATE}(\.[\w.-]+)?$`), why: '.env (시크릿)', overwriteOnly: true, decision: 'deny' },
  { id: 'lockfile', re: /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/, why: 'lockfile (패키지 매니저가 관리)', decision: 'ask' },
  { id: 'git', re: /(^|\/)\.git\//, why: '.git 내부', decision: 'deny' },
  { id: 'nodeModules', re: /(^|\/)node_modules\//, why: 'node_modules (생성물)', decision: 'ask' },
  // SG1 — devkit 설정 파일. **사람은 `/kit setup`으로 자유롭게 바꾸고, AI는 말없이 못 바꾼다.**
  //
  // 왜 필요한가: 설정이 검증 게이트(`pdca.docs`)·가드 강도를 정하게 되면서, 게이트에 막힌
  // AI가 **설정 파일을 고쳐 게이트를 여는** 경로가 생긴다. 그건 devkit이 원래 막으려던 바로
  // 그 행동이다(RULES.md의 "막는 쪽과 만드는 쪽의 판정 근거는 대칭이어야 한다").
  //
  // ⚠ **이 규칙은 `guards.protectedFiles`로 끌 수 없다** — id가 그 스키마에 없다. 설정으로
  // 자기 보호를 끄면 한 단계 우회가 늘 뿐 아무것도 막지 못한다. `decision`이 deny가 아니라
  // ask인 이유는 사용자가 "그래 바꿔"라고 할 수 있어야 하기 때문이다(교착을 만들지 않는다).
  { id: 'devkitConfig', re: /(^|\/)\.devkit\/config\.json$/, why: 'devkit 설정 (/kit setup으로 바꾼다)', decision: 'ask' },
];

/** 설정으로 판정을 바꿀 수 없는 규칙 — 자기 보호를 자기 설정으로 끄는 순환을 막는다 */
const UNOVERRIDABLE = new Set(['devkitConfig']);

function matchProtected(file) {
  if (!file || typeof file !== 'string') return null;
  return PROTECTED.find((p) => p.re.test(file)) || null;
}

/**
 * 이 쓰기를 막거나 확인받아야 하는가. 순수 — fs를 보지 않는다(존재 여부 판단은 호출자 몫).
 *
 * @param how overwrite=true면 파일 내용을 통째로 대체한다
 * @param overrides `{[id]: 'deny'|'ask'|'off'}` — 설정의 `guards.protectedFiles`.
 *   **인자를 안 주면 현행과 완전히 동일하다**(설정 안 한 사람의 동작이 안 바뀐다).
 *   `UNOVERRIDABLE`에 든 규칙은 이 인자를 무시한다.
 * @returns 걸린 규칙(`decision`이 deny/ask를 정한다), 해당 없으면 `null`
 */
function blockedFor(file, how, overrides) {
  const hit = matchProtected(file);
  if (!hit) return null;
  if (hit.overwriteOnly && !(how && how.overwrite)) return null;
  if (!overrides || UNOVERRIDABLE.has(hit.id)) return hit;
  const want = overrides[hit.id];
  if (want === 'off') return null;
  if (want === 'deny' || want === 'ask') return { ...hit, decision: want };
  return hit;
}

module.exports = { PROTECTED, UNOVERRIDABLE, matchProtected, blockedFor };
