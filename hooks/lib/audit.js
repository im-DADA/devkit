// devkit 관측성 — 가드 훅의 차단/이벤트를 프로젝트 `.devkit/audit.jsonl`에 append(JSONL).
// 관측성 기록이 훅 자체를 죽이면 안 되므로, 실패 시 stderr에 남기고 계속한다(swallow 아님, degrade).
const fs = require('node:fs');
const path = require('node:path');
const { findProjectRoot } = require('./project-root');

function record(event) {
  try {
    const root = findProjectRoot(process.cwd());
    const dir = path.join(root, '.devkit');
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n';
    fs.appendFileSync(path.join(dir, 'audit.jsonl'), line);
  } catch (e) {
    process.stderr.write(`[devkit] audit 기록 실패: ${e.message}\n`);
  }
}

module.exports = { record };
