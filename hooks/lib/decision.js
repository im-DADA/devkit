// PreToolUse 판정 출력 — 가드 훅들이 같은 형식으로 답하도록 한곳에 모은다.
//
//   deny  → exit 2. stderr가 Claude에게 거부 사유로 간다. **되돌릴 수 없는 것만.**
//   ask   → exit 0 + permissionDecision "ask". 사용자 확인 창이 뜨고, 자동 모드에서도 강제된다.
//   warn  → exit 0 + additionalContext만. 막지 않고 Claude에게 알린다.
//
// 왜 셋으로 갈랐나(2026-09-17): 전부 exit 2로 막던 시절, 21개 프로젝트에서 차단 187건 중 상당수가
// "사고는 아니고 물어보면 되는" 것이었고, 의존성 차단은 Claude가 **라이브러리 없는 설계로 몰래
// 우회**하게 만들었다. 확인 창은 사용자가 한 번 누르면 끝나고, 우회할 동기도 없앤다.
//
// ⚠ ask의 permissionDecisionReason은 **사용자에게만** 보이고 Claude에게는 안 간다(공식 hooks 문서).
//   Claude가 알아야 할 것은 additionalContext로 따로 보낸다.
// ⚠ 여러 훅의 판정이 섞이면 Claude Code가 deny > defer > ask > allow 순으로 합친다.
// ⚠ 출력은 fs.writeSync로 쓴다. process.stdout.write 직후 exit하면 macOS 파이프에서 비동기라
//   JSON이 잘릴 수 있고, 잘린 JSON은 판정으로 읽히지 않아 **그냥 통과**한다(열리는 쪽으로 실패).
const fs = require('node:fs');

/**
 * 막는다. Claude에게 사유가 간다.
 * @throws 반환하지 않는다 — 프로세스를 exit 2로 끝낸다
 */
function deny(message) {
  fs.writeSync(2, message.endsWith('\n') ? message : `${message}\n`);
  process.exit(2);
}

function emit(fields) {
  fs.writeSync(1, JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...fields } }));
  process.exit(0);
}

/**
 * 사용자 확인 창을 띄운다. 자동 모드에서도 분류기가 몰래 승인하지 못한다.
 * @param userReason 확인 창에 뜨는 문구 — **사용자만** 본다. 무엇을 승인하는지 대상이 들어가야 한다
 * @param claudeContext Claude에게 가는 안내 — 거절됐을 때 어떻게 행동할지
 */
function ask(userReason, claudeContext) {
  emit({ permissionDecision: 'ask', permissionDecisionReason: userReason, additionalContext: claudeContext });
}

/** 막지 않고 Claude에게만 알린다. 판정 필드를 넣지 않아야 평소 권한 흐름을 그대로 탄다 */
function warn(claudeContext) {
  emit({ additionalContext: claudeContext });
}

module.exports = { deny, ask, warn };
