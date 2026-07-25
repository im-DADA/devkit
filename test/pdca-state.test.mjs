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
const {
  readState, writeState, isActive, gatePrerequisite,
  matchCycleArtifact, isStateFile, validateStateWrite,
  STAGES, STATUSES, STAGE_REQUIREMENTS, MAKER,
} = require(path.join(dir, '..', 'hooks', 'lib', 'pdca-state.js'));

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

// ── 경로 분류 (게이트 트리거) ────────────────────────────
// 게이트는 상태 파일의 stage가 아니라 "쓰려는 경로"로 결정된다(상태 오염과 순환 회피).
// 정규식에서 벗어난 경로는 무조건 null = fail-open. 차단 반경을 여기서 좁힌다.
// 반환은 stage 하나뿐이다. cycleId·artifact는 프로덕션 호출자(pdca-gate.js)가 쓰지 않고,
// 커맨드는 마크다운이라 JS를 호출할 수 없어 앞으로도 쓸 일이 없다(YAGNI).
test('matchCycleArtifact: 사이클 산출물을 담당 stage로 분류', () => {
  assert.deepEqual(matchCycleArtifact('/x/docs/2026-07-25-review-gate/REPORT.md'), {
    stage: 'report',
  });
  assert.deepEqual(matchCycleArtifact('docs/2026-07-25-cart-discount/GAP.md'), { stage: 'gap' });
  // 같은 날 두 번째 사이클: slug에 숫자 접미 허용
  assert.equal(matchCycleArtifact('docs/2026-07-25-cart-discount-2/GAP.md')?.stage, 'gap');
  // Windows 구분자도 정규화 후 매치
  assert.equal(
    matchCycleArtifact('C:\\p\\docs\\2026-07-25-review-gate\\REPORT.md')?.stage,
    'report',
  );
});

test('matchCycleArtifact: 게이트 밖 경로는 null (오탐 방지)', () => {
  assert.equal(matchCycleArtifact('docs/REPORT.md'), null); // 사이클 폴더가 아니다
  assert.equal(matchCycleArtifact('docs/archive/2026-07-25/cart/REPORT.md'), null);
  assert.equal(matchCycleArtifact('docs/2026-07-25-Cart/REPORT.md'), null); // 대문자 slug
  assert.equal(matchCycleArtifact('docs/2026-07-25-cart/REVIEW.md'), null);
  assert.equal(matchCycleArtifact('docs/2026-07-25-cart/PLAN.md'), null);
  assert.equal(matchCycleArtifact('docs/2026-7-5-cart/REPORT.md'), null); // 날짜 자리수 미달
  assert.equal(matchCycleArtifact('notes/2026-07-25-cart/REPORT.md'), null); // docs/ 필수
});

test('isStateFile: .devkit/pdca-state.json만 true', () => {
  assert.equal(isStateFile('/p/.devkit/pdca-state.json'), true);
  assert.equal(isStateFile('.devkit/pdca-state.json'), true);
  assert.equal(isStateFile('.devkit/audit.jsonl'), false);
  assert.equal(isStateFile('pdca-state.json'), false); // .devkit 밖은 대상 아님
});

// ── 단계별 선행조건 (B8) ─────────────────────────────────
/** 사이클 폴더를 만들고 지정한 산출물만 채운다 */
function makeCycle(files) {
  const cycleDir = path.join(makeRoot(), 'docs', '2026-07-25-x');
  fs.mkdirSync(cycleDir, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(cycleDir, f), 'x');
  return cycleDir;
}

test('gatePrerequisite: 상수가 단계별 요구 산출물의 정본 (문서가 아니라 코드)', () => {
  assert.deepEqual(STAGE_REQUIREMENTS.gap, ['behaviors.json']);
  assert.deepEqual(STAGE_REQUIREMENTS.report, ['behaviors.json', 'GAP.md', 'REVIEW.md']);
  for (const f of STAGE_REQUIREMENTS.report) assert.ok(MAKER[f], `${f}의 생성 커맨드 안내 누락`);
});

test('gatePrerequisite: report는 3개 다 있으면 통과', () => {
  const r = gatePrerequisite(makeCycle(['behaviors.json', 'GAP.md', 'REVIEW.md']), 'report');
  assert.equal(r.ok, true);
});

test('gatePrerequisite: REVIEW.md만 없으면 그것만 지목 (D13)', () => {
  const r = gatePrerequisite(makeCycle(['behaviors.json', 'GAP.md']), 'report');
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['REVIEW.md']);
  assert.match(r.reason, /\/review/, '생성 커맨드 안내가 있어야 함');
  assert.doesNotMatch(r.reason, /behaviors\.json/, '있는 파일을 없다고 하면 안 됨');
});

test('gatePrerequisite: 없는 것만 STAGE_REQUIREMENTS 순서로 나열', () => {
  const r = gatePrerequisite(makeCycle(['REVIEW.md']), 'report');
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['behaviors.json', 'GAP.md']);
  assert.match(r.reason, /\/plan/);
  assert.match(r.reason, /\/gap/);
});

test('gatePrerequisite: 모르는 stage는 게이트 없음(통과)', () => {
  const r = gatePrerequisite(makeCycle([]), 'design');
  assert.equal(r.ok, true);
});

