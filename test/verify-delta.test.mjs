// verify-delta.js — 직전 실행 대비 차분. **순수층**이라 프로세스를 하나도 안 띄운다.
// (docs/2026-08-12-scoped-verification/ D1~D16)
//
// 이 파일이 지키는 가장 중요한 것은 D4·D13(**과잉 정규화 회귀 방지**)이다.
// 과잉 정규화 = 서로 다른 두 에러가 같은 키가 되어 unchanged로 접힘 = 진짜 회귀가 조용히 숨는다.
// 이 사이클이 만들면 안 되는 유일한 결함이라, 키를 넓히는 변경은 여기서 죽어야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.join(dir, '..', 'hooks', 'lib', 'verify-delta.js');
const require_ = createRequire(import.meta.url);
const {
  diagKey, lintLineKey, toKeyCounts, diffDiagnostics,
  looksLikeTerrainShift, attachHeaders, formatDelta,
} = require_(modPath);
const { CLIP_DEFAULTS } = require_(path.join(dir, '..', 'hooks', 'lib', 'verify-classify.js'));

const ROOT = '/repo';
/** tsc 기본 출력(pretty)을 1차 픽스처로 쓴다 — A의 교훈: 가장 흔한 입력을 테스트해야 한다 */
function item(over = {}) {
  const o = {
    file: 'src/a.ts', line: 12, col: 5, code: 'TS2322',
    message: "Type 'string' is not assignable to type 'number'.",
    ...over,
  };
  return { ...o, raw: `${o.file}:${o.line}:${o.col} - error ${o.code}: ${o.message}` };
}
const keysOf = (items) => items.map((i) => diagKey(i, ROOT));

// ── D1~D5 diagKey ─────────────────────────────────────────────────
test('D1: 줄이 밀려도 같은 키 (line·col은 키에 안 들어간다)', () => {
  assert.equal(diagKey(item({ line: 12 }), ROOT), diagKey(item({ line: 40, col: 9 }), ROOT));
});

test('D2: code나 message가 다르면 다른 키', () => {
  assert.notEqual(diagKey(item(), ROOT), diagKey(item({ code: 'TS2345' }), ROOT));
  assert.notEqual(diagKey(item(), ROOT), diagKey(item({ message: 'Something else.' }), ROOT));
  assert.notEqual(diagKey(item(), ROOT), diagKey(item({ file: 'src/b.ts' }), ROOT));
});

test('D3: 절대경로와 상대경로가 같은 키 (mode 전환 대비)', () => {
  // direct-tsc ↔ script 폴백이 일어나면 tsc가 찍는 경로 형태가 달라진다.
  // 정규화하지 않으면 그 턴에 전 진단이 new로 폭발한다.
  assert.equal(
    diagKey(item({ file: 'src/a.ts' }), ROOT),
    diagKey(item({ file: '/repo/src/a.ts' }), ROOT),
  );
  assert.equal(
    diagKey(item({ file: 'src/a.ts' }), ROOT),
    diagKey(item({ file: 'src\\a.ts' }), ROOT),
    'Windows 구분자도 같은 키',
  );
});

test('D4: 과잉 정규화 회귀 방지 — 타입 이름이 다르면 다른 키', () => {
  // 여기가 이 파일의 핵심이다. 숫자·타입명을 마스킹하면 서로 다른 에러가 한 키로 접히고,
  // 그러면 진짜 회귀가 unchanged에 묻힌다. 넓히는 변경은 이 테스트에서 죽어야 한다.
  const a = item({ message: "Type 'A' is not assignable to type 'X'." });
  const b = item({ message: "Type 'B' is not assignable to type 'X'." });
  assert.notEqual(diagKey(a, ROOT), diagKey(b, ROOT));

  const long1 = item({ code: 'TS2345', message: "Argument of type '{ id: number; }' is not assignable to parameter of type '{ id: string; }'." });
  const long2 = item({ code: 'TS2345', message: "Argument of type '{ id: boolean; }' is not assignable to parameter of type '{ id: string; }'." });
  assert.notEqual(diagKey(long1, ROOT), diagKey(long2, ROOT));

  const n1 = item({ message: 'Expected 1 arguments, but got 2.' });
  const n2 = item({ message: 'Expected 1 arguments, but got 3.' });
  assert.notEqual(diagKey(n1, ROOT), diagKey(n2, ROOT), '숫자 마스킹 금지');
});

