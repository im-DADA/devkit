#!/usr/bin/env node
// PreToolUse가 아닌 UserPromptSubmit 훅 — 사용자가 보낸 모든 프롬프트에서 실행된다(matcher 미지원).
// 두 가지 일을 한다:
//   1) 진행 중 사이클이 있으면 현재 단계·다음 액션을 주입(재개 지원)
//   2) 없고 프롬프트가 기능 요청이면 PDCA 규약을 주입(자동 발동)
// 프롬프트를 절대 차단하지 않는다(exit 2 금지) — 오탐 시 사용자가 다시 타이핑해야 하므로 치명적.
const fs = require('node:fs');
const { findProjectRoot } = require('./lib/project-root');
const { readState, isActive } = require('./lib/pdca-state');
const { shouldTriggerPdca } = require('./lib/pdca-patterns');

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return null;
  }
}

/** stdout으로 컨텍스트 주입 (UserPromptSubmit 계약) */
function emit(context) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: context,
      },
    }),
  );
}

function resumeContext(state) {
  const lines = [
    `[devkit PDCA] 진행 중 사이클: ${state.cycleId} — 단계 ${state.stage} (${state.status})`,
    `다음 액션: ${state.nextAction}`,
    `문서: docs/${state.cycleId}/`,
  ];
  if (state.status === 'awaiting-approval') {
    lines.push(
      '⚠ 지금은 승인 대기 상태다. 사용자가 명시적으로 승인하기 전에 다음 단계로 넘어가지 말 것.',
    );
  }
  return lines.join('\n');
}

const KICKOFF = [
  '[devkit PDCA] 이 요청은 여러 파일에 걸친 기능 작업으로 보인다.',
  '바로 구현하지 말고: ① docs/{YYYY-MM-DD}-{slug}/PLAN.md 작성 → 보여주고 승인 대기',
  '② 승인되면 architect로 DESIGN.md → 보여주고 승인 대기 ③ 승인되면 구현 ④ 구현 후 /gap 필수(미달이면 /iterate).',
  '사이클 시작 시 .devkit/pdca-state.json을 생성/갱신할 것. 규약 상세는 RULES.md "PDCA 사이클".',
  '사소한 작업이라 판단되면 이 안내를 무시하고 바로 진행해도 된다.',
].join('\n');

function main() {
  const input = readInput();
  if (!input || typeof input.prompt !== 'string') return; // 조용히 통과

  const root = findProjectRoot(input.cwd || process.cwd());
  const state = readState(root);

  // 진행 중 사이클이 우선 — 감지 로직 자체를 건너뛴다
  if (isActive(state)) {
    emit(resumeContext(state));
    return;
  }

  if (shouldTriggerPdca(input.prompt).trigger) emit(KICKOFF);
}

try {
  main();
} catch (e) {
  // 훅 오류가 사용자 프롬프트를 막지 않도록 경고만 남기고 통과
  process.stderr.write(`[devkit] pdca-detect 오류: ${e.message}\n`);
}
process.exit(0);
