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
const { readState, writeState, isActive, gatePrerequisite } = require(
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

// 4필드로 축소 — nextAction(PROGRESS에서 유도)·matchRates(behaviors.json)·docs(git)는 제거됨
const SAMPLE = {
  version: 1,
  cycleId: '2026-07-24-admin-filter',
  stage: 'design',
  status: 'awaiting-approval',
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

// ── D6: bkit 스키마 충돌 감지 ──────────────────────────
// bkit이 같이 설치되면 AI가 bkit 스키마(cycle/phase/gates)로 상태를 쓴다.
// "unknown → null"이 아니라 "foreign 명시"여야 훅이 경고를 띄울 수 있다.
test('readState: bkit 스키마(cycle/phase/gates)는 foreign 명시', () => {
  const root = makeRoot();
  writeRaw(root, JSON.stringify({
    cycle: '2026-07-24-cart-discount', phase: 'plan',
    gates: { planApproved: false },
  }));
  assert.deepEqual(readState(root), { foreign: 'bkit' });
});

test('readState: phase만 있어도 foreign', () => {
  const root = makeRoot();
  writeRaw(root, JSON.stringify({ phase: 'do' }));
  assert.deepEqual(readState(root), { foreign: 'bkit' });
});

test('readState: 우리 것은 4필드만 취한다(초과 필드 버림)', () => {
  const root = makeRoot();
  writeRaw(root, JSON.stringify({ ...SAMPLE, matchRates: [], docs: {}, nextAction: 'x' }));
  assert.deepEqual(readState(root), SAMPLE); // 4필드만
});

test('readState: 우리도 bkit도 아니면 null', () => {
  const root = makeRoot();
  writeRaw(root, JSON.stringify({ foo: 'bar' }));
  assert.equal(readState(root), null);
});

test('isActive: foreign이면 false (남의 사이클을 진행 중으로 오인 금지)', () => {
  assert.equal(isActive({ foreign: 'bkit' }), false);
});

// ── D5: behaviors.json 게이트 (소비 시점 차단) ──────────
test('gatePrerequisite: behaviors.json 있으면 통과', () => {
  const root = makeRoot();
  const cycleDir = path.join(root, 'docs', 'c');
  fs.mkdirSync(cycleDir, { recursive: true });
  fs.writeFileSync(path.join(cycleDir, 'behaviors.json'), '{"behaviors":[]}');
  const r = gatePrerequisite(cycleDir);
  assert.equal(r.ok, true);
});

test('gatePrerequisite: behaviors.json 없으면 거부 + 안내', () => {
  const root = makeRoot();
  const cycleDir = path.join(root, 'docs', 'c');
  fs.mkdirSync(cycleDir, { recursive: true });
  const r = gatePrerequisite(cycleDir);
  assert.equal(r.ok, false);
  assert.match(r.reason, /behaviors\.json|plan/i);
});
