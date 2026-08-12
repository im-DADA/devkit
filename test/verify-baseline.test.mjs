// verify-baseline.js — 직전 실행의 진단 키 집합. IO 경계.
// (docs/2026-08-12-scoped-verification/ 결정 6 · B8·B21)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const { fingerprintOf, readBaseline, writeBaseline, BASELINE_MAX_KEYS } =
  createRequire(import.meta.url)(path.join(dir, '..', 'hooks', 'lib', 'verify-baseline.js'));

const tmpDirs = [];
function makeRoot(extra = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-baseline-'));
  tmpDirs.push(d);
  fs.writeFileSync(path.join(d, 'package.json'), '{"name":"t"}');
  for (const [rel, body] of Object.entries(extra)) fs.writeFileSync(path.join(d, rel), body);
  return d;
}
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

const META = { mode: 'direct-tsc', script: 'typecheck', runner: 'pnpm' };
const file = (root) => path.join(root, '.devkit', 'verify-baseline.json');

test('BL1: 쓰고 읽으면 키가 그대로 돌아온다', () => {
  const root = makeRoot();
  writeBaseline(root, 'typecheck', { fp: 'x', keys: ['k1', 'k2'], total: 2 });
  const b = readBaseline(root, 'typecheck', 'x');
  assert.deepEqual(b.keys, ['k1', 'k2']);
});

test('BL2: kind가 분리된다 — typecheck 갱신이 lint 키를 지우지 않는다 (B8)', () => {
  const root = makeRoot();
  writeBaseline(root, 'lint', { fp: 'f', keys: ['lint-1'], total: 1 });
  writeBaseline(root, 'typecheck', { fp: 'f', keys: ['tc-1'], total: 1 });
  assert.deepEqual(readBaseline(root, 'lint', 'f').keys, ['lint-1']);
  assert.deepEqual(readBaseline(root, 'typecheck', 'f').keys, ['tc-1']);
});

test('BL3: fingerprint가 다르면 baseline 없음으로 취급한다', () => {
  // 브랜치 전환·tsconfig 변경·mode 전환에서 기준선을 버리는 경로다.
  const root = makeRoot();
  writeBaseline(root, 'typecheck', { fp: 'branch=main', keys: ['k'], total: 1 });
  assert.equal(readBaseline(root, 'typecheck', 'branch=feature'), null);
  assert.ok(readBaseline(root, 'typecheck', 'branch=main'));
});

test('BL4: 파일이 깨졌으면 null (throw 없음)', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, '.devkit'), { recursive: true });
  fs.writeFileSync(file(root), '{깨진 JSON');
  assert.equal(readBaseline(root, 'typecheck', 'x'), null);
  assert.doesNotThrow(() => writeBaseline(root, 'typecheck', { fp: 'x', keys: [], total: 0 }));
});

test('BL5: 스키마 버전이 다르면 읽기 실패와 동일 취급', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, '.devkit'), { recursive: true });
  fs.writeFileSync(file(root), JSON.stringify({ schema: 'devkit-verify-baseline/99', kinds: { typecheck: { fp: 'x', keys: ['k'] } } }));
  assert.equal(readBaseline(root, 'typecheck', 'x'), null);
});

test('BL6: 상한을 넘으면 부분 저장하지 않고 overflow로 남긴다', () => {
  // 부분 저장은 "저장 안 된 키"와 "없어진 키"를 구분 불가하게 만들어 **거짓 new**를 낳는다.
  const root = makeRoot();
  const many = Array.from({ length: BASELINE_MAX_KEYS + 1 }, (_, i) => `k${i}`);
  writeBaseline(root, 'typecheck', { fp: 'x', keys: many, total: many.length });
  const raw = JSON.parse(fs.readFileSync(file(root), 'utf8'));
  assert.equal(raw.kinds.typecheck.overflow, true);
  assert.equal(raw.kinds.typecheck.keys, undefined, '부분 저장 금지');
  assert.equal(readBaseline(root, 'typecheck', 'x'), null, 'overflow는 baseline 없음과 동일');
});

test('BL7: fingerprint가 브랜치·mode·script·runner·설정 변화를 반영한다', () => {
  const root = makeRoot({ 'tsconfig.json': '{}' });
  const base = fingerprintOf(root, META, 'main');
  assert.notEqual(base, fingerprintOf(root, META, 'feature'), '브랜치');
  assert.notEqual(base, fingerprintOf(root, { ...META, mode: 'script' }, 'main'), 'mode');
  assert.notEqual(base, fingerprintOf(root, { ...META, runner: 'npm' }, 'main'), 'runner');
  assert.equal(base, fingerprintOf(root, META, 'main'), '같은 조건이면 같아야 함(결정적)');

  // tsconfig가 바뀌면 지형이 바뀐 것이다 — 기준선을 버린다
  fs.writeFileSync(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}');
  assert.notEqual(base, fingerprintOf(root, META, 'main'), 'tsconfig 변경');
});

test('BL8: 쓰기가 원자적이다 — 임시 파일이 남지 않는다', () => {
  const root = makeRoot();
  writeBaseline(root, 'typecheck', { fp: 'x', keys: ['k'], total: 1 });
  const left = fs.readdirSync(path.join(root, '.devkit')).filter((f) => f.includes('.tmp'));
  assert.deepEqual(left, []);
});

test('BL9: 쓸 수 없는 경로여도 throw하지 않는다 (fail-open)', () => {
  assert.doesNotThrow(() => writeBaseline('/proc/nope-devkit', 'typecheck', { fp: 'x', keys: [], total: 0 }));
  assert.equal(readBaseline('/proc/nope-devkit', 'typecheck', 'x'), null);
});

test('BL10: notice 상태를 같은 파일에 실어 파일 수를 더 늘리지 않는다', () => {
  const root = makeRoot();
  writeBaseline(root, 'typecheck', { fp: 'x', keys: [], total: 0, notice: { key: 's1', kinds: ['typecheck'] } });
  assert.deepEqual(readBaseline(root, 'typecheck', 'x').notice, { key: 's1', kinds: ['typecheck'] });
});
