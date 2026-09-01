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

// 승인 에스케이프 해치: 사용자가 의존성 추가를 승인하면 AI가 명령 앞에
// DEVKIT_ALLOW_DEP=1 을 붙여 실행한다. 이 마커가 있으면 통과시킨다.
// (훅은 stateless라 '방금 승인함'을 알 수 없으므로, 승인 의도를 명령에 명시)
if (/(^|[\s;&|])DEVKIT_ALLOW_DEP=1(\s|$)/.test(cmd)) {
  record({ hook: 'dep-guard', action: 'allowed', reason: 'user-approved (DEVKIT_ALLOW_DEP)', command: cmd });
  process.exit(0);
}

// "설치 서브커맨드 + 패키지 이름(플래그 아닌 토큰)"이 있으면 = 새 의존성 추가.
// bare `npm install`/`pnpm install`(인자 없음 = lockfile 복원)은 매칭 안 됨.
// install 뒤에 실제 패키지 토큰이 와야 매칭되도록 정밀화 → require('x') 같은
// 비설치 명령의 오탐을 막는다.
// install/add 뒤에 (플래그 0개 이상 건너뛰고) 플래그가 아닌 패키지 토큰이
// 하나라도 있으면 새 의존성 추가로 본다. `-D`·`--save-dev` 등 선행 플래그 허용.
const PKG = /(?:\s+-{1,2}[\w-]+)*\s+(?!-)[\w@./-]/;
const ADD = [
  new RegExp(`\\bnpm\\s+(?:install|i|add)${PKG.source}`, 'i'),
  new RegExp(`\\bpnpm\\s+(?:add|install|i)${PKG.source}`, 'i'),
  new RegExp(`\\byarn\\s+add${PKG.source}`, 'i'),
  new RegExp(`\\bbun\\s+add${PKG.source}`, 'i'),
];

// ⚠ 리다이렉션은 인자가 아니다. 떼지 않으면 `2>&1`의 `2`가 패키지 이름으로 읽혀
// **bare install이 "새 의존성"으로 차단된다**(실사용에서 발견). `>`는 패키지 문자셋에 없어
// `> /dev/null`은 통과하는데 `2`는 \w라서 걸리는, 눈에 안 띄는 구멍이었다.
// 순서가 중요하다 — `>&` 형태를 먼저 떼지 않으면 뒤 규칙이 `&`를 못 넘어 그대로 남는다.
// ⚠ heredoc 본문은 일부러 안 뗀다. 떼면 `cat <<EOF | sh` 안에 설치 명령을 숨길 수 있다 —
// 오탐은 한 번 막히고 끝이지만 미탐은 이 훅의 존재 이유를 없앤다.
const stripRedirects = (c) => c
  .replace(/\d*>>?\s*&\s*\d*/g, ' ')    // 2>&1, >&2
  .replace(/\d*>>?\s*[^\s;|&]+/g, ' ')  // > out.txt, 2> err.log
  .replace(/<\s*[^\s;|&]+/g, ' ');      // < in.txt

if (ADD.some((re) => re.test(stripRedirects(cmd)))) {
  record({ hook: 'dep-guard', action: 'blocked', reason: 'new dependency', command: cmd });
  process.stderr.write(
    `[devkit] 새 의존성 추가 감지 → 사용자 승인 필요.\n대상: ${cmd}\n` +
    `사용자에게 왜 필요한지 먼저 묻고, 승인되면 명령 앞에 DEVKIT_ALLOW_DEP=1 을 붙여 실행하세요.\n` +
    `⚠ 이 차단을 피하려고 라이브러리 없는 설계로 돌아가지 마세요 — 묻는 것이 이 훅의 목적입니다.\n` +
    `예: DEVKIT_ALLOW_DEP=1 pnpm add <pkg>\n`
  );
  process.exit(2);
}
process.exit(0);
