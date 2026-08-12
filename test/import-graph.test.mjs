// import-graph.js — 역방향 import 그래프. **순수층**(파일 내용은 주입받는다).
// (docs/2026-08-12-scoped-verification/ G1~G11)
//
// 이 파일의 핵심은 G5다. 그래프 키를 "디스크에 존재하는 파일"이 아니라 **확장자를 뗀
// 모듈 경로**로 잡기 때문에, 삭제된 파일로 조회해도 importer가 나온다. 삭제 파일 처리가
// 특수 케이스가 아니라 불변식이 되는 자리다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.join(dir, '..', 'hooks', 'lib', 'import-graph.js');
const { moduleKey, extractImports, buildImporters, blastRadius } =
  createRequire(import.meta.url)(modPath);

/** 파일 목록을 주입해 그래프를 만든다. packages는 node_modules에 실재하는 패키지 이름 */
const graphOf = (files, opts = {}) => buildImporters(files, { packages: new Set(), ...opts });
const f = (p, content) => ({ path: p, content });
const radius = (changed, g) => [...blastRadius(changed, g)].sort();

test('G1: a ← b ← c 전이 (a 변경 시 b·c 모두)', () => {
  const g = graphOf([
    f('src/a.ts', 'export const a = 1;'),
    f('src/b.ts', "import { a } from './a';"),
    f('src/c.ts', "import { b } from './b';"),
    f('src/z.ts', 'export const z = 1;'),
  ]);
  assert.deepEqual(radius(['src/a.ts'], g), ['src/a.ts', 'src/b.ts', 'src/c.ts']);
});

test('G2: 순환 import에서 종료하고 둘 다 포함', () => {
  const g = graphOf([
    f('src/a.ts', "import './b';"),
    f('src/b.ts', "import './a';"),
  ]);
  assert.deepEqual(radius(['src/a.ts'], g), ['src/a.ts', 'src/b.ts']);
});

test('G3: 동적 import가 있는 파일은 모든 blast radius에 포함된다', () => {
  // 원리적으로 못 푼다 → 좁히지 않고 넓힌다. 좁혀서 틀리면 진짜 회귀를 숨긴다.
  const g = graphOf([
    f('src/a.ts', 'export const a = 1;'),
    f('src/dyn.ts', 'const m = await import(name);'),
  ]);
  assert.ok(radius(['src/a.ts'], g).includes('src/dyn.ts'));
  assert.ok(radius(['src/totally-unrelated.ts'], g).includes('src/dyn.ts'));
});

test('G4: node_modules에 없는 bare specifier(@/x)를 가진 파일도 항상 포함', () => {
  const g = graphOf([
    f('src/a.ts', 'export const a = 1;'),
    f('src/aliased.ts', "import x from '@/lib/thing';"),
  ]);
  assert.ok(radius(['src/a.ts'], g).includes('src/aliased.ts'));
});

test('G5: 삭제된 파일로 조회해도 importer가 나온다 (B13 핵심)', () => {
  // src/a.ts는 파일 목록에 **없다**(삭제됨). 그래도 b.ts가 그것을 import한다는 사실은
  // 살아 있는 b.ts 안에 그대로 있다. 그래프 키가 모듈 경로라 조회가 성립한다.
  const g = graphOf([f('src/b.ts', "import { a } from './a';")]);
  assert.deepEqual(radius(['src/a.ts'], g), ['src/a.ts', 'src/b.ts']);
});

test('G6: rename의 원본 경로로도 importer가 나온다', () => {
  const g = graphOf([f('src/b.ts', "import './old-name';")]);
  assert.ok(radius(['src/old-name.ts', 'src/new-name.ts'], g).includes('src/b.ts'));
});

