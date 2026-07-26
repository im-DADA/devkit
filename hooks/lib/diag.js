// 진단 출력(stderr)의 단일 출구.
//
// 왜 함수 하나로 모으나: stderr도 stdout과 **같은 채널**이다. `node scripts/verify-evidence.mjs`
// 처럼 Bash로 돌린 명령은 stdout·stderr가 통째로 bash-receipt에 봉인되고, 인용 대조는
// '✔로 시작하는 줄'에서만 일어난다(citation.js tickLines). 즉 진단 한 줄이 여러 줄로
// 흩어지면서 ✔ 줄을 만들면 그게 다음 실행에서 위조를 입증하는 후보가 된다.
//
// 이게 위조 벡터인 것보다 사고 벡터인 게 더 크다: 이 자리의 보간값은 대부분 `e.message`이고
// V8의 SyntaxError는 **입력 스니펫을 개행째로** 담는다. 깨진 behaviors.json 안에 ✔가 있으면
// (테스트 출력을 붙여넣다 JSON을 깨뜨리는 흔한 사고) 위조 의도 없이 그 줄이 만들어진다.
//
// 처방은 "어느 보간값이 위험한가"를 세는 대신 **형태를 강제**하는 쪽이다(RULES §코드 철학):
// 메시지 전체를 한 줄로 붕괴시킨다. 그러면 진단은 항상 정확히 한 줄이고 그 줄은 항상
// '[devkit] '로 시작한다 — 호출자가 무엇을 보간하든 tick 줄이 나올 수 없다.
// 포기한 것: 진단 메시지는 여러 줄로 쓸 수 없다(스택 트레이스·들여쓴 본문 불가).
//   지금 그런 호출자는 없고, 여러 줄이 필요하면 그건 stderr가 아니라 파일로 갈 것이다.

/** 공백류를 전부 스페이스로 붕괴시킨다 — 길이는 보존된다(report-format.mjs의 field와 같은 규칙) */
function collapse(s) {
  return String(s).replace(/\s/g, ' ');
}

/** `[devkit] ` 접두를 붙여 stderr에 **한 줄로** 쓴다 */
function warn(message) {
  process.stderr.write(`[devkit] ${collapse(message)}\n`);
}

module.exports = { warn };
