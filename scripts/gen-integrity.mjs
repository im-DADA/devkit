// 훅/스크립트 무결성 매니페스트 생성 — 훅을 수정한 뒤 실행해 INTEGRITY.sha256을 갱신한다.
// 실행: node scripts/gen-integrity.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_DIRS = ['hooks', 'scripts'];

function walk(dir) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    return e.isDirectory() ? walk(rel) : rel.endsWith('.js') || rel.endsWith('.mjs') ? [rel] : [];
  });
}

const files = TARGET_DIRS.flatMap(walk).sort();
const lines = files.map((f) => {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex');
  return `${hash}  ${f}`;
});
fs.writeFileSync(path.join(root, 'INTEGRITY.sha256'), lines.join('\n') + '\n');
console.log(`INTEGRITY.sha256 갱신: ${files.length}개 파일`);
