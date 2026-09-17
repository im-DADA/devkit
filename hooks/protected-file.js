#!/usr/bin/env node
// PreToolUse(Write|Edit): 보호 파일 편집. 되돌릴 수 없으면 차단(exit 2), 다시 만들 수 있으면 사용자 확인 창.
// 어느 쪽인지는 lib/protected-patterns.js의 `decision`이 정한다.
const fs = require('node:fs');
const { record } = require('./lib/audit');
const { blockedFor } = require('./lib/protected-patterns');
const { deny, ask } = require('./lib/decision');

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return null; }
}

const input = readInput();
const file = input?.tool_input?.file_path;
if (!file || typeof file !== 'string') process.exit(0);

// Edit은 매칭된 문자열만 바꾸므로 파일을 통째로 잃을 수 없다. Write는 대체지만 대상이
// 없으면 새로 만드는 것이라 잃을 것이 없다. `.env`는 이 둘을 통과한다(overwriteOnly).
// ⚠ 도구 이름이 안 오면 Write로 본다 — 모르는 쪽을 안전한 쪽으로 접는다.
const isEdit = input?.tool_name === 'Edit';
const overwrite = !isEdit && fs.existsSync(file);

const hit = blockedFor(file, { overwrite });
if (hit && hit.decision === 'ask') {
  record({ hook: 'protected-file', action: 'asked', reason: hit.why, file });
  ask(
    `[devkit] ${hit.why} 직접 수정 — ${file}`,
    `[devkit] ${file}은 보통 직접 고치지 않는다(${hit.why}). 사용자 확인 창을 띄웠다. ` +
      '거절되면 패키지 매니저 명령(install 등)으로 다시 만드는 방법을 제안하라.',
  );
}
if (hit) {
  record({ hook: 'protected-file', action: 'blocked', reason: hit.why, file });
  const how = hit.overwriteOnly
    ? `기존 파일을 통째로 덮어쓰려 합니다. 값을 고치는 거라면 Write 대신 Edit을 쓰세요.\n`
    : `이 파일은 직접 편집 대신 사용자가 처리하거나, 필요하면 명시 허가를 받으세요.\n`;
  deny(`[devkit] 보호된 파일 편집 차단: ${hit.why}\n대상: ${file}\n${how}`);
}
process.exit(0);
