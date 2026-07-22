// 훅/스크립트 무결성 검증 — INTEGRITY.sha256과 현재 파일 해시를 대조한다.
// 공급망 변조 "조기 발견"용이지 서명이 아니다(매니페스트 자체를 바꾸면 우회 가능).
// 신뢰된 커밋/태그에서 설치 직후 실행하는 것이 전제. 실행: node scripts/verify-integrity.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'INTEGRITY.sha256');
if (!fs.existsSync(manifestPath)) {
  console.error('INTEGRITY.sha256 없음 — `node scripts/gen-integrity.mjs`로 먼저 생성하세요.');
  process.exit(2);
}

const expected = new Map(
  fs.readFileSync(manifestPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => {
    const [hash, ...rest] = l.trim().split(/\s+/);
    return [rest.join(' '), hash];
  }),
);

const problems = [];
for (const [file, hash] of expected) {
  const abs = path.join(root, file);
  if (!fs.existsSync(abs)) { problems.push(`삭제됨: ${file}`); continue; }
  const actual = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
  if (actual !== hash) problems.push(`변조/변경: ${file}`);
}

if (problems.length) {
  console.error(`[devkit] 무결성 검증 실패 (${problems.length}):\n  ${problems.join('\n  ')}`);
  console.error('의도한 변경이면 `node scripts/gen-integrity.mjs`로 매니페스트를 갱신하세요.');
  process.exit(1);
}
console.log(`[devkit] 무결성 OK — ${expected.size}개 파일 일치.`);
