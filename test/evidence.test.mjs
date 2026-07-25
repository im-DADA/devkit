// evidence ref 검증 계약 — "실행 흔적이 실제로 존재하는가"를 판정한다.
// 가장 중요한 불변식: 정직한 evidence를 막지 않는다(오탐 > 미탐). 그래서 파서의
// 기대값은 추측이 아니라 아카이브 behaviors.json에서 실측한 형식 그대로다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(dir, '..');
const require = createRequire(import.meta.url);
const { parseRefPaths, classifyRef, gateEvidence } = require(path.join(repoRoot, 'hooks', 'lib', 'evidence.js'));

const tmpDirs = [];
function makeRoot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-evidence-'));
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

// ── B1: 실측 ref 형식 전수 파싱 ──────────────────────────
// 출처: docs/archive/2026-07-25/review-gate-permissions/behaviors.json (14건)
//       docs/archive/2026-07-24/hook-enforcement/behaviors.json (9건)
const REF_CASES = [
  ['test/pdca-gate.test.mjs:76',
    [{ path: 'test/pdca-gate.test.mjs', line: 76, endLine: null }]],
  ['test/pdca-gate.test.mjs:85, test/pdca-state.test.mjs:187',
    [{ path: 'test/pdca-gate.test.mjs', line: 85, endLine: null },
      { path: 'test/pdca-state.test.mjs', line: 187, endLine: null }]],
  ['test/agent-contract.test.mjs:66, test/agent-contract.test.mjs:74, test/agent-contract.test.mjs:86',
    [{ path: 'test/agent-contract.test.mjs', line: 66, endLine: null },
      { path: 'test/agent-contract.test.mjs', line: 74, endLine: null },
      { path: 'test/agent-contract.test.mjs', line: 86, endLine: null }]],
  ['test/agent-contract.test.mjs (B12 2건)',
    [{ path: 'test/agent-contract.test.mjs', line: null, endLine: null }]],
  ['docs/2026-07-25-review-gate-permissions/REVIEW.md',
    [{ path: 'docs/2026-07-25-review-gate-permissions/REVIEW.md', line: null, endLine: null }]],
  // 콜론 뒤가 라인 번호가 아닌 식별자 — line은 null이어야 한다
  ['hooks/session-start.js:resumeBlock',
    [{ path: 'hooks/session-start.js', line: null, endLine: null }]],
  // em dash 뒤 한글 서술을 경로로 오인하면 안 된다
  ['test/pdca-state.test.mjs — readState bkit foreign',
    [{ path: 'test/pdca-state.test.mjs', line: null, endLine: null }]],
  // 괄호 안 숫자는 라인이 아니다 + ' + ' 결합
  ['test/progress.test.mjs (7) + commands/plan.md:41',
    [{ path: 'test/progress.test.mjs', line: null, endLine: null },
      { path: 'commands/plan.md', line: 41, endLine: null }]],
  ['commands/iterate.md:43-59',
    [{ path: 'commands/iterate.md', line: 43, endLine: 59 }]],
  // bare basename(pdca-state.js)은 실제로 hooks/lib/pdca-state.js다 —
  // 경로로 취급하면 정직한 evidence가 unresolved가 된다
  ['hooks/stop-verify.js:41-59 + pdca-state.js:gatePrerequisite',
    [{ path: 'hooks/stop-verify.js', line: 41, endLine: 59 }]],
];

test('B1: 실측 ref 10형식에서 경로·라인을 정확히 추출한다', () => {
  for (const [ref, expected] of REF_CASES) {
    const got = parseRefPaths(ref).map((r) => ({ path: r.path, line: r.line, endLine: r.endLine }));
    assert.deepEqual(got, expected, `ref: ${ref}`);
  }
});

test('B1: 디렉터리 없는 토큰은 경로 후보가 아니다 (오탐 방지)', () => {
  assert.deepEqual(parseRefPaths('pdca-state.js:gatePrerequisite'), []);
  assert.deepEqual(parseRefPaths('gatePrerequisite'), []);
  assert.deepEqual(parseRefPaths(''), []);
  assert.deepEqual(parseRefPaths(null), []);
});

