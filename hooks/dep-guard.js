#!/usr/bin/env node
// PreToolUse(Bash): 새 패키지 설치를 차단 → AI가 임의로 의존성 추가 못 하고 사용자에게 물어보게 강제.
// (bare `npm install` / `npm ci` = 기존 의존성 복원이므로 허용)
const fs = require('node:fs');
const { record } = require('./lib/audit');

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return null; }
}

const cmd = readInput()?.tool_input?.command;
if (!cmd || typeof cmd !== 'string') process.exit(0);

// "설치 명령 + 패키지 이름(플래그 아닌 토큰)"이 있으면 = 새 의존성 추가
const ADD = [
  /\bnpm\s+(install|i|add)\s+(?!-)\S/i,
  /\bpnpm\s+(add|install|i)\s+(?!-)\S/i,
  /\byarn\s+add\s+(?!-)\S/i,
  /\bbun\s+add\s+(?!-)\S/i,
];

if (ADD.some((re) => re.test(cmd))) {
  record({ hook: 'dep-guard', action: 'blocked', reason: 'new dependency', command: cmd });
  process.stderr.write(
    `[devkit] 새 의존성 추가 감지 → 사용자 승인 필요.\n대상: ${cmd}\n` +
    `왜 필요한지 사용자에게 먼저 물어보고, 승인되면 사용자가 직접 설치하거나 명시 허가를 받으세요.\n`
  );
  process.exit(2);
}
process.exit(0);
