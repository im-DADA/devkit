// pdca-gate 훅 본체의 프로세스 계약.
// 이 훅은 파일 쓰기를 실제로 막는다(exit 2) — 그래서 가장 중요한 불변식은
// "판정할 수 없으면 통과시킨다"다. 훅 자체의 오류가 작업 차단으로 이어지면 안 된다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const hook = path.join(dir, '..', 'hooks', 'pdca-gate.js');

const tmpDirs = [];
function makeRoot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-gate-'));
  fs.writeFileSync(path.join(d, 'package.json'), '{}'); // 프로젝트 루트 표식
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

/** 훅을 실행해 { code, stderr } 반환 */
function run(input) {
  try {
    const r = execFileSync('node', [hook], {
      input: typeof input === 'string' ? input : JSON.stringify(input),
      cwd: os.tmpdir(),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, stderr: '', stdout: r };
  } catch (e) {
    return { code: e.status ?? 1, stderr: e.stderr ?? '', stdout: e.stdout ?? '' };
  }
}

/** 사이클 폴더를 만들고 지정한 산출물만 채운다. 반환값은 사이클 폴더 절대경로 */
function makeCycleDir(files, cycleId = '2026-07-25-review-gate') {
  const root = makeRoot();
  const cycleDir = path.join(root, 'docs', cycleId);
  fs.mkdirSync(cycleDir, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(cycleDir, f), 'x');
  return cycleDir;
}

/** 사이클 폴더 안의 산출물을 Write하려는 시도 */
function writeArtifact(cycleDir, name) {
  return run({
    tool_name: 'Write',
    cwd: path.resolve(cycleDir, '..', '..'),
    tool_input: { file_path: path.join(cycleDir, name), content: '# x\n' },
  });
}

// ── B11: 비차단 불변식 (최우선) ──────────────────────────
test('비차단 불변식: 판정 불가 입력에는 절대 차단하지 않는다(exit 0)', () => {
  const badInputs = [
    '{깨진 JSON',                              // stdin 파싱 실패
    '',                                        // 빈 입력
    '{}',                                      // tool_input 없음
    JSON.stringify({ tool_input: {} }),        // file_path 없음
    JSON.stringify({ tool_input: { file_path: 123 } }), // file_path 비문자열
    JSON.stringify({ tool_input: { file_path: null } }),
  ];
  for (const bad of badInputs) {
    const { code } = run(bad);
    assert.equal(code, 0, `exit 0이어야 함: ${bad.slice(0, 40)}`);
  }
});

// ── B1·B3: 선행조건 미충족이면 산출물 쓰기를 막는다 ────────
test('B1: REVIEW.md 없이 REPORT.md를 쓰면 차단 + 생성 커맨드 안내', () => {
  const cycleDir = makeCycleDir(['behaviors.json', 'GAP.md']);
  const { code, stderr } = writeArtifact(cycleDir, 'REPORT.md');
  assert.equal(code, 2);
  assert.match(stderr, /REVIEW\.md/);
  assert.match(stderr, /\/review/, '무엇으로 만드는지 알려줘야 재시도할 수 있다');
  assert.match(stderr, new RegExp(`대상: .*${path.sep}REPORT\\.md`), '대상 파일 표기 누락');
});

test('B3: 없는 것만 정확히 지목한다(있는 파일을 없다고 하지 않음)', () => {
  const only = writeArtifact(makeCycleDir(['REVIEW.md']), 'REPORT.md');
  assert.equal(only.code, 2);
  assert.match(only.stderr, /behaviors\.json/);
  assert.match(only.stderr, /GAP\.md/);
  assert.doesNotMatch(only.stderr, /REVIEW\.md/);
});

// gap 단계 게이트에 프로덕션 호출자가 없으면 그 분기는 테스트만 통과하는 데드코드가 된다(D12).
test('B8: GAP.md 쓰기는 behaviors.json을 요구한다', () => {
  const { code, stderr } = writeArtifact(makeCycleDir([]), 'GAP.md');
  assert.equal(code, 2);
  assert.match(stderr, /behaviors\.json/);
  assert.match(stderr, /\/plan/);
});

// ── B2·B4: 오탐 반경 제한 ────────────────────────────────
test('B2: 3개 선행 산출물이 다 있으면 REPORT.md 쓰기 통과', () => {
  const cycleDir = makeCycleDir(['behaviors.json', 'GAP.md', 'REVIEW.md']);
  assert.equal(writeArtifact(cycleDir, 'REPORT.md').code, 0);
});

test('B4: 사이클 폴더 밖·규약 밖 경로는 게이트 미적용', () => {
  const root = makeRoot();
  const cases = [
    path.join(root, 'docs', 'REPORT.md'),                              // 사이클 폴더 아님
    path.join(root, 'docs', 'archive', '2026-07-25', 'cart', 'REPORT.md'),
    path.join(root, 'docs', '2026-07-25-Cart', 'REPORT.md'),           // 대문자 slug
    path.join(root, 'notes', '2026-07-25-cart', 'REPORT.md'),
    path.join(root, 'src', 'app.ts'),
  ];
  for (const file of cases) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const { code } = run({ tool_name: 'Write', cwd: root, tool_input: { file_path: file, content: 'x' } });
    assert.equal(code, 0, `게이트 밖이어야 함: ${file}`);
  }
});