test('D3b: 메시지 안의 root 절대경로는 제거된다', () => {
  const withRoot = item({ code: 'TS2307', message: "Cannot find module '/repo/src/x' or its declarations." });
  const relative = item({ code: 'TS2307', message: "Cannot find module 'src/x' or its declarations." });
  assert.equal(diagKey(withRoot, ROOT), diagKey(relative, ROOT));
});

test('D5: multiset — 같은 키의 개수 변화가 new/resolved가 된다', () => {
  const three = [item(), item({ line: 20 }), item({ line: 30 })];
  const four = [...three, item({ line: 40 })];
  const grew = diffDiagnostics(keysOf(three), four, ROOT, 'typecheck');
  assert.equal(grew.counts.new, 1);
  assert.equal(grew.counts.resolved, 0);

  const shrank = diffDiagnostics(keysOf(four), three, ROOT, 'typecheck');
  assert.equal(shrank.counts.new, 0);
  assert.equal(shrank.counts.resolved, 1);

  const same = diffDiagnostics(keysOf(three), three, ROOT, 'typecheck');
  assert.equal(same.counts.new, 0);
  assert.equal(same.counts.resolved, 0);
  assert.equal(same.counts.unchanged, 3);
});

test('D6: baseline이 비어 있으면 전부 new', () => {
  const cur = [item(), item({ file: 'src/b.ts' })];
  const d = diffDiagnostics([], cur, ROOT, 'typecheck');
  assert.equal(d.counts.new, 2);
  assert.equal(d.newItems.length, 2);
});

test('D7: 완전 동일하면 new 0 · resolved 0 · unchanged N', () => {
  const cur = [item(), item({ file: 'src/b.ts' })];
  const d = diffDiagnostics(keysOf(cur), cur, ROOT, 'typecheck');
  assert.deepEqual(d.counts, { new: 0, resolved: 0, unchanged: 2, moved: 0 });
});

test('toKeyCounts: 중복을 센다', () => {
  const m = toKeyCounts(['a', 'b', 'a']);
  assert.equal(m.get('a'), 2);
  assert.equal(m.get('b'), 1);
});

// ── D8 지형 변화 ───────────────────────────────────────────────────
test('D8: 임계 경계값 — 40은 false, 41은 true. 상수는 clipDiagnostics에서 온다', () => {
  // 새 숫자를 발명하지 않는다. 40은 "지형이 바뀐 건수"가 아니라 — 그런 수는 없다 —
  // 보고가 어차피 잘려 목록으로서 쓸모를 잃는 지점이다.
  assert.equal(CLIP_DEFAULTS.maxItems, 40, '상수 출처가 바뀌면 이 테스트가 먼저 깨져야 한다');
  assert.equal(looksLikeTerrainShift({ new: 40, resolved: 0, unchanged: 0 }), false);
  assert.equal(looksLikeTerrainShift({ new: 41, resolved: 0, unchanged: 0 }), true);
});

// ── D9~D11 formatDelta ─────────────────────────────────────────────
const EMPTY = { new: 0, resolved: 0, unchanged: 7 };

test('D9: 변화 없음 + 세션 첫 턴 아님 → null (완전 침묵)', () => {
  const out = formatDelta('typecheck', { counts: EMPTY, newItems: [] }, { firstTurn: false });
  assert.equal(out, null);
});