// ── R1: URL은 경로가 아니다 ──────────────────────────────
// PATH_RE의 `(?:\.{0,2}\/)?` 접두가 https:// 의 두 번째 슬래시를 먹어
// 'https://x/y.md' → '/x/y.md'(절대경로) → 루트 이탈 → unresolved로 차단됐다.
// manual/visual evidence가 문서 URL·GitHub permalink를 ref로 쓰는 건 정상 사용이다.
test('R1: URL만 있는 ref는 경로 후보가 아니다 (unparsed — 게이트 무관)', () => {
  const root = makeRoot();
  for (const ref of [
    'https://nodejs.org/api/test.html',
    'https://github.com/o/r/blob/main/src/x.ts#L12',
    'https://docs.anthropic.com/en/docs/hooks.md',
    'http://example.com/foo.md',
  ]) {
    assert.deepEqual(parseRefPaths(ref), [], `URL이 경로 후보로 잡혔다: ${ref}`);
    const r = classifyRef(ref, root);
    assert.equal(r.status, 'unparsed', `ref: ${ref}`);
    assert.deepEqual(r.escaped, [], `URL을 "루트 밖 경로"로 지목하면 고칠 방법이 없다: ${ref}`);
  }

  const ev = { kind: 'manual', ref: 'https://nodejs.org/api/test.html', cmd: 'open', output: '문서를 읽고 확인했다' };
  assert.equal(gateEvidence({ behaviors: [{ id: 'B1', passes: true, evidence: ev }] }, root).ok, true);
});

test('R1: URL과 로컬 경로가 섞이면 로컬 경로만 후보로 남는다', () => {
  assert.deepEqual(
    parseRefPaths('https://x.com/a.md 참고 · test/b.test.mjs:3').map((p) => ({ path: p.path, line: p.line })),
    [{ path: 'test/b.test.mjs', line: 3 }],
  );
});

// ── R5: 앞 경계 — 토큰 앞에 무엇이 붙어 있으면 경로가 아닌가 ──
// 1·2회차가 "URL만 지운다"로 처방했다가 두 번 다 미완으로 남았다. ref는 자유 텍스트라
// 정규식으로 경로/비경로를 완전히 가르는 건 끝나지 않는다. 그래서 규칙을 더 얹지 않고
// 인정 조건을 좁힌다 — 토큰 앞이 문자열 시작·공백·쉼표·여는 괄호·`·`가 아니면 경로가 아니다.
// `~/`·`git@host:`·`@scope/`·`https://`가 한 규칙으로 닫힌다(스킴 전용 처리 불필요).
test('R5: 앞에 ~ @ : / 영숫자가 붙은 토큰은 경로 후보가 아니다 (unparsed — 게이트 무관)', () => {
  const root = makeRoot();
  for (const ref of [
    '~/.claude/settings.json',
    'git@github.com:jaehun/devkit.git',
    '@tanstack/react-query@5.0.1',
    'https://nodejs.org/api/test.html',
  ]) {
    assert.deepEqual(parseRefPaths(ref), [], `경로 후보로 잡혔다: ${ref}`);
    const r = classifyRef(ref, root);
    assert.equal(r.status, 'unparsed', `ref: ${ref}`);
    // 사용자가 쓰지도 않은 경로(`/.claude/settings.json`)를 지목하면 고칠 방법이 없다
    assert.deepEqual(r.escaped, [], `ref: ${ref}`);
    assert.deepEqual(r.missing, [], `ref: ${ref}`);
  }

  const ev = { kind: 'manual', ref: '~/.claude/settings.json', cmd: 'cat', output: '설정을 눈으로 확인했다' };
  assert.equal(gateEvidence({ behaviors: [{ id: 'B1', passes: true, evidence: ev }] }, root).ok, true);
});

// 앞 경계 집합(`\s` `,` `(` `·`)의 **멤버 하나하나**가 규칙이다. 집합을 통째로 지우는 것만
// 막으면 다음 사람이 멤버를 줄여도 초록이 유지된다(3회차 리뷰 🟡2 — 부분 뮤테이션 3건 생존).
// 각 문자는 실제로 이 레포의 ref에서 그 문자 뒤에 경로가 오는 형태로만 발화한다.
const HEAD_CASES = [
  ['\\s (공백)', 'B12 2건 확인 test/agent-contract.test.mjs:66',
    [{ path: 'test/agent-contract.test.mjs', line: 66 }]],
  [', (공백 없는 쉼표)', 'test/pdca-gate.test.mjs:85,test/pdca-state.test.mjs:187',
    [{ path: 'test/pdca-gate.test.mjs', line: 85 }, { path: 'test/pdca-state.test.mjs', line: 187 }]],
  ['( (여는 괄호)', '(test/progress.test.mjs:7)',
    [{ path: 'test/progress.test.mjs', line: 7 }]],
  ['· (가운뎃점)', '·test/lcov.test.mjs:53',
    [{ path: 'test/lcov.test.mjs', line: 53 }]],
];

