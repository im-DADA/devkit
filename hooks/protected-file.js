#!/usr/bin/env node
// PreToolUse(Write|Edit): 시크릿/생성물/버전관리 파일 편집 차단. exit 2 → 거부.
const fs = require('node:fs');
const { record } = require('./lib/audit');
const { matchProtected } = require('./lib/protected-patterns');

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return null; }
}

const file = readInput()?.tool_input?.file_path;
if (!file || typeof file !== 'string') process.exit(0);

const hit = matchProtected(file);
if (hit) {
  record({ hook: 'protected-file', action: 'blocked', reason: hit.why, file });
  process.stderr.write(
    `[devkit] 보호된 파일 편집 차단: ${hit.why}\n대상: ${file}\n` +
    `이 파일은 직접 편집 대신 사용자가 처리하거나, 필요하면 명시 허가를 받으세요.\n`
  );
  process.exit(2);
}
process.exit(0);