test('D10: new가 있으면 전문 + 꼬리 1줄이 반드시 붙는다', () => {
  const d = { counts: { new: 1, resolved: 2, unchanged: 7 }, newItems: [item()] };
  const out = formatDelta('typecheck', d, { firstTurn: false });
  assert.match(out, /TS2322/, '새 진단 원문이 있어야 함');
  const tail = out.split('\n').at(-1);
  assert.match(tail, /7/, '꼬리에 unchanged 건수');
  assert.match(tail, /2/, '꼬리에 resolved 건수');
});

test('D11: 세션 첫 턴은 변화가 없어도 정확히 1줄 (전문 아님)', () => {
  // baseline은 세션 경계를 모른다. 그대로 두면 새 세션 모델은 300건이 남아 있다는 걸
  // 영원히 모른 채 시작한다 — "매 턴 16KB"를 고치려다 "아예 존재를 모름"이 되면 과잉 교정이다.
  const out = formatDelta('typecheck', { counts: EMPTY, newItems: [] }, { firstTurn: true });
  assert.ok(out, '첫 턴엔 침묵하지 않는다');
  assert.equal(out.split('\n').length, 1, `정확히 1줄이어야 함: ${out}`);
  assert.match(out, /7/);
});

test('D11b: 지형 변화면 목록을 접고 요약만 낸다', () => {
  const many = Array.from({ length: 41 }, (_, i) => item({ file: `src/f${i}.ts` }));
  const d = { counts: { new: 41, resolved: 0, unchanged: 3 }, newItems: many };
  const out = formatDelta('typecheck', d, { firstTurn: false });
  assert.match(out, /지형/);
  assert.doesNotMatch(out, /src\/f40\.ts/, '목록은 접혀야 함');
  assert.ok(out.split('\n').length <= 3, `요약 2~3줄이어야 함: ${out}`);
});

// ── D12~D14 lint ───────────────────────────────────────────────────
test('D12: eslint stylish의 위치 토큰을 떼어 줄 이동에 불변', () => {
  const a = '  12:5  error  Unexpected console statement  no-console';
  const b = '  40:9  error  Unexpected console statement  no-console';
  assert.equal(lintLineKey(a, ROOT), lintLineKey(b, ROOT));
});

test('D13: 과잉 정규화 방지 — rule명이 다르면 다른 키', () => {
  const a = '  12:5  error  Unexpected console statement  no-console';
  const b = '  12:5  error  Unexpected console statement  no-alert';
  assert.notEqual(lintLineKey(a, ROOT), lintLineKey(b, ROOT));
});

test('D13b: 위치가 줄 가운데인 형식(biome 등)은 원문 그대로 — 틀려도 new 방향', () => {
  const a = 'lint/style ━ src/a.ts:1:1 something';
  assert.equal(lintLineKey(a, ROOT), lintLineKey(a, ROOT));
  assert.notEqual(lintLineKey(a, ROOT), lintLineKey('lint/style ━ src/a.ts:2:1 something', ROOT));
});

test('D14: attachHeaders — new 줄 위의 위치 없는 줄을 문맥으로 붙인다', () => {
  // stylish는 파일명을 헤더 줄에 따로 찍는다. 새 진단 1건만 나오면 헤더가 unchanged라
  // 빠지고 파일명 없는 줄만 나간다. 휴리스틱이고 틀리면 무관한 줄 1개가 더 보일 뿐이다.
  const all = [
    '/repo/src/a.ts',
    '  1:1  error  A  rule-a',
    '  2:2  error  B  rule-b',
  ];
  const out = attachHeaders(['  2:2  error  B  rule-b'], all);
  assert.deepEqual(out, ['/repo/src/a.ts', '  2:2  error  B  rule-b']);
});

test('lint delta도 같은 계약으로 돈다', () => {
  const prev = ['  1:1  error  A  rule-a'].map((l) => lintLineKey(l, ROOT));
  const cur = [{ raw: '  1:1  error  A  rule-a' }, { raw: '  9:9  error  B  rule-b' }];
  const d = diffDiagnostics(prev, cur, ROOT, 'lint');
  assert.equal(d.counts.new, 1);
  assert.match(d.newItems[0].raw, /rule-b/);
});

