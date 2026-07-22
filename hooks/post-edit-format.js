#!/usr/bin/env node
// PostToolUse(Write|Edit): 방금 편집된 파일 1개를 prettier로 포맷 (프로젝트에 있을 때만). 파일 단위라 빠름.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return null; }
}

const file = readInput()?.tool_input?.file_path;
if (!file || !/\.(ts|tsx|js|jsx|mjs|cjs|json|css|scss|md)$/.test(file)) process.exit(0);
if (!fs.existsSync(file)) process.exit(0);

function findBin(startDir, bin) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 6; i++) {
    const p = path.join(dir, 'node_modules', '.bin', bin);
    if (fs.existsSync(p)) return p;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const prettier = findBin(path.dirname(file), 'prettier');
if (!prettier) process.exit(0); // 프로젝트에 prettier 없으면 아무것도 안 함

try {
  execFileSync(prettier, ['--write', file], { stdio: 'ignore' });
} catch (e) {
  // 포맷 실패(문법 오류 등)는 삼키지 않고 표면화. 세션은 계속.
  process.stdout.write(`[devkit] prettier 포맷 실패: ${file} — ${e.message}\n`);
}
process.exit(0);
