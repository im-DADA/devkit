#!/usr/bin/env node
// PreToolUse(Write|Edit): 시크릿/생성물/버전관리 파일 편집 차단. exit 2 → 거부.
const fs = require('node:fs');
const { record } = require('./lib/audit');
const { blockedFor } = require('./lib/protected-patterns');

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
if (hit) {
  record({ hook: 'protected-file', action: 'blocked', reason: hit.why, file });
  const how = hit.overwriteOnly
    ? `기존 파일을 통째로 덮어쓰려 합니다. 값을 고치는 거라면 Write 대신 Edit을 쓰세요.\n`
    : `이 파일은 직접 편집 대신 사용자가 처리하거나, 필요하면 명시 허가를 받으세요.\n`;
  process.stderr.write(
    `[devkit] 보호된 파일 편집 차단: ${hit.why}\n대상: ${file}\n${how}`
  );
  process.exit(2);
}
process.exit(0);
