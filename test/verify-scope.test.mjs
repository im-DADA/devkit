// verify-scope.js — 무엇이 바뀌었나(git) + 무엇을 볼까(그래프). IO 경계.
// (docs/2026-08-12-scoped-verification/ S1~S11)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const { parsePorcelainZ, scopeFor, scanSources } =
  createRequire(import.meta.url)(path.join(dir, '..', 'hooks', 'lib', 'verify-scope.js'));

const tmpDirs = [];
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

function git(root, ...args) {
  return execFileSync('git', args, {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  });
}
/** 커밋 1개가 있는 tmp git 레포 */
function makeRepo(files = { 'src/a.ts': 'export const a = 1;\n' }) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-scope-'));
  tmpDirs.push(d);
  fs.writeFileSync(path.join(d, 'package.json'), '{"name":"t"}');
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true });
    fs.writeFileSync(path.join(d, rel), body);
  }
  git(d, 'init', '-q', '-b', 'main');
  git(d, 'add', '-A');
  git(d, 'commit', '-qm', 'init');
  return d;
}
const write = (root, rel, body) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};

// ── parsePorcelainZ (순수) ────────────────────────────────────────
test('parsePorcelainZ: rename의 원본 경로를 버리지 않는다', () => {
  // test-files.js의 parsePorcelain을 재사용하지 않는 이유가 이것이다 — 그건 도착 경로만
  // 남기는데, 원본이 정확히 B13(삭제·이름변경)이 요구하는 데이터다.
  const out = '## main...origin/main\0R  new.ts\0old.ts\0 M src/a.ts\0';
  const r = parsePorcelainZ(out);
  assert.equal(r.branch, 'main');
  const paths = r.entries.flatMap((e) => [e.path, e.from]).filter(Boolean);
  assert.ok(paths.includes('old.ts'), '원본 경로가 살아 있어야 한다');
  assert.ok(paths.includes('new.ts'));
  assert.ok(paths.includes('src/a.ts'));
});

test('parsePorcelainZ: 깨진 입력에도 throw하지 않는다', () => {
  for (const bad of [null, '', '\0\0', '## ']) {
    assert.doesNotThrow(() => parsePorcelainZ(bad), JSON.stringify(bad));
  }
});

// ── S1~S3 fail-open ───────────────────────────────────────────────
test('S1: git 레포가 아니면 전체 실행 (fail-open)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-nogit-'));
  tmpDirs.push(d);
  fs.writeFileSync(path.join(d, 'package.json'), '{}');
  const s = scopeFor(d, 'typecheck');
  assert.equal(s.run, true);
  assert.equal(s.mode, 'all');
});

test('S2: git 실행 실패해도 전체 실행 (fail-open)', () => {
  const root = makeRepo();
  const s = scopeFor(root, 'typecheck', { env: { PATH: '' } });
  assert.equal(s.run, true);
  assert.equal(s.mode, 'all');
});

test('S3: 변경 0건이면 skip이 아니라 전체 실행 (B22 — PLAN 역전)', () => {
  // 워킹트리가 깨끗한 건 "아무것도 안 했다"가 아니라 "내가 뭘 바꿨는지 볼 수 없다"이다.
  // 그 턴에 편집→커밋을 했다면 검증이 0회 돈다 — 깨진 커밋이 무검증으로 통과한다.
  // 실행해도 delta가 침묵을 책임지므로 출력은 여전히 0바이트다.
  const root = makeRepo();
  const s = scopeFor(root, 'typecheck');
  assert.equal(s.run, true);
  assert.equal(s.mode, 'all');
});

// ── S4~S6 확장자 판정 ─────────────────────────────────────────────
test('S4: 무관 확장자만 바뀌면 실행하지 않는다', () => {
  const root = makeRepo();
  write(root, 'README.md', '# hi\n');
  const s = scopeFor(root, 'typecheck');
  assert.equal(s.run, false);
});

test('S5: 소스가 바뀌면 scoped로 실행', () => {
  const root = makeRepo();
  write(root, 'src/a.ts', 'export const a = 2;\n');
  const s = scopeFor(root, 'typecheck');
  assert.equal(s.run, true);
  assert.equal(s.mode, 'scoped');
  assert.ok([...s.files].some((f) => f.endsWith('src/a.ts')));
});

test('S6: 모르는 확장자는 관련 있음으로 본다 (블랙리스트, 넓히는 쪽)', () => {
  const root = makeRepo();
  write(root, 'weird.foo', 'x');
  assert.equal(scopeFor(root, 'typecheck').run, true);
});

