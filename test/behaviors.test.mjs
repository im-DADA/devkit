// behaviors.json 검증 계약 — 이 파일이 Match Rate 인플레이션을 막는 핵심이다.
// 핵심 불변식: evidence(실행 흔적)가 없으면 passes:true여도 통과로 세지 않는다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { readBehaviors, isEvidenceValid, effectivePasses, summarize } = require(
  path.join(dir, '..', 'hooks', 'lib', 'behaviors.js'),
);

const tmpDirs = [];
function makeCycle(content) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-behaviors-'));
  tmpDirs.push(d);
  if (content !== undefined) {
    fs.writeFileSync(path.join(d, 'behaviors.json'), content);
  }
  return d;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

const validEvidence = {
  kind: 'test',
  ref: 'test/discount.test.ts:42',
  cmd: 'node --test test/discount.test.ts',
  output: '✔ 경계값 100,000원에서 할인 적용 (2.1ms)',
  at: '2026-07-24T00:00:00.000Z',
};

// ── evidence 검증 ──

test('isEvidenceValid: 정상 evidence는 통과', () => {
  assert.equal(isEvidenceValid(validEvidence), true);
});

test('isEvidenceValid: null·undefined는 거부', () => {
  assert.equal(isEvidenceValid(null), false);
  assert.equal(isEvidenceValid(undefined), false);
});

test('isEvidenceValid: 모르는 kind는 거부', () => {
  assert.equal(isEvidenceValid({ ...validEvidence, kind: 'vibes' }), false);
});

test('isEvidenceValid: 3종 kind(test/visual/manual)는 허용', () => {
  for (const kind of ['test', 'visual', 'manual']) {
    assert.equal(isEvidenceValid({ ...validEvidence, kind }), true, kind);
  }
});

test('isEvidenceValid: ref가 비면 거부', () => {
  assert.equal(isEvidenceValid({ ...validEvidence, ref: '' }), false);
  assert.equal(isEvidenceValid({ ...validEvidence, ref: '   ' }), false);
});

test('isEvidenceValid: output이 없거나 너무 짧으면 거부 — 실행 흔적이 핵심', () => {
  assert.equal(isEvidenceValid({ ...validEvidence, output: '' }), false);
  assert.equal(isEvidenceValid({ ...validEvidence, output: '통과' }), false);
  assert.equal(isEvidenceValid({ ...validEvidence, output: undefined }), false);
});

// ── 자동 강등 (인플레이션 차단) ──

test('effectivePasses: passes:true인데 evidence 없으면 false로 강등', () => {
  assert.equal(effectivePasses({ id: 'B1', passes: true, evidence: null }), false);
});

test('effectivePasses: passes:true + 정상 evidence면 true', () => {
  assert.equal(effectivePasses({ id: 'B1', passes: true, evidence: validEvidence }), true);
});

test('effectivePasses: passes:false면 evidence가 있어도 false', () => {
  assert.equal(effectivePasses({ id: 'B1', passes: false, evidence: validEvidence }), false);
});

// ── 집계 ──

test('summarize: unproven(증거 없는 통과 주장)을 따로 센다', () => {
  const doc = {
    behaviors: [
      { id: 'B1', passes: true, evidence: validEvidence },
      { id: 'B2', passes: true, evidence: null }, // 주장만 있고 증거 없음
      { id: 'B3', passes: false, evidence: null },
    ],
  };
  const s = summarize(doc);
  assert.equal(s.total, 3);
  assert.equal(s.passed, 1, '증거 있는 것만 통과');
  assert.equal(s.unproven, 1, 'B2가 unproven');
});

test('summarize: unproven이 0이어야 게이트 통과 — matchRate는 신호일 뿐', () => {
  const clean = {
    behaviors: [{ id: 'B1', passes: true, evidence: validEvidence }],
  };
  const s = summarize(clean);
  assert.equal(s.unproven, 0);
  assert.equal(s.matchRate, 100);
});

test('summarize: 빈 목록에서 0으로 나누지 않는다', () => {
  const s = summarize({ behaviors: [] });
  assert.equal(s.total, 0);
  assert.equal(s.matchRate, 0);
});

// ── 파일 읽기 (degrade 계약) ──

test('readBehaviors: 파일 없으면 null (throw 안 함)', () => {
  assert.equal(readBehaviors(makeCycle()), null);
});

test('readBehaviors: 깨진 JSON이면 null', () => {
  assert.equal(readBehaviors(makeCycle('{ 이건 JSON이')), null);
});

test('readBehaviors: behaviors가 배열이 아니면 null', () => {
  assert.equal(readBehaviors(makeCycle('{"behaviors": "nope"}')), null);
});

test('readBehaviors: 정상 파일은 파싱해서 반환', () => {
  const doc = { version: 1, cycleId: 'x', behaviors: [{ id: 'B1', passes: false }] };
  const got = readBehaviors(makeCycle(JSON.stringify(doc)));
  assert.equal(got.behaviors.length, 1);
  assert.equal(got.behaviors[0].id, 'B1');
});

// ── B5: unresolved 집계 (unproven과 별도 축) ──
// unproven은 "증거를 안 냈다", unresolved는 "낸 증거가 가리키는 파일이 없다".
// 둘을 한 필드로 합치면 "왜 막혔는지"를 구분할 수 없다.
const forgedEvidence = { ...validEvidence, ref: 'nope/ghost.test.mjs:1' };

test('B5: root 없이 호출하면 기존 동작 불변 + unresolved는 null', () => {
  const doc = {
    behaviors: [
      { id: 'B1', passes: true, evidence: validEvidence },
      { id: 'B2', passes: true, evidence: null },
      { id: 'B3', passes: false, evidence: null },
    ],
  };
  const s = summarize(doc);
  assert.deepEqual(
    { total: s.total, passed: s.passed, unproven: s.unproven, matchRate: s.matchRate },
    { total: 3, passed: 1, unproven: 1, matchRate: 33 },
    '기존 호출자(session-start 등)의 결과가 바뀌면 회귀다',
  );
  assert.equal(s.unresolved, null, '판정 불가는 0이 아니라 null — 0은 "검사했고 깨끗하다"는 뜻이다');
});

test('B5: root를 주면 unresolved를 세고, unproven은 그대로다', () => {
  const root = makeCycle();
  const doc = {
    behaviors: [
      { id: 'B1', passes: true, evidence: forgedEvidence }, // 증거는 있는데 파일이 없다
      { id: 'B2', passes: true, evidence: null },           // 증거 자체가 없다
      { id: 'B3', passes: false, evidence: forgedEvidence },// 작업 중 — 세지 않는다
    ],
  };
  const s = summarize(doc, { root });
  assert.equal(s.unresolved, 1, 'B1만 unresolved');
  assert.equal(s.unproven, 1, 'unproven의 의미는 한 글자도 바뀌지 않는다');
  assert.equal(s.passed, 1, 'unresolved라도 passed 집계 방식은 그대로');
});
