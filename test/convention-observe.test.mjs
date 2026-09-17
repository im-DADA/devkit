// convention-observe — 편집 직후 규칙 위반을 Claude에게 알리는 계약 (2026-09-17-rules-single-source F).
//
// 왜 필요한가: HumanLayer "LLM에게 린터 일을 시키지 마라". 그런데 린터는 **레포 안** 설정이라
// 레포 밖에서 도는 devkit(전역)의 수단이 아니고, 실측한 프로젝트 7개 전부 eslint에 해당 규칙이
// 없었다. 이 훅은 위반을 찾고도 audit에 **기록만** 해서 Claude는 몰랐다. 그래서 찾은 자리에서 알린다.
//
// ⚠ 소음이 이 기능을 죽인다. 기존 레포의 옛 `any`가 편집할 때마다 반복 경고되면 무시 학습이
// 생긴다 — 그래서 **이번 편집이 넣은 것만** 알린다(B14).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const hook = path.join(dir, '..', 'hooks', 'convention-observe.js');

const tmpDirs = [];
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

/** 프로젝트 루트(package.json)를 만들고 그 안에 파일을 쓴다 — 훅은 편집 **후** 디스크를 읽는다 */
function makeFile(rel, content) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-observe-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  tmpDirs.push(root);
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

/** 훅 실행 → { code, context }. context는 Claude에게 가는 안내, 없으면 null */
function run(input, cwd) {
  let stdout;
  try {
    stdout = execFileSync('node', [hook], {
      input: JSON.stringify(input), cwd: cwd || os.tmpdir(), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    return { code: e.status, context: null };
  }
  if (!stdout.trim()) return { code: 0, context: null };
  const h = JSON.parse(stdout).hookSpecificOutput;
  assert.equal(h.hookEventName, 'PostToolUse', 'PostToolUse 형식이어야 Claude에게 전달된다');
  return { code: 0, context: h.additionalContext ?? null };
}

const write = (file) => run({ tool_name: 'Write', tool_input: { file_path: file, content: fs.readFileSync(file, 'utf8') } }, path.dirname(file));
const edit = (file, oldStr, newStr) => run({ tool_name: 'Edit', tool_input: { file_path: file, old_string: oldStr, new_string: newStr } }, path.dirname(file));
const lines = (n, fill = (i) => `export const v${i} = ${i};`) => Array.from({ length: n }, (_, i) => fill(i)).join('\n');

// ── B13: 위반이 있으면 알리고, 없으면 조용하다 ─────────────────────
test('B13: Write로 넣은 any·console.log를 규칙과 줄 번호로 알린다(차단 아님)', () => {
  const file = makeFile('src/a.ts', 'export const a: any = 1;\nexport function f() {\n  console.log(a);\n}\n');
  const r = write(file);
  assert.equal(r.code, 0, '차단하면 안 된다');
  assert.ok(r.context, 'Claude에게 알려야 한다');
  assert.match(r.context, /any[^\n]*L1/);
  assert.match(r.context, /console\.log[^\n]*L3/);
});

test('B13: 빈 catch(에러 삼키기)도 알린다', () => {
  const file = makeFile('src/b.ts', 'export function g() {\n  try { run(); } catch {}\n  try { run(); } catch (e) {}\n}\n');
  const r = write(file);
  assert.match(r.context || '', /catch[^\n]*L2/);
  assert.match(r.context || '', /L3/);
});

test('B13: .tsx 안의 useEffect·fetch를 알린다', () => {
  const file = makeFile('src/c.tsx', 'export function C() {\n  useEffect(() => {}, []);\n  fetch("/x");\n  return null;\n}\n');
  const r = write(file);
  assert.match(r.context || '', /L2/);
  assert.match(r.context || '', /fetch[^\n]*L3/);
});

test('B13: 위반이 없으면 아무것도 출력하지 않는다', () => {
  const file = makeFile('src/clean.ts', 'export const ok: unknown = 1;\n');
  const r = write(file);
  assert.equal(r.code, 0);
  assert.equal(r.context, null, '깨끗한 편집에 안내를 붙이면 무시 학습이 생긴다');
});

// ── B14: 이번 편집이 넣은 것만 ───────────────────────────────────
test('B14: Edit은 new_string 밖(기존 코드)의 위반을 알리지 않는다', () => {
  const file = makeFile('src/legacy.ts', 'export const old: any = 1;\nexport const x = 2;\n');
  const r = edit(file, 'export const x = 1;', 'export const x = 2;');
  assert.equal(r.context, null, '옛 any가 편집할 때마다 반복 경고되면 안 된다');
});

test('B14: Edit이 새로 넣은 위반은 파일 기준 줄 번호로 알린다', () => {
  const file = makeFile('src/legacy2.ts', 'export const old: any = 1;\nexport const y = 1;\nconsole.log(y);\n');
  const r = edit(file, 'export const y = 0;', 'export const y = 1;\nconsole.log(y);');
  assert.ok(r.context, '새로 넣은 console.log를 알려야 한다');
  assert.match(r.context, /console\.log[^\n]*L3/);
  assert.doesNotMatch(r.context, /any/, '기존 줄의 any는 섞이면 안 된다');
});

test('B14: 200줄은 이번 Edit으로 넘어섰을 때만 알린다', () => {
  const crossing = makeFile('src/grow.ts', lines(201));
  // 편집 전 199줄 → 2줄 추가해 201줄
  const r1 = edit(crossing, 'export const v198 = 198;', 'export const v198 = 198;\nexport const v199 = 199;\nexport const v200 = 200;');
  assert.match(r1.context || '', /200줄/, '넘어선 편집은 알려야 한다');

  const already = makeFile('src/big.ts', lines(250));
  const r2 = edit(already, 'export const v10 = 9;', 'export const v10 = 10;');
  assert.equal(r2.context, null, '이미 긴 파일의 한 줄 수정마다 경고하면 안 된다');
});

test('B14: Write로 200줄 넘는 파일을 쓰면 알린다', () => {
  const file = makeFile('src/long.ts', lines(230));
  assert.match(write(file).context || '', /200줄/);
});

test('판정 불가 입력(깨진 JSON·경로 없음)에도 exit 0', () => {
  for (const input of ['{', JSON.stringify({}), JSON.stringify({ tool_input: { file_path: '/nope/x.ts' } })]) {
    let code = 0;
    try { execFileSync('node', [hook], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { code = e.status; }
    assert.equal(code, 0);
  }
});
