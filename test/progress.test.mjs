// PROGRESS.md 재개 파서 — 컴팩션·세션 종료 후 "어디까지 했나"를 복구하는 저널.
// 게이트가 아니라 재개 시 읽히는 것. 파서는 관대하되 정체성 앵커(첫 줄)만 엄격하다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { identityAnchor, tail } = require(path.join(dir, '..', 'hooks', 'lib', 'progress.js'));

const tmpDirs = [];
function makeCycle(content) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-progress-'));
  tmpDirs.push(d);
  if (content !== undefined) fs.writeFileSync(path.join(d, 'PROGRESS.md'), content);
  return d;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

const SAMPLE = `# PROGRESS — docs/2026-07-24-hook-enforcement/

- 2026-07-24 plan: PLAN.md + behaviors.json 작성
- 2026-07-24 design: DESIGN.md 작성
- 2026-07-24 do: B5·B6 구현
`;

test('identityAnchor: 첫 줄에서 cycle 경로를 추출', () => {
  assert.equal(identityAnchor(makeCycle(SAMPLE)), 'docs/2026-07-24-hook-enforcement/');
});

test('identityAnchor: 파일 없으면 null', () => {
  assert.equal(identityAnchor(makeCycle()), null);
});

test('identityAnchor: 앵커 형식이 아니면 null (오독 방지)', () => {
  assert.equal(identityAnchor(makeCycle('아무 텍스트\n- 로그')), null);
});

test('tail: 끝 N줄을 반환(앵커·빈 줄 제외)', () => {
  const lines = tail(makeCycle(SAMPLE), 2);
  assert.deepEqual(lines, [
    '- 2026-07-24 design: DESIGN.md 작성',
    '- 2026-07-24 do: B5·B6 구현',
  ]);
});

test('tail: 요청보다 로그가 적으면 있는 만큼만', () => {
  const lines = tail(makeCycle(SAMPLE), 10);
  assert.equal(lines.length, 3);
});

test('tail: 파일 없으면 빈 배열 (throw 안 함)', () => {
  assert.deepEqual(tail(makeCycle(), 10), []);
});

test('tail: 기본값 10', () => {
  assert.equal(typeof tail, 'function');
  const lines = tail(makeCycle(SAMPLE));
  assert.equal(lines.length, 3); // 3줄뿐이라 10 이하
});
