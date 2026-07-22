#!/usr/bin/env node
// PreToolUse(Write|Edit): 편집 내용에 명백한 시크릿이 있으면 차단(exit 2). 의심 패턴은 관측(warn)만.
const fs = require('node:fs');
const { record } = require('./lib/audit');
const { scanHigh, scanSuspect } = require('./lib/secret-patterns');

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return null; }
}

const input = readInput();
const ti = input?.tool_input || {};
// Write=content, Edit=new_string
const content = typeof ti.content === 'string' ? ti.content
  : typeof ti.new_string === 'string' ? ti.new_string : '';
if (!content) process.exit(0);
const file = ti.file_path;

const high = scanHigh(content);
if (high.length) {
  record({ hook: 'secret-guard', action: 'blocked', reason: high.join(', '), file });
  process.stderr.write(
    `[devkit] 시크릿 감지 → 편집 차단: ${high.join(', ')}\n대상: ${file}\n` +
    `키를 코드에 넣지 말고 환경변수(.env, 미커밋)나 시크릿 매니저로 옮기세요.\n`
  );
  process.exit(2);
}

const suspect = scanSuspect(content);
if (suspect.length) {
  record({ hook: 'secret-guard', action: 'warn', reason: suspect.join(', '), file });
}
process.exit(0);