for (const [label, ref, expected] of HEAD_CASES) {
  test(`R5: 앞 경계 ${label} 뒤의 경로는 후보로 인정한다`, () => {
    const got = parseRefPaths(ref).map((p) => ({ path: p.path, line: p.line }));
    assert.deepEqual(got, expected, `경계 문자 ${label}가 앞 경계 집합에서 빠졌다: ${ref}`);
  });
}

// ── B2: 존재하지 않는 ref는 unresolved ───────────────────
test('B2: D11-b 위조 evidence(ref:"t.ts")는 unresolved로 지목된다', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(dir, 'fixtures', 'forged', 'behaviors.json'), 'utf8'));
  const ref = doc.behaviors[0].evidence.ref;
  assert.equal(ref, 't.ts', '픽스처가 D11-b 원문이어야 한다');

  const r = classifyRef(ref, makeRoot());
  assert.equal(r.status, 'unresolved');
  assert.ok(r.missing.includes('t.ts'), `missing에 t.ts 없음: ${JSON.stringify(r.missing)}`);
});

// 정책(2회차 리뷰 🔴2·🟡3): 디렉터리 ref는 **막지 않는다.** 실재하는 폴더를 "파일 없음"으로
// 지목하는 건 사실과 다른 오탐이고, 이 사이클이 만든 `.devkit`이 자기 게이트에 막혔다.
// 그래서 디렉터리는 unresolved(차단)가 아니라 후보에서 제외 → 남은 후보가 없으면 unparsed.
// "폴더명만 적는 위조"를 이 층에서 잡으려던 GAP 1회차 ⚠️1의 시도는 의도적으로 포기한다 —
// 위조 검출은 receipt 인용 대조(L3a-2)가 다른 축에서 본다.
test('R7: 디렉터리 ref는 missing이 아니라 후보에서 제외한다 (unparsed — 게이트 무관)', () => {
  const root = makeRoot();
  // 확장자가 붙어 경로 후보로는 인정되지만 실제로는 폴더인 경우까지 포함한다.
  fs.mkdirSync(path.join(root, 'src', 'x.js'), { recursive: true });
  fs.mkdirSync(path.join(root, '.devkit'), { recursive: true });

  for (const ref of ['src/x.js', '.devkit']) {
    const r = classifyRef(ref, root);
    assert.equal(r.status, 'unparsed', `실재하는 폴더를 차단했다: ${ref}`);
    assert.deepEqual(r.missing, [], `"파일 없음"은 사실과 다르다: ${ref}`);
  }

  const ev = { kind: 'manual', ref: 'src/x.js', cmd: 'ls', output: '폴더 구조를 눈으로 확인했다' };
  assert.equal(gateEvidence({ behaviors: [{ id: 'B1', passes: true, evidence: ev }] }, root).ok, true);
});

// 이 사이클이 도입한 `.devkit`이 정확히 이 이름이라, "receipts가 .devkit에 쌓인다"는
// behavior가 자기 자신 때문에 막혔다(2회차 리뷰 🔴2 live EXIT=2). 실제 레포에서 고정한다.
test('R7: 이 레포의 실재하는 디렉터리 ref는 전부 unparsed', () => {
  for (const ref of ['.devkit', '.claude', '.claude-plugin', 'hooks/lib']) {
    const r = classifyRef(ref, repoRoot);
    assert.equal(r.status, 'unparsed', `ref: ${ref} — missing=${JSON.stringify(r.missing)}`);
  }
});

test('R7: 없는 파일은 여전히 unresolved (디렉터리 제외가 위조까지 열면 안 된다)', () => {
  const root = makeRoot();
  const r = classifyRef('t.ts', root);
  assert.equal(r.status, 'unresolved');
  assert.deepEqual(r.missing, ['t.ts']);
});

