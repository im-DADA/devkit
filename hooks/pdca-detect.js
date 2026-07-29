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
    `문서: docs/${state.cycleId}/ (진행 상황은 PROGRESS.md·behaviors.json)`,
  ];
  if (state.status === 'awaiting-approval') {
    lines.push(
      '⚠ 지금은 승인 대기 상태다. 사용자가 명시적으로 승인하기 전에 다음 단계로 넘어가지 말 것.',
    );
  }
  return lines.join('\n');
}

// 산출물 형식을 여기에 직접 박는다. "RULES.md 참조"로 넘기면 읽지 않고 창작한다
// (실전 검증에서 behaviors.json 누락 + 상태 스키마 창작으로 확인됨).
const KICKOFF = [
  '[devkit PDCA] 이 감지는 프롬프트의 표현만 보므로 자주 틀린다. 먼저 네가 판단하라 —',
  '이 요청이 (a) 파일 3개 이상을 만지거나 (b) 되돌리기 어렵거나 (c) 구조 결정이 필요한가?',
  '셋 다 아니면 이 안내를 무시하고 바로 진행하라. 그게 정상이고 흔한 경우다 —',
  '문서 하나 만들기, 함수 하나 고치기, 스크립트 한 번 돌리기에 사이클을 열지 마라.',
  '해당하면 아래를 따른다. 바로 구현하지 말 것:',
  '① docs/{YYYY-MM-DD}-{slug}/ 생성 (slug는 영문 kebab-case 2~4단어) 후 PLAN.md 작성 —',
   '   목표 · 단계별 작업 · 건드릴 파일 · behavior 목록 · 리스크 · 검증 방법 · 범위 밖.',
  '   ⚠ 사이클 폴더에는 PDCA 문서(.md/.json)만 둔다. 시안·목업 HTML·PNG·데이터 파일은 넣지 말고 프로젝트 실제 위치에 두고 경로로 참조하라.',
  '   PLAN 첫머리에 트랙 1줄: `- **track**: Quick`(답할 설계 질문이 없다 → DESIGN 생략, 멈춤점 1곳)',
  '   또는 `- **track**: Full`(기본). ⚠ Quick도 behaviors.json · /gap · /review · REPORT.md는 전부 필수다 — 빠지는 것은 DESIGN.md와 두 번째 승인뿐이다.',
  '② 같은 폴더에 behaviors.json 생성 (필수). PLAN의 behavior를 전부 passes:false로 넣어 Gap의 분모를 고정한다:',
  '   {"version":1,"cycleId":"{폴더명}","behaviors":[{"id":"B1","desc":"...","priority":"P1","passes":false,"evidence":null}]}',
  '   evidence는 구현 후 {kind,ref,cmd,output,at}로 채운다. output(실행 흔적)이 없으면 통과로 세지 않는다.',
  '③ .devkit/pdca-state.json 생성 — 정확히 이 4필드만:',
  '   {"version":1,"cycleId":"{폴더명}","stage":"plan","status":"awaiting-approval"}',
  '   cycle · slug · phase · startedAt · artifacts · gates 같은 다른 키를 넣지 말 것(bkit 스키마다).',
  '④ docs/{cycle}/PROGRESS.md 생성 — 첫 줄 "# PROGRESS — docs/{cycle}/", 이후 각 단계가 한 줄씩 append.',
  '⑤ PLAN을 보여주고 승인 대기. ⚠ 사용자가 명시적으로 승인하기 전에 다음 단계로 넘어가지 말 것.',
  '⑥ Full이면 승인 후 architect로 DESIGN.md → 다시 승인 대기. Quick이면 이 단계를 건너뛴다 ⑦ 구현(behavior 통과 시마다 behaviors.json 갱신)',
  '⑧ 구현 후 /gap 필수 — 통과 기준은 unproven==0(증거 없는 통과 주장 0건)이지 Match Rate 숫자가 아니다. 미달이면 /iterate.',
  '⑨ Gap 통과 후 /review 필수 — 결과를 docs/{cycle}/REVIEW.md로 남긴다. 이게 없으면 ⑩ REPORT.md 쓰기가 훅에 차단된다.',
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
