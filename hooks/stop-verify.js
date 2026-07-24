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
if (!pkgPath) process.exit(0);

let scripts = {};
try { scripts = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).scripts || {}; } catch { process.exit(0); }

const root = path.dirname(pkgPath);
const toRun = ['typecheck', 'lint'].filter((s) => scripts[s]);
if (!toRun.length) process.exit(0);

const problems = [];
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
