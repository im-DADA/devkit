#!/usr/bin/env node
// Stop: 턴 종료 시 프로젝트에 typecheck/lint 스크립트가 있으면 1회 실행하고 실패를 컨텍스트로 표면화 (비차단).
//
// ⚠ Stop 훅은 stdout이 그냥 디버그 로그로 간다 — 컨텍스트에 들어가는 건 UserPromptSubmit·
// UserPromptExpansion·SessionStart 세 이벤트뿐이다. 따라서 hookSpecificOutput JSON으로 내보낸다.
//
// 차단(decision:"block")은 쓰지 않는다: WIP 상태에서 턴이 막히면 사용자가 훅 자체를 꺼버려
// 효과가 0이 된다. 항상 켜져 있는 경고가 껐다 켜는 차단보다 실효가 크다.
//
// 노이즈 있으면 hooks.json에서 이 훅만 빼면 됨.
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { record } = require('./lib/audit');

// Stop 훅이 연속 차단하면 CC가 훅을 무시한다. 지금은 비차단이라 루프가 안 나지만,
// 재진입 시 검증을 반복할 이유가 없으므로 조기 종료한다.
try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (input && input.stop_hook_active) process.exit(0);
} catch {
  // stdin이 없거나 깨져도 검증 자체는 진행한다(훅이 대화를 막으면 안 됨)
}

function findPkg(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 6; i++) {
    const p = path.join(dir, 'package.json');
    if (fs.existsSync(p)) return p;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const pkgPath = findPkg(process.cwd());
const root = pkgPath ? path.dirname(pkgPath) : process.cwd();
const problems = [];

// ── B9 백스톱: 구현 단계인데 behaviors.json이 없으면 경고 ──────────────
// D5 대응. behaviors.json은 /gap의 소비 입력이라 /gap·/report가 하드 게이트로 막지만,
// 그보다 이른 시점에 놓쳤음을 알려 되돌릴 여지를 준다. (강제 생성이 아니라 결핍 경고)
//
// ⚠ 백스톱은 침묵할 줄 알아야 산다. 실사용에서 두 번 헛짖었다 —
//   (1) status:done인 완료 사이클, (2) docs/archive/로 옮겨진 사이클.
// 완료한 작업에 "미완이다"를 띄우면 다음부터 이 경고 전체가 무시된다(무시 학습).
try {
  const { readState } = require('./lib/pdca-state');
  const { archiveAlt } = require('./lib/evidence');
  const state = readState(root);
  const pending = state && state.status !== 'done';
  if (pending && !state.foreign && ['do', 'gap', 'report'].includes(state.stage)) {
    const rel = `docs/${state.cycleId}/behaviors.json`;
    const alt = archiveAlt(rel); // /report가 옮긴 자리도 본다
    const found = [rel, alt].some((p) => p && fs.existsSync(path.join(root, p)));
    if (!found) {
      problems.push(
        `### behaviors.json 누락 (stage: ${state.stage})\n` +
          `구현 단계인데 \`docs/${state.cycleId}/behaviors.json\`이 없다. ` +
          `/plan의 behavior 목록 단계를 완료해 분모를 고정하라 — 없으면 /gap이 진행되지 않는다.`,
      );
    }
  }
} catch {
  // 상태 로드 실패는 무시(백스톱이 대화를 막지 않는다)
}

// ── typecheck/lint (있을 때만) ────────────────────────────────────
let scripts = {};
if (pkgPath) {
  try { scripts = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).scripts || {}; } catch { /* noop */ }
}
const toRun = ['typecheck', 'lint'].filter((s) => scripts[s]);
for (const s of toRun) {
  try {
    execSync(`npm run -s ${s}`, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`.trim().split('\n').slice(-20).join('\n');
    problems.push(`### npm run ${s} 실패\n${out}`);
    record({ hook: 'stop-verify', action: 'verify-fail', script: s });
  }
}

if (problems.length) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'Stop',
        additionalContext: `[devkit] 종료 전 검증 실패 — 고쳐야 함:\n\n${problems.join('\n\n')}`,
      },
    }),
  );
}
process.exit(0);
