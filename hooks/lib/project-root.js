// 프로젝트 루트 탐색 — 여러 훅이 같은 규칙으로 `.devkit/` 위치를 정해야 하므로 여기 하나로 둔다.
// process.cwd()는 명령 실행 위치라 하위 폴더에서 돌리면 거기에 .devkit이 생긴다.
// .git 또는 package.json이 있는 가장 가까운 상위를 프로젝트 루트로 본다.
const fs = require('node:fs');
const path = require('node:path');

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

module.exports = { findProjectRoot };