// ── S7~S9 ─────────────────────────────────────────────────────────
test('S7: rename의 원본 경로가 관심 집합에 들어간다 (B13)', () => {
  const root = makeRepo({ 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': "import './a';\n" });
  git(root, 'mv', 'src/a.ts', 'src/renamed.ts');
  const s = scopeFor(root, 'typecheck');
  const files = [...s.files].join('\n');
  assert.match(files, /src\/a\.ts/, '사라진 원본이 있어야 importer를 찾는다');
  assert.match(files, /src\/b\.ts/, '원본을 import하던 파일이 blast radius에 들어와야 한다');
});

test('S8: 공백·한글 경로가 안 깨진다 (-z를 쓰는 이유)', () => {
  const root = makeRepo();
  write(root, 'src/a b.ts', 'export const x = 1;\n');
  write(root, 'src/한글.ts', 'export const y = 1;\n');
  const files = [...scopeFor(root, 'typecheck').files];
  assert.ok(files.some((f) => f.includes('a b.ts')), `공백 경로: ${files}`);
  assert.ok(files.some((f) => f.includes('한글.ts')), `한글 경로: ${files}`);
});

test('S9: lint의 관심 집합은 blast radius가 아니라 변경 파일 그대로', () => {
  // 린트 규칙은 파일 로컬이다. 남의 파일 린트는 내 변경으로 안 바뀐다.
  const root = makeRepo({ 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': "import './a';\n" });
  write(root, 'src/a.ts', 'export const a = 2;\n');
  const s = scopeFor(root, 'lint');
  assert.equal([...s.files].filter((f) => f.endsWith('b.ts')).length, 0, 'importer가 들어오면 안 됨');
  assert.equal(s.files.size, 1);
});

// ── S10~S11 ───────────────────────────────────────────────────────
test('S10: node_modules를 스캔하지 않고, 상한을 넘으면 그래프를 포기한다', () => {
  const root = makeRepo({ 'src/a.ts': 'export const a=1;', 'src/b.ts': 'export const b=1;' });
  fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'index.ts'), 'export const x=1;');
  const scanned = scanSources(root, { maxFiles: 2000 });
  assert.equal(scanned.ok, true);
  assert.equal(scanned.files.some((f) => f.path.includes('node_modules')), false);

  // 부분 그래프는 절대 반환하지 않는다 — 조용히 좁히기 때문이다
  const tight = scanSources(root, { maxFiles: 1 });
  assert.equal(tight.ok, false);
  assert.equal(tight.reason, 'budget');
});

test('S10b: 상한 초과 시 scopeFor는 전체 실행으로 떨어진다', () => {
  const root = makeRepo({ 'src/a.ts': 'export const a=1;', 'src/b.ts': 'export const b=1;' });
  write(root, 'src/a.ts', 'export const a = 2;\n');
  const s = scopeFor(root, 'typecheck', { maxFiles: 1 });
  assert.equal(s.run, true);
  assert.equal(s.mode, 'all', '그래프를 못 만들면 좁히지 않는다');
});

test('S11: 브랜치명이 -b 헤더에서 나오고 detached에서도 throw하지 않는다', () => {
  const root = makeRepo();
  assert.equal(scopeFor(root, 'typecheck').branch, 'main');
  const sha = git(root, 'rev-parse', 'HEAD').trim();
  git(root, 'checkout', '-q', sha);
  assert.doesNotThrow(() => scopeFor(root, 'typecheck'));
  assert.ok(typeof scopeFor(root, 'typecheck').branch === 'string');
});

test('S12: 한 디렉터리 안에서도 예산을 지킨다 — 다 읽고 나서 포기하지 않는다', () => {
  // 예산 검사가 디렉터리 **사이**에만 있으면 결과(ok:false)는 같지만 3만 파일을 다 읽고
  // 나서야 포기한다(실측 11.2초 · RSS 1.28GB). 결과가 같으니 뮤테이션이 살아남았다 —
  // "언제 멈추는가"를 관측 가능하게 만들어야 계약이 잡힌다.
  const root = makeRepo();
  for (let i = 0; i < 50; i++) write(root, `src/f${i}.ts`, `export const f${i} = 1;`);
  const r = scanSources(root, { maxFiles: 5 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'budget');
  assert.ok(r.scanned <= 7, `상한 5인데 ${r.scanned}개를 읽었다 — 다 읽고 나서 포기한 것이다`);
});
