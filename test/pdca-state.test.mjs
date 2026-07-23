// PDCA 상태 파일 read/write 계약 — 상태를 못 읽어도 훅이 죽으면 안 되므로
// "실패는 null로 degrade"가 핵심 계약이다. 레포 오염 방지를 위해 tmp에 격리.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { readState, writeState, isActive } = require(
  path.join(dir, '..', 'hooks', 'lib', 'pdca-state.js'),
);

const tmpDirs = [];
function makeRoot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-pdca-'));
  tmpDirs.push(d);
  return d;
}
function writeRaw(root, content) {
  const dir = path.join(root, '.devkit');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pdca-state.json'), content);
}

after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

const SAMPLE = {
  version: 1,
  cycleId: '2026-07-23-어드민-필터',
  stage: 'design',
  status: 'awaiting-approval',
  nextAction: 'DESIGN.md 승인 대기',
  matchRates: [],
  docs: { 'PLAN.md': '2026-07-23T00:00:00.000Z' },
};

test('readState: 파일 없으면 null (throw 안 함)', () => {
  assert.equal(readState(makeRoot()), null);
});

test('readState: 깨진 JSON이면 null', () => {
  const root = makeRoot();
  writeRaw(root, '{ 이건 JSON이 아님');
  assert.equal(readState(root), null);
});

test('readState: 모르는 version이면 null (전방호환)', () => {
  const root = makeRoot();
  writeRaw(root, JSON.stringify({ ...SAMPLE, version: 2 }));
  assert.equal(readState(root), null);
});

test('writeState → readState 왕복이 동일 객체', () => {
  const root = makeRoot();
  writeState(root, SAMPLE);
  assert.deepEqual(readState(root), SAMPLE);
});

test('writeState: .devkit 폴더가 없어도 생성해서 저장', () => {
  const root = makeRoot();
  assert.equal(fs.existsSync(path.join(root, '.devkit')), false);
  writeState(root, SAMPLE);
  assert.ok(fs.existsSync(path.join(root, '.devkit', 'pdca-state.json')));
});

test('isActive: done이면 false, 진행 중이면 true, null이면 false', () => {
  assert.equal(isActive(null), false);
  assert.equal(isActive({ ...SAMPLE, stage: 'done' }), false);
  assert.equal(isActive(SAMPLE), true);
});
