// PDCA 트랙(Quick/Full) 판정 — PLAN.md 첫머리 1줄이 DESIGN 단계를 생략할지 가른다.
//
// ⚠ **이 모듈은 어떤 훅에도 배선되지 않는다.** 트랙이 게이트 판정에 들어가는 순간, 사람이
// PLAN.md에 손으로 쓴 한 줄이 behaviors.json·GAP·REVIEW 검증 층 전체를 끄는 경로가 된다
// (막는 쪽과 만드는 쪽의 판정 근거는 대칭이어야 한다). Quick이 생략하는 것은 DESIGN.md와
// 두 번째 승인뿐이고, 그 둘은 애초에 pdca-state.js의 STAGE_REQUIREMENTS에 없다.
// 그래서 Quick 트랙은 pdca-gate를 **한 글자도 고치지 않고** 성립한다.
// 이 사실은 test/track.test.mjs가 회귀로 고정한다.
//
// fs를 만지지 않는다(입력은 PLAN.md 경로가 아니라 본문 문자열). 어떤 입력에도 throw하지 않는다.
const HEAD_LINES = 10;

// 줄 전체 일치 — 산문 속 언급이 선언으로 승격되지 않는다. `g`를 주지 않는 이유는
// exec의 lastIndex가 호출 사이에 새는 것을 원천 차단하기 위해서다.
// 후미 `\r`: 줄 자르기를 `\n`으로만 하므로 CRLF 문서에서는 `\r`이 줄 끝에 남는다.
const TRACK_RE = /^[ \t]*[-*][ \t]+\*\*track\*\*:[ \t]*(Quick|Full)[ \t\r]*$/im;

// 미해결 = 토큰이 존재한다. 닫는 `]`를 요구하지 않고(안 닫으면 안 세지는 우회 방지),
// 해결 표기(`[RESOLVED]`·취소선 등)를 인정하지 않는다 — 인정 표기를 열거하면 그것이
// 허용목록이 되어 다음 표기에서 또 샌다. 해결은 마커를 답으로 **교체**하는 것이다.
const CLARIFICATION_RE = /\[NEEDS\s+CLARIFICATION/gi;

const CANON = { quick: 'Quick', full: 'Full' };
const NONE = { track: null, declared: null, clarifications: 0 };

/**
 * PLAN 본문에서 트랙을 판정한다.
 *
 * `declared`(적힌 값)와 `track`(실효 값)을 나눠 돌려주는 이유는 behaviors.js의 evidence 강등과
 * 같다 — 파일을 고치지 않고 **읽는 시점에** 강등한다. 파일을 고치면 모델이 되돌려 무한 왕복이 난다.
 *
 * @param {string} planText PLAN.md 본문 문자열
 * @returns {{track:'Quick'|'Full'|null, declared:'Quick'|'Full'|null, clarifications:number}}
 *   `track === null`은 "선언이 없거나 형태가 다르다"이고, 소비자가 이를 Full로 취급하는 것이
 *   fail-open의 자리다(= 현행 동작. 없는 선언을 여기서 발명하지 않는다).
 */
function readTrack(planText) {
  if (typeof planText !== 'string') return { ...NONE };

  const head = planText.split('\n').slice(0, HEAD_LINES).join('\n');
  const m = TRACK_RE.exec(head);
  const declared = m ? CANON[m[1].toLowerCase()] : null;

  // 마커는 문서 전체에서 센다 — behavior 목록·리스크 절에 주로 나온다
  const clarifications = (planText.match(CLARIFICATION_RE) || []).length;

  // 답할 설계 질문이 남았으면 DESIGN을 건너뛸 수 없다. 강등은 Quick 선언에만 적용된다.
  const track = declared === 'Quick' && clarifications > 0 ? 'Full' : declared;

  return { track, declared, clarifications };
}

// readTrack만 내보낸다. CLARIFICATION_RE는 `g` 플래그를 갖고 있어 export하면 외부의
// `.test()`/`.exec()` 호출이 lastIndex를 물고 결과가 호출마다 흔들린다 — TRACK_RE에서 `g`를
// 뺀 이유가 export 표면에서 되살아나는 자리다. 정규식이 필요하면 이 파일을 읽어라.
module.exports = { readTrack };
