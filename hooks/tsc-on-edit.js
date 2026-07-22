#!/usr/bin/env node
// PostToolUse(Write|Edit): .ts/.tsx 편집 직후 tsc로 즉시 타입체크 (비차단, 에러만 표면화).
// 기본 OFF — 매 편집마다 tsc는 느릴 수 있어 opt-in. 켜려면: export DEVKIT_TSC_ON_EDIT=1
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

if (process.env.DEVKIT_TSC_ON_EDIT !== '1') process.exit(0);

const file = readInput()?.tool_input?.file_path;
if (!file || !/\.(ts|tsx)$/.test(file)) process.exit(0);

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return null; }
}

function findUp(startDir, name) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, name))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const projectDir = findUp(path.dirname(file), 'tsconfig.json');
if (!projectDir) process.exit(0);
const tsc = path.join(projectDir, 'node_modules', '.bin', 'tsc');
if (!fs.existsSync(tsc)) process.exit(0);

try {
  execFileSync(tsc, ['--noEmit', '--pretty', 'false'], { cwd: projectDir, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
} catch (e) {
  const out = `${e.stdout || ''}${e.stderr || ''}`.trim().split('\n').slice(0, 15).join('\n');
  if (out) process.stdout.write(`[devkit] tsc 타입 에러:\n${out}\n`);
}
process.exit(0);
