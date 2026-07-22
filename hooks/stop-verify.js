#!/usr/bin/env node
// Stop: 턴 종료 시 프로젝트에 typecheck/lint 스크립트가 있으면 1회 실행하고 실패를 컨텍스트로 표면화 (비차단).
// 노이즈 있으면 hooks.json에서 이 훅만 빼면 됨.
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { record } = require('./lib/audit');

function findPkg(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 6; i++) {
    const p = path.join(dir, 'package.json');
    if (fs.existsSync(p)) return p;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const pkgPath = findPkg(process.cwd());
if (!pkgPath) process.exit(0);

let scripts = {};
try { scripts = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).scripts || {}; } catch { process.exit(0); }

const root = path.dirname(pkgPath);
const toRun = ['typecheck', 'lint'].filter((s) => scripts[s]);
if (!toRun.length) process.exit(0);

const problems = [];
for (const s of toRun) {
  try {
    execSync(`npm run -s ${s}`, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`.trim().split('\n').slice(-20).join('\n');
    problems.push(`### npm run ${s} 실패\n${out}`);
    record({ hook: 'stop-verify', action: 'verify-fail', script: s });
  }
}

if (problems.length) {
  process.stdout.write(`[devkit] 종료 전 검증 실패 — 고쳐야 함:\n\n${problems.join('\n\n')}\n`);
}
process.exit(0);
