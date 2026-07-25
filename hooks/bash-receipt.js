#!/usr/bin/env node
// PostToolUse(Bash): 실행된 명령과 그 출력을 `.devkit/receipts.jsonl`에 봉인한다.
// evidence가 인용한 출력이 "실제로 실행된 적 있는가"를 나중에 대조하기 위한 원본.
//
// 비차단 불변식: 어떤 입력에도 exit 0. PostToolUse는 advisory라 차단 능력이 애초에 없지만,
// 비정상 종료 코드조차 남기지 않는다 — 훅이 죽어 보이면 봉인 자체를 의심하게 된다.
// 실패는 조용히 삼키지 않고 stderr에 원문을 남긴 뒤 degrade한다(audit.js와 동일).
const fs = require('node:fs');
const { appendReceipt } = require('./lib/receipt');
const { findProjectRoot } = require('./lib/project-root');

// 킬스위치. 기본값은 켜짐(opt-out) — 봉인이 없으면 인용 대조 층이 통째로 죽는다.
// 끄는 수단이 필요한 이유: 마스킹은 알려진 키 형식 9종뿐이고 그 외(`export K=V`·
// DB URL·Bearer 토큰)는 평문으로 남는다. 시크릿을 다루는 명령엔 선택지가 있어야 한다.
//
// 목적이 시크릿 보호이므로 **실패는 닫히는 쪽**이다: 아는 on 값에만 켜고 나머지는 끈다.
// `'0'`에만 반응하면 `DEVKIT_RECEIPTS=false`나 오타 하나가 조용히 기록을 여는데,
// 사용자는 껐다고 믿고 시크릿 명령을 돌린다 — 그 실수의 대가가 평문 유출이다.
const ON = new Set(['', '1', 'true', 'on']);
const OFF = new Set(['0', 'false', 'off', 'no']);
const receipts = (process.env.DEVKIT_RECEIPTS ?? '').trim().toLowerCase();
if (!ON.has(receipts)) {
  // 조용히 끄지 않는다 — 오타로 꺼진 것과 의도적으로 끈 것은 사용자만 구분할 수 있다.
  if (!OFF.has(receipts)) {
    process.stderr.write(`[devkit] DEVKIT_RECEIPTS="${process.env.DEVKIT_RECEIPTS}" is not a recognized value — receipts disabled (on: 1|true|on, off: 0|false|off|no)\n`);
  }
  process.exit(0);
}

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch (e) {
    process.stderr.write(`[devkit] bash-receipt 입력 파싱 실패: ${e.message}\n`);
    return null;
  }
}

try {
  const input = readInput();
  const res = input && typeof input.tool_response === 'object' && input.tool_response !== null
    ? input.tool_response
    : null; // 형태가 다르면 봉인할 실행 결과가 없는 것 — 에러가 아니라 해당 없음

  if (res) {
    appendReceipt(findProjectRoot(process.cwd()), {
      command: input.tool_input && input.tool_input.command,
      stdout: res.stdout,
      stderr: res.stderr,
      interrupted: res.interrupted,
    });
  }
} catch (e) {
  process.stderr.write(`[devkit] bash-receipt 실패: ${e.message}\n`);
}

process.exit(0);
