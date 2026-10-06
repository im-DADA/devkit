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

// ── G12: 200줄 래칫 — `hooks/`·`scripts/` 전체 (2026-10-02 REPORT) ──
// 🔴 RULES.md가 "파일이 200줄을 넘으면 분리"라고 못박아 뒀는데 **그 규칙을 지키는 단언이
//    없었다.** `S26`은 순수 3모듈만 보므로 `scripts/`에는 래칫이 없었고, 그래서
//    `scripts/list-models.mjs`가 135 → 209줄로 **상한을 넘는 동안 아무도 몰랐다**
//    (사이클 REPORT 단계에서 손으로 세다가 찾았다 — 규칙은 있는데 단언이 없는 모양이
//    이 사이클의 공허 ⑦·⑨와 같다).
//
// ⚠ **상한을 넘는 기존 파일은 지금 줄 수로 묶는다(래칫).** 줄일 수는 있고 늘릴 수는 없다 —
//    전부 당장 쪼개라고 하면 이 테스트가 처음부터 RED라 아무도 켜지 않는다. 숫자를 **올리는
//    방향으로 고치지 마라**: 그건 래칫을 푸는 것이고, 네 사이클을 이월한 분할이 다섯 번째로
//    이월된다는 뜻이다. 쪼개서 **지워라**.
const LIMIT = 200;
// ⚠ 줄 수는 `split('\n').length`로 센다 — `S26`과 **같은 관례**다(`wc -l`은 마지막
//    개행을 안 세서 1 적게 나온다. 두 관례를 섞으면 경계에서 하나가 거짓이 된다).
const GRANDFATHERED = {
  'hooks/session-start.js': 312,
  'hooks/lib/pdca-state.js': 284,
  'hooks/lib/verify-classify.js': 235,
  'hooks/lib/config-schema.js': 218,
};

test('G12: hooks와 scripts의 모든 실행 파일이 200줄 이내이고 이월 파일은 더 자라지 않는다', () => {
  const root = path.join(dir, '..');
  const walk = (rel, out = []) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r, out);
      else if (/\.m?js$/.test(e.name)) out.push(r);
    }
    return out;
  };
  const files = [...walk('hooks'), ...walk('scripts')];
  assert.ok(files.length >= 50, `대상 파일이 ${files.length}개뿐이다 — 탐색이 깨졌다`);
  const over = [];
  for (const rel of files) {
    const lines = fs.readFileSync(path.join(root, rel), 'utf8').split('\n').length;
    const cap = GRANDFATHERED[rel] ?? LIMIT;
    if (lines > cap) over.push(`${rel}: ${lines}줄 (상한 ${cap})`);
  }
  assert.deepEqual(over, [], `200줄 상한을 넘었다 — 쪼개라(숫자를 올리지 마라):\n  ${over.join('\n  ')}`);
  // 이월 목록이 **낡지 않게** 한다 — 쪼개서 상한 아래로 내려온 파일은 목록에서 빼야 한다.
  // 안 빼면 그 파일이 다시 자라도 옛 상한까지 허용된다(래칫이 조용히 풀린다).
  for (const [rel, cap] of Object.entries(GRANDFATHERED)) {
    assert.ok(fs.existsSync(path.join(root, rel)), `이월 목록의 ${rel}이 없다 — 목록에서 빼라`);
    const lines = fs.readFileSync(path.join(root, rel), 'utf8').split('\n').length;
    assert.ok(lines > LIMIT,
      `${rel}이 ${lines}줄로 200 이내가 됐다 — GRANDFATHERED에서 빼라(안 빼면 ${cap}줄까지 다시 자란다)`);
  }
});
