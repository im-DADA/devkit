#!/usr/bin/env node
// PreToolUse(Bash): 새 패키지 설치 감지 → 사용자 확인 창(ask). 막지 않는다.
// (bare `npm install` / `npm ci` = 기존 의존성 복원이므로 허용)
//
// 왜 차단(exit 2)에서 확인 창으로 바꿨나(2026-09-17): 막아 두니 Claude가 사용자에게 묻는 대신
// **라이브러리 없는 설계로 조용히 우회**했다(사용자 제보). 사용자는 더 나쁜 구현을 받고, 선택지가
// 있었다는 것도 모른다. 확인 창은 사용자가 한 번 누르면 끝나고, 우회할 동기 자체를 없앤다.
// 예전의 `DEVKIT_ALLOW_DEP=1` 탈출구는 없앴다 — Claude가 스스로 붙이면 확인 창을 건너뛸 수 있다.
const fs = require('node:fs');
const { record } = require('./lib/audit');
const { ask } = require('./lib/decision');

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return null; }
}

const cmd = readInput()?.tool_input?.command;
if (!cmd || typeof cmd !== 'string') process.exit(0);

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
// 오탐은 확인 창 한 번이지만 미탐은 이 훅의 존재 이유를 없앤다.
const stripRedirects = (c) => c
  .replace(/\d*>>?\s*&\s*\d*/g, ' ')    // 2>&1, >&2
  .replace(/\d*>>?\s*[^\s;|&]+/g, ' ')  // > out.txt, 2> err.log
  .replace(/<\s*[^\s;|&]+/g, ' ');      // < in.txt

if (ADD.some((re) => re.test(stripRedirects(cmd)))) {
  record({ hook: 'dep-guard', action: 'asked', reason: 'new dependency', command: cmd });
  ask(
    `[devkit] 새 의존성 추가 — ${cmd}`,
    '[devkit] 새 의존성 추가라 사용자 확인 창을 띄웠다. 왜 필요한지 아직 설명하지 않았다면 먼저 설명하라. ' +
      '⚠ 거절되더라도 라이브러리 없는 설계로 조용히 바꾸지 마라 — 대안과 그 대가(직접 구현할 범위)를 ' +
      '말하고 사용자가 고르게 하라.',
  );
}
process.exit(0);