// ── D15~D16 순수성·재사용 ──────────────────────────────────────────
test('D15: verify-delta.js는 fs·child_process를 require하지 않는다', () => {
  const src = fs.readFileSync(modPath, 'utf8');
  assert.doesNotMatch(src, /require\(['"]node:fs['"]\)/);
  assert.doesNotMatch(src, /require\(['"]node:child_process['"]\)/);
});

test('D16: 새 진단 파서를 만들지 않았다 — 소스에 TS 진단 정규식이 없다', () => {
  // B18의 실행 가능한 증명. A가 만든 parseTscDiagnostics를 재사용해야 하고,
  // 여기에 파서가 생기면 pretty/non-pretty 두 형식을 또 한 번 틀리게 다루기 시작한다.
  const src = fs.readFileSync(modPath, 'utf8');
  assert.doesNotMatch(src, /TS\\d\+/, 'TS 진단 코드 정규식이 새로 생겼다');
  assert.doesNotMatch(src, /error\s+TS/, 'tsc 출력 형식을 여기서 다시 알면 안 된다');
});

test('어떤 입력에도 throw하지 않는다', () => {
  for (const bad of [null, undefined, {}, { file: null }, { message: null }]) {
    assert.doesNotThrow(() => diagKey(bad, ROOT), `diagKey: ${JSON.stringify(bad)}`);
  }
  assert.doesNotThrow(() => diffDiagnostics(null, null, ROOT, 'typecheck'));
  assert.doesNotThrow(() => formatDelta('typecheck', null, {}));
  assert.doesNotThrow(() => lintLineKey(null, ROOT));
  assert.doesNotThrow(() => attachHeaders(null, null));
});

// ── REVIEW 대응: 실측으로 재현된 침묵 경로 ─────────────────────────
test('D17: 같은 키가 자리만 옮기면 침묵하지 않고 건수로 알린다', () => {
  // 🔴 리뷰가 실측 재현한 유일한 치명 경로. TS2532 "Object is possibly 'undefined.'"는
  // 식별자를 안 담아 같은 파일의 두 줄이 바이트 단위로 동일하다. line12가 해결되고
  // line80에 새로 생기면 개수가 같아 unchanged로 접히고 **완전히 침묵**했다.
  // 키에 줄번호를 넣으면 막히지만 D1(줄 밀림 = 소음)이 깨진다 — 그래서 키는 두고
  // 위치 집합이 바뀐 것만 건수로 알린다. 전문을 다시 뿌리지 않으니 반복 주입도 아니다.
  const undef = (line) => ({
    file: 'src/a.ts', line, col: 3, code: 'TS2532',
    message: "Object is possibly 'undefined'.",
    raw: `src/a.ts:${line}:3 - error TS2532: Object is possibly 'undefined'.`,
  });
  const before = [undef(12)];
  const prevKeys = before.map((i) => diagKey(i, ROOT));
  const prevPos = [`${diagKey(undef(12), ROOT)}@12`];

  const d = diffDiagnostics(prevKeys, [undef(80)], ROOT, 'typecheck', prevPos);
  assert.equal(d.counts.new, 0, '키가 같으니 new는 아니다');
  assert.equal(d.counts.moved, 1, '위치가 바뀐 것을 세야 한다');
  const out = formatDelta('typecheck', d, { firstTurn: false });
  assert.ok(out, '침묵하면 안 된다');
  assert.match(out, /위치가 바뀌/);
});

test('D17b: 위치도 같으면 moved가 0이고 여전히 침묵한다 (소음 안 만든다)', () => {
  const cur = [item()];
  const keys = keysOf(cur);
  const pos = [`${keys[0]}@${cur[0].line}`];
  const d = diffDiagnostics(keys, cur, ROOT, 'typecheck', pos);
  assert.equal(d.counts.moved, 0);
  assert.equal(formatDelta('typecheck', d, { firstTurn: false }), null);
});