// ── R2: SINGLE_RE 폴백은 DESIGN §5.1대로 "확장자로 끝나는 단일 토큰"만 ──
// 확장자가 없으면 경로로 볼 근거가 없다 → 후보 0개 → unparsed(fail-open).
// R7(디렉터리 제외)이 실존하는 폴더를 뒤에서 한 번 더 걸러주지만, 파싱 단계에서 먼저
// 빼면 stat 없이도 닫힌다 — 존재하지 않는 폴더 이름을 "파일 없음"으로 지목하지 않는다.
test('R2: 확장자 없는 단일 토큰은 후보가 아니다 (실재하는 폴더 ref를 차단하지 않는다)', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, 'hooks', 'lib'), { recursive: true });

  for (const ref of ['hooks/lib', 'test/fixtures/dead-branch', 'docs/2026-07-25-x']) {
    assert.deepEqual(parseRefPaths(ref), [], `확장자 없는 토큰이 경로로 잡혔다: ${ref}`);
    assert.equal(classifyRef(ref, root).status, 'unparsed', `ref: ${ref}`);
  }

  const ev = { kind: 'manual', ref: 'hooks/lib', cmd: 'ls', output: '폴더 구조를 눈으로 확인했다' };
  assert.equal(gateEvidence({ behaviors: [{ id: 'B1', passes: true, evidence: ev }] }, root).ok, true);
});

// ── R6: 확장자 없는 토큰의 예외는 "루트 이탈"에만 준다 ────
// 2회차가 확장자 요구의 예외 근거를 "절대경로·상위 이동은 식별자일 수 없다"로 적었는데
// 이 레포의 식별자가 정확히 `/report`·`/gap`이라 근거가 틀렸다(2회차 리뷰 🟡2).
// 슬래시 1개짜리 절대경로는 커맨드 식별자와 구분되지 않으므로 후보에서 뺀다.
test('R6: 슬래시 1개짜리 /토큰은 커맨드 식별자다 (unparsed — 게이트 무관)', () => {
  const root = makeRoot();
  for (const ref of ['/report', '/gap', '/review']) {
    assert.deepEqual(parseRefPaths(ref), [], `커맨드 식별자가 경로로 잡혔다: ${ref}`);
    const r = classifyRef(ref, root);
    assert.equal(r.status, 'unparsed', `ref: ${ref}`);
    assert.deepEqual(r.escaped, [], `ref: ${ref}`);
  }

  const ev = { kind: 'manual', ref: '/report', cmd: 'grep', output: '커맨드 정의를 눈으로 확인했다' };
  assert.equal(gateEvidence({ behaviors: [{ id: 'B1', passes: true, evidence: ev }] }, root).ok, true);
});

test('R6: 루트 이탈(슬래시 2개 이상 절대경로 · .. 세그먼트)은 확장자가 없어도 거부한다', () => {
  const root = makeRoot();
  for (const ref of ['/etc/passwd', '../../etc/passwd', '../secrets']) {
    const r = classifyRef(ref, root);
    assert.equal(r.status, 'unresolved', `루트 이탈이 판정에서 샜다: ${ref}`);
    assert.ok(r.escaped.length > 0, `escaped가 비었다: ${ref}`);
  }
});

test('B2: 실재하는 파일은 resolved', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'x.js'), 'a\nb\nc\n');

  const r = classifyRef('src/x.js:2', root);
  assert.equal(r.status, 'resolved');
  assert.deepEqual(r.missing, []);
});

// 라인 드리프트는 게이트가 아니다(DESIGN §1.2) — 파일이 줄어들면 정직한 ref도
// 라인을 초과한다. 위조와 구분이 안 되므로 보고만 하고 status는 건드리지 않는다.
test('라인 초과는 lineDrift에만 담고 status를 바꾸지 않는다', () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, 'a.js'), 'a\nb\nc\n'); // 3줄
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'x.js'), 'a\nb\nc\n');

  const r = classifyRef('src/x.js:99999', root);
  assert.equal(r.status, 'resolved', '라인 위조는 이 층에서 막지 않는다');
  assert.equal(r.lineDrift.length, 1);
  assert.match(r.lineDrift[0], /src\/x\.js:99999/);
  assert.match(r.lineDrift[0], /3/, '총 라인 수를 알려줘야 판단할 수 있다');

  assert.deepEqual(classifyRef('src/x.js:2-3', root).lineDrift, [], '범위 안이면 드리프트 아님');
});

