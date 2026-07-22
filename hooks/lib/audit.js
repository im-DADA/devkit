// devkit 관측성 — 가드 훅의 차단/이벤트를 프로젝트 `.devkit/audit.jsonl`에 append(JSONL).
// 관측성 기록이 훅 자체를 죽이면 안 되므로, 실패 시 stderr에 남기고 계속한다(swallow 아님, degrade).
const fs = require('node:fs');
const path = require('node:path');

// process.cwd()는 명령 실행 위치라 하위 폴더에서 명령을 돌리면 거기에 .devkit이 생긴다.
// 프로젝트 루트(.git 또는 package.json이 있는 가장 가까운 상위)를 찾아 거기 하나로 모은다.
function findProjectRoot(start) {
  let dir = start;
  while (true) {
    if (
      fs.existsSync(path.join(dir, '.git')) ||
      fs.existsSync(path.join(dir, 'package.json'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return start; // 루트까지 못 찾으면 원래 위치
    dir = parent;
  }
}

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