// 게이트 표면 최소화 — gap 전에 리뷰를 먼저 돌리는 정당한 순서를 막으면 게이트가 작업을 방해한다.
test('B4: REVIEW.md·PLAN.md·behaviors.json은 게이트하지 않는다', () => {
  const cycleDir = makeCycleDir([]);
  for (const name of ['REVIEW.md', 'PLAN.md', 'DESIGN.md', 'PROGRESS.md', 'behaviors.json']) {
    assert.equal(writeArtifact(cycleDir, name).code, 0, `게이트 밖이어야 함: ${name}`);
  }
});

// 계약 변경(REVIEW 🟡2): 예전엔 "사이클 폴더가 없으면 통과"였는데, Write가 부모 디렉터리를
// 자동 생성하므로 "폴더를 만들지 않고 바로 REPORT.md를 쓴다" 한 수로 게이트 전체가 뚫렸다.
// fail-open의 원래 목적은 상대경로를 cwd로 잘못 해석했을 때의 오탐 방어다 —
// Write 도구는 절대경로를 요구하므로 그 목적은 상대경로에만 남기고 절대경로는 게이트한다.
test('절대경로면 사이클 폴더가 없어도 게이트한다(선행 산출물 0개 → 차단)', () => {
  const root = makeRoot();
  const file = path.join(root, 'docs', '2026-07-25-not-created', 'REPORT.md');
  const { code, stderr } = run({ tool_name: 'Write', cwd: root, tool_input: { file_path: file, content: 'x' } });
  assert.equal(code, 2, '폴더 부재 = 선행 산출물 100% 부재다 — 가장 강하게 막아야 할 케이스');
  assert.match(stderr, /behaviors\.json/);
  assert.match(stderr, /REVIEW\.md/);
});

test('상대경로는 사이클 폴더가 없으면 통과(cwd 오해석 오탐 방어는 여기에만 남는다)', () => {
  const root = makeRoot(); // docs/ 자체가 없다 = cwd를 잘못 잡았을 때와 구분되지 않는 상황
  const { code } = run({
    tool_name: 'Write',
    cwd: root,
    tool_input: { file_path: 'docs/2026-07-25-not-created/REPORT.md', content: 'x' },
  });
  assert.equal(code, 0, '상대경로는 cwd 해석이 틀렸을 수 있다 — 오탐이 차단보다 비싸다');
});

// ── B5·B6·B7: 상태 파일 스키마 강제 ──────────────────────
const OK_STATE = { version: 1, cycleId: '2026-07-25-x', stage: 'gap', status: 'in-progress' };