// ── B3: 정직한 evidence를 막지 않는다 (오탐 회귀) ─────────
// v0.11.0 사이클의 실제 behaviors.json 14건. 하나라도 unresolved가 나오면
// 그건 위조 검출이 아니라 게이트가 정상 사이클을 막는다는 뜻이다.
test('B3: v0.11.0 아카이브 14건이 전부 resolved', () => {
  const p = path.join(repoRoot, 'docs', 'archive', '2026-07-25', 'review-gate-permissions', 'behaviors.json');
  const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(doc.behaviors.length, 14, '분모가 14건이어야 한다');

  const bad = [];
  for (const b of doc.behaviors) {
    const r = classifyRef(b.evidence.ref, repoRoot);
    if (r.status !== 'resolved') bad.push(`${b.id} ${r.status} ${JSON.stringify(r.missing)}`);
  }
  assert.deepEqual(bad, [], `정직한 evidence가 막혔다: ${bad.join(' / ')}`);
});

// /report가 사이클을 docs/archive/{date}/{slug}/로 옮긴다(commands/report.md:24).
// 막는 쪽이 그 규칙을 모르면 아카이빙 순간 완료된 사이클이 전부 위조로 둔갑한다.
test('B3: 아카이빙된 사이클 문서는 archive 폴백으로 찾는다', () => {
  const ref = 'docs/2026-07-25-review-gate-permissions/REVIEW.md';
  const r = classifyRef(ref, repoRoot);
  assert.equal(r.status, 'resolved');
  assert.equal(r.via[ref], 'archive', '폴백으로 찾았음을 보고에 남겨야 한다');
});

// ── B4: 루트를 벗어나는 ref는 거부 ───────────────────────
test('B4: ../ · 절대경로 · 경로 탈출은 unresolved + escaped', () => {
  const root = makeRoot();
  for (const ref of ['../secrets/x.ts', '/etc/passwd', 'docs/../../x.md']) {
    const r = classifyRef(ref, root);
    assert.equal(r.status, 'unresolved', `ref: ${ref}`);
    assert.ok(r.escaped.length > 0, `escaped가 비었다: ${ref}`);
  }
});

test('B4: 루트 안의 절대경로는 통과한다 (오탐 반경 제한)', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'x.js'), 'a\n');
  assert.equal(classifyRef(path.join(root, 'src', 'x.js'), root).status, 'resolved');
});

// ── gateEvidence: 게이트가 무엇을 막고 무엇을 통과시키는가 ──
const forged = JSON.parse(fs.readFileSync(path.join(dir, 'fixtures', 'forged', 'behaviors.json'), 'utf8'));

test('gateEvidence: unresolved가 있으면 어느 behavior의 어느 ref인지 지목한다', () => {
  const g = gateEvidence(forged, makeRoot());
  assert.equal(g.ok, false);
  assert.equal(g.unresolved.length, 1);
  assert.equal(g.unresolved[0].id, 'B2');
  assert.match(g.reason, /B2/, '어느 behavior인지 알려줘야 고칠 수 있다');
  assert.match(g.reason, /t\.ts/, '어느 ref인지 알려줘야 고칠 수 있다');
});

test('E1: doc이 null이거나 behaviors가 배열이 아니면 통과 (판정 불가 = 통과)', () => {
  const root = makeRoot();
  for (const doc of [null, undefined, {}, { behaviors: 'nope' }, 42]) {
    assert.equal(gateEvidence(doc, root).ok, true, JSON.stringify(doc));
  }
});

test('E2: 작업 중(passes:false)·증거 미달 항목은 검사하지 않는다', () => {
  const root = makeRoot();
  const bad = { kind: 'test', ref: 'nope/x.ts', cmd: 'node --test', output: 'pass 1 fail 0' };
  // passes:false — 아직 구현 중인 항목의 ref가 틀린 건 정상이다
  assert.equal(gateEvidence({ behaviors: [{ id: 'B1', passes: false, evidence: bad }] }, root).ok, true);
  // evidence가 isEvidenceValid를 못 넘김 — 그건 unproven이 이미 잡는다(이중 차단 금지)
  assert.equal(gateEvidence({ behaviors: [{ id: 'B1', passes: true, evidence: { ...bad, output: '통과' } }] }, root).ok, true);
});

test('E3: 파서가 못 읽는 ref는 차단하지 않는다 (오탐이 차단보다 비싸다)', () => {
  const ev = { kind: 'manual', ref: 'pdca-state.js:gatePrerequisite', cmd: 'grep', output: '규칙이 명시됨' };
  const g = gateEvidence({ behaviors: [{ id: 'B1', passes: true, evidence: ev }] }, makeRoot());
  assert.equal(classifyRef(ev.ref, makeRoot()).status, 'unparsed');
  assert.equal(g.ok, true);
});