// 게이트가 "형식적 통과 의식"이 되는 가장 싼 우회는 빈 파일을 touch하는 것이다.
// 존재만 보면 0바이트 REVIEW.md로 REPORT 게이트가 열린다 — 내용이 없으면 없는 것으로 본다.
test('gatePrerequisite: 빈 파일(0바이트)은 없는 것으로 본다', () => {
  const cycleDir = makeCycle(['behaviors.json', 'GAP.md']);
  fs.writeFileSync(path.join(cycleDir, 'REVIEW.md'), '');
  const r = gatePrerequisite(cycleDir, 'report');
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['REVIEW.md']);
});

test('gatePrerequisite: 공백만 있는 파일도 없는 것으로 본다', () => {
  const cycleDir = makeCycle(['behaviors.json', 'GAP.md']);
  fs.writeFileSync(path.join(cycleDir, 'REVIEW.md'), '   \n\n\t');
  assert.deepEqual(gatePrerequisite(cycleDir, 'report').missing, ['REVIEW.md']);
});

test('gatePrerequisite: 멱등 — 두 번 불러도 파일시스템을 바꾸지 않고 같은 결과', () => {
  const cycleDir = makeCycle(['behaviors.json']);
  const before = fs.readdirSync(cycleDir);
  const a = gatePrerequisite(cycleDir, 'report');
  const b = gatePrerequisite(cycleDir, 'report');
  assert.deepEqual(a, b);
  assert.deepEqual(fs.readdirSync(cycleDir), before);
});

// ── 상태 파일 쓰기 검증 (B5·B6·B7) ───────────────────────
// enum의 정본은 커맨드 문서가 아니라 이 상수다(D8: 문서 참조 지시는 실행되지 않는다).
const OK_STATE = {
  version: 1, cycleId: '2026-07-25-x', stage: 'gap', status: 'in-progress',
};

test('validateStateWrite: enum 상수가 코드에 정본으로 있다', () => {
  assert.deepEqual(STAGES, ['plan', 'design', 'do', 'gap', 'review', 'report', 'done']);
  assert.deepEqual(STATUSES, ['in-progress', 'awaiting-approval', 'done']);
});

test('validateStateWrite: 정상 4필드는 통과 (순서 무관)', () => {
  assert.deepEqual(validateStateWrite(OK_STATE), { ok: true });
  // 키 순서를 바꿔도 같은 판정 — JSON 키 순서에 의존하면 오탐이 된다
  assert.equal(
    validateStateWrite({ status: 'done', stage: 'done', cycleId: '2026-07-25-x', version: 1 }).ok,
    true,
  );
});

test('validateStateWrite: stage·status 허용값 전부 통과', () => {
  for (const stage of STAGES) {
    assert.equal(validateStateWrite({ ...OK_STATE, stage }).ok, true, `stage:${stage}`);
  }
  for (const status of STATUSES) {
    assert.equal(validateStateWrite({ ...OK_STATE, status }).ok, true, `status:${status}`);
  }
});

test('validateStateWrite: 허용값 밖 status·stage는 거부 (D14)', () => {
  const s = validateStateWrite({ ...OK_STATE, status: 'complete' });
  assert.equal(s.ok, false);
  assert.match(s.reason, /complete/);
  assert.equal(validateStateWrite({ ...OK_STATE, stage: 'check' }).ok, false);
});

test('validateStateWrite: 4필드 밖 키는 거부 + 키 이름 명시 (D8)', () => {
  const r = validateStateWrite({ ...OK_STATE, slug: 'x', artifacts: {} });
  assert.equal(r.ok, false);
  assert.match(r.reason, /slug/);
  assert.match(r.reason, /artifacts/);
});

test('validateStateWrite: bkit 스키마는 거부 + bkit임을 알려준다 (D6)', () => {
  const r = validateStateWrite({
    cycle: '2026-07-25-x', phase: 'plan', gates: { planApproved: false },
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /bkit/);
});

test('validateStateWrite: version·cycleId 위반 거부', () => {
  assert.equal(validateStateWrite({ ...OK_STATE, version: 2 }).ok, false);
  assert.equal(validateStateWrite({ ...OK_STATE, cycleId: '' }).ok, false);
  const { cycleId, ...noCycleId } = OK_STATE;
  assert.equal(validateStateWrite(noCycleId).ok, false);
});

test('validateStateWrite: 누락 필드·비객체 거부', () => {
  const { status, ...noStatus } = OK_STATE;
  assert.equal(validateStateWrite(noStatus).ok, false);
  for (const bad of [null, undefined, [], 'x', 1]) {
    assert.equal(validateStateWrite(bad).ok, false, `거부해야 함: ${JSON.stringify(bad)}`);
  }
});

test('validateStateWrite: reason에 4필드 리터럴과 두 enum 전체가 있다 (즉시 재시도 가능)', () => {
  const r = validateStateWrite({ ...OK_STATE, status: 'complete', slug: 'x' });
  assert.equal(r.ok, false);
  assert.ok(r.problems.length >= 2, '위반 항목이 전부 나열돼야 함');
  for (const f of ['version', 'cycleId', 'stage', 'status']) assert.match(r.reason, new RegExp(f));
  for (const v of [...STAGES, ...STATUSES]) {
    assert.match(r.reason, new RegExp(v), `안내에 ${v} 누락`);
  }
});