/** Write로 상태 파일 전문을 쓰는 시도 */
function stateWrite(content) {
  const root = makeRoot();
  return run({
    tool_name: 'Write',
    cwd: root,
    tool_input: {
      file_path: path.join(root, '.devkit', 'pdca-state.json'),
      content: typeof content === 'string' ? content : JSON.stringify(content),
    },
  });
}
/** Edit로 상태 파일 일부/전문을 바꾸는 시도 */
function stateEdit(newString) {
  const root = makeRoot();
  return run({
    tool_name: 'Edit',
    cwd: root,
    tool_input: {
      file_path: path.join(root, '.devkit', 'pdca-state.json'),
      old_string: 'x',
      new_string: newString,
    },
  });
}

test('B5: 4필드 밖 키를 쓰면 차단 + 정확한 형식 안내 (D8)', () => {
  const { code, stderr } = stateWrite({ ...OK_STATE, slug: 'x', artifacts: {} });
  assert.equal(code, 2);
  assert.match(stderr, /slug/);
  assert.match(stderr, /artifacts/);
  for (const f of ['version', 'cycleId', 'stage', 'status']) {
    assert.match(stderr, new RegExp(f), `안내에 ${f} 누락 — 그대로 재시도할 수 있어야 한다`);
  }
});

test('B5: bkit 스키마를 쓰면 차단 + bkit임을 알려준다 (D6)', () => {
  const { code, stderr } = stateWrite({ cycle: '2026-07-25-x', phase: 'plan', gates: {} });
  assert.equal(code, 2);
  assert.match(stderr, /bkit/);
});

test('B6: 허용값 밖 status·stage는 차단 (D14)', () => {
  assert.equal(stateWrite({ ...OK_STATE, status: 'complete' }).code, 2);
  assert.equal(stateWrite({ ...OK_STATE, stage: 'check' }).code, 2);
});

test('B7: 정상 4필드는 통과', () => {
  assert.equal(stateWrite(OK_STATE).code, 0);
  assert.equal(stateWrite({ ...OK_STATE, stage: 'plan', status: 'awaiting-approval' }).code, 0);
  assert.equal(stateWrite({ ...OK_STATE, stage: 'review' }).code, 0);
  assert.equal(stateWrite({ ...OK_STATE, stage: 'done', status: 'done' }).code, 0);
});

test('Edit 조각(파싱 불가)은 판정하지 않고 통과 — 오탐이 차단보다 비싸다', () => {
  assert.equal(stateEdit('"status": "done"').code, 0);
  assert.equal(stateEdit('').code, 0);
});

test('Edit로 전문을 갈아끼우면 스키마를 강제한다', () => {
  assert.equal(stateEdit(JSON.stringify({ ...OK_STATE, status: 'complete' })).code, 2);
  assert.equal(stateEdit(JSON.stringify(OK_STATE)).code, 0);
});

test('content가 없으면 판정하지 않고 통과', () => {
  const root = makeRoot();
  const { code } = run({
    tool_name: 'Write',
    cwd: root,
    tool_input: { file_path: path.join(root, '.devkit', 'pdca-state.json') },
  });
  assert.equal(code, 0);
});

// 훅이 hooks.json에 등록되지 않으면 위 계약은 전부 도는데 아무도 부르지 않는 코드가 된다.
test('hooks.json의 PreToolUse(Write|Edit)에 pdca-gate가 등록돼 있다', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '..', 'hooks', 'hooks.json'), 'utf8'));
  const group = cfg.hooks.PreToolUse.find((g) => g.matcher === 'Write|Edit');
  assert.ok(group, 'Write|Edit matcher 그룹이 있어야 함');
  const entry = group.hooks.find((h) => h.command.includes('pdca-gate.js'));
  assert.ok(entry, 'pdca-gate.js 미등록');
  assert.equal(entry.timeout, 5000);
});