// ── R8: 아카이브 폴백도 직접 경로와 똑같은 3분기를 쓴다 ───
// 3회차 리뷰 🟡3: 폴백이 `=== 'ok'` 하나로 눌려 디렉터리도 권한 오류도 전부 missing이 됐다.
// 판정이 경로에 따라 갈리면(직접 EACCES는 통과 · 아카이브 EACCES는 차단) E4가 반쪽이 된다.
// 아카이브는 **완료된 사이클이 사는 곳**이라 여기서 나는 오탐은 되돌리기 어렵다.
test('R8: 아카이브 폴백 대상이 디렉터리면 차단하지 않는다 (unparsed — 게이트 무관)', () => {
  const root = makeRoot();
  // /report가 docs/{date}-{slug}/ → docs/archive/{date}/{slug}/로 옮긴 뒤의 모습.
  fs.mkdirSync(path.join(root, 'docs', 'archive', '2026-07-25', 'x', 'shots.v2'), { recursive: true });
  const ref = 'docs/2026-07-25-x/shots.v2';
  assert.equal(parseRefPaths(ref).length, 1, '경로 후보로는 인정돼야 폴백까지 간다');

  const r = classifyRef(ref, root);
  assert.deepEqual(r.missing, [], `실재하는 폴더를 "파일 없음"으로 지목했다: ${JSON.stringify(r.missing)}`);
  assert.equal(r.status, 'unparsed', '디렉터리는 판정 대상이 아니다 — 직접 경로(R7)와 같아야 한다');

  const ev = { kind: 'manual', ref, cmd: 'ls', output: '스크린샷 폴더를 눈으로 확인했다' };
  assert.equal(gateEvidence({ behaviors: [{ id: 'B1', passes: true, evidence: ev }] }, root).ok, true);
});

test('R8: 아카이브 폴백의 stat이 ENOENT가 아닌 이유로 실패해도 차단하지 않는다 (E4 대칭)', () => {
  const root = makeRoot();
  // E4와 같은 기법 — 파일을 디렉터리처럼 취급시켜 ENOTDIR을 만든다(chmod·권한에 안 흔들린다).
  fs.mkdirSync(path.join(root, 'docs', 'archive', '2026-07-25', 'x'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'archive', '2026-07-25', 'x', 'blocker.txt'), 'not a directory\n');
  const ref = 'docs/2026-07-25-x/blocker.txt/inner.js';

  const r = classifyRef(ref, root);
  assert.deepEqual(r.missing, [], '확인 실패를 "파일 없음"으로 단정하면 안 된다 — 직접 경로(E4)와 같아야 한다');
  assert.deepEqual(r.escaped, []);
  assert.notEqual(r.status, 'unresolved', '폴백 경로의 stat 실패가 차단 사유가 되면 안 된다');

  const ev = { kind: 'test', ref, cmd: 'node --test', output: '✔ 무언가 통과 (1ms)' };
  assert.equal(gateEvidence({ behaviors: [{ id: 'B1', passes: true, evidence: ev }] }, root).ok, true);
});

test('E4: stat이 ENOENT가 아닌 이유로 실패해도 차단하지 않는다 (권한·경로 문제 fail-open)', () => {
  const root = makeRoot();
  // 파일을 디렉터리처럼 취급시키면 statSync가 ENOTDIR을 던진다 — chmod 없이
  // "ENOENT가 아닌 에러"를 만드는 결정론적 방법이다(root 권한에도 안 흔들린다).
  fs.writeFileSync(path.join(root, 'blocker.txt'), 'not a directory\n');
  const ref = 'blocker.txt/inner.js';

  const r = classifyRef(ref, root);
  // 핵심 계약: 확인에 실패한 경로를 missing으로 세지 않는다.
  // 파일이 없다고 단정할 근거가 없는데 없다고 하면 그게 오탐이다.
  assert.deepEqual(r.missing, [], '확인 실패를 "파일 없음"으로 단정하면 안 된다');
  assert.deepEqual(r.escaped, []);
  assert.notEqual(r.status, 'unresolved', 'stat 실패가 차단 사유가 되면 안 된다');

  const ev = { kind: 'test', ref, cmd: 'node --test', output: '✔ 무언가 통과 (1ms)' };
  assert.equal(gateEvidence({ behaviors: [{ id: 'B1', passes: true, evidence: ev }] }, root).ok, true);
});