test('G7: ./a · ./a.js · ./a/index 가 같은 모듈 키 계열로 맞는다', () => {
  assert.equal(moduleKey('src/a.ts'), moduleKey('src/a.tsx'));
  assert.equal(moduleKey('src/a.ts'), moduleKey('src/a.js'));
  assert.equal(moduleKey('src/a.d.ts'), 'src/a');
  // ESM 관례: .js로 쓰고 .ts로 해석 — 확장자를 떼므로 자동으로 맞는다
  const g = graphOf([
    f('src/a.ts', 'export const a = 1;'),
    f('src/b.ts', "import './a.js';"),
    f('src/c.ts', "import './a/index';"),
  ]);
  assert.ok(radius(['src/a.ts'], g).includes('src/b.ts'));
  const gi = graphOf([
    f('src/a/index.ts', 'export const a = 1;'),
    f('src/d.ts', "import './a';"),
  ]);
  assert.ok(radius(['src/a/index.ts'], gi).includes('src/d.ts'), 'index 파일은 두 키로 등록된다');
});

test('G8: node_modules에 실재하는 패키지는 엣지도 미해석도 만들지 않는다', () => {
  const g = graphOf(
    [f('src/b.ts', "import React from 'react';\nimport fs from 'node:fs';")],
    { packages: new Set(['react']) },
  );
  assert.equal(g.unresolved.size, 0, '실재 패키지·builtin은 미해석이 아니다');
  assert.deepEqual(radius(['src/a.ts'], g), ['src/a.ts']);
});

test('G9: paths 매핑은 후보가 실재할 때만 엣지, 아니면 미해석', () => {
  const files = [
    f('src/lib/thing.ts', 'export const t = 1;'),
    f('src/b.ts', "import x from '@/lib/thing';"),
    f('src/c.ts', "import y from '@/nope/missing';"),
  ];
  const g = graphOf(files, { paths: { '@/*': ['./src/*'] } });
  assert.ok(radius(['src/lib/thing.ts'], g).includes('src/b.ts'), '실재하면 엣지');
  assert.ok(g.unresolved.has('src/c.ts'), '못 푸는 후보는 미해석 → 항상 포함');
});

test('G9b: paths 다중 타깃은 매핑하지 않는다 (반쯤 맞는 해석은 조용히 좁힌다)', () => {
  const g = graphOf(
    [f('src/lib/t.ts', ''), f('src/b.ts', "import x from '@/lib/t';")],
    { paths: { '@/*': ['./src/*', './other/*'] } },
  );
  assert.ok(g.unresolved.has('src/b.ts'));
});

test('G10: changed가 비면 빈 집합 (실행 스킵을 뜻하지 않는다 — 그건 scopeFor 계약)', () => {
  const g = graphOf([f('src/a.ts', '')]);
  assert.deepEqual(radius([], g), []);
});

test('G11: import-graph.js는 fs를 require하지 않는다', () => {
  const src = fs.readFileSync(modPath, 'utf8');
  assert.doesNotMatch(src, /require\(['"]node:fs['"]\)/);
  assert.doesNotMatch(src, /require\(['"]node:child_process['"]\)/);
});

test('extractImports: import·export from·require·동적 import를 모두 잡는다', () => {
  const r = extractImports([
    "import a from './a';",
    "import type { T } from './t';",
    "export { x } from './x';",
    "export * from './star';",
    "const r = require('./r');",
    "const d = await import('./d');",
    'const dyn = await import(variable);',
  ].join('\n'));
  assert.deepEqual(
    r.specifiers.sort(),
    ['./a', './d', './r', './star', './t', './x'],
  );
  assert.equal(r.hasDynamic, true, '변수 동적 import를 표시해야 함');
});

test('어떤 입력에도 throw하지 않는다', () => {
  assert.doesNotThrow(() => extractImports(null));
  assert.doesNotThrow(() => buildImporters(null));
  assert.doesNotThrow(() => blastRadius(null, null));
  assert.doesNotThrow(() => blastRadius(['a.ts'], graphOf([])));
  assert.equal(moduleKey(null), '');
});
