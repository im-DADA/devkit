// 역방향 import 그래프. **순수층** — 파일 내용을 주입받고 fs를 require하지 않는다.
//
// ★ 핵심 설계: 그래프 키가 **파일이 아니라 확장자를 뗀 모듈 경로**다.
// 삭제된 파일의 내용은 애초에 필요 없다 — 필요한 건 "누가 그것을 import했나"이고,
// 그 정보는 살아 있는 importer들의 import 문 안에 그대로 있다. 대상을 디스크에 존재하는
// 파일로 resolve해서 키를 잡으면 대상이 사라질 때 엣지가 증발하는데, 파일이 사라졌을 때가
// 정확히 importer가 깨지는 대표 케이스다. 모듈 경로로 키잉하면 그 문제가 사라진다.
//
// 관통 원칙: **모르면 넓힌다.** 못 푸는 import를 가진 파일은 모든 blast radius에 들어간다.
// 좁혀서 틀리면 진짜 회귀를 숨기고, 넓혀서 틀리면 줄 몇 개 더 보일 뿐이다.
// 설계 근거: docs/2026-08-12-scoped-verification/DESIGN.md 결정 8·9·10·11
const { builtinModules } = require('node:module');

const BUILTINS = new Set(builtinModules);
const EXT = /\.(d\.ts|[cm]?[jt]sx?)$/;

const STATIC_IMPORT = /(?:^|[\s;}])(?:import|export)\s[^;'"]*?from\s*['"]([^'"]+)['"]/g;
const BARE_IMPORT = /(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g;
const REQUIRE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const DYNAMIC_LITERAL = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const DYNAMIC_EXPR = /\bimport\s*\(\s*(?!['"])[^)]/;

/** root 기준 상대 POSIX 경로에서 확장자를 뗀다. `src/a.ts` → `src/a` */
function moduleKey(p) {
  if (typeof p !== 'string') return '';
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(EXT, '');
}

/** `a/b/../c` → `a/c`. path 모듈 없이(순수 유지) */
function normalize(p) {
  const out = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

function extractImports(content) {
  const text = typeof content === 'string' ? content : '';
  const specifiers = new Set();
  for (const re of [STATIC_IMPORT, BARE_IMPORT, REQUIRE, DYNAMIC_LITERAL]) {
    re.lastIndex = 0;
    let m = re.exec(text);
    while (m) {
      specifiers.add(m[1]);
      m = re.exec(text);
    }
  }
  return { specifiers: [...specifiers], hasDynamic: DYNAMIC_EXPR.test(text) };
}

/** `@/*` 형태의 단일 타깃 매핑만 시도한다. 다중 타깃·와일드카드 없음은 미해석(좁히지 않는다) */
function applyPaths(spec, paths) {
  if (!paths || typeof paths !== 'object') return null;
  for (const [pattern, targets] of Object.entries(paths)) {
    if (!Array.isArray(targets) || targets.length !== 1) continue;
    if (!pattern.endsWith('/*') || !targets[0].endsWith('/*')) continue;
    const head = pattern.slice(0, -1); // '@/'
    if (!spec.startsWith(head)) continue;
    return normalize(`${targets[0].slice(0, -1)}${spec.slice(head.length)}`);
  }
  return null;
}

/**
 * @param {{path:string, content:string}[]} files
 * @param {{packages?:Set<string>, paths?:object}} opts
 *   packages = node_modules에 실재하는 패키지 이름(주입 — fs를 안 쓰기 위해)
 * @returns {{importers:Map<string,Set<string>>, unresolved:Set<string>, stats:object}}
 */
function buildImporters(files, opts = {}) {
  const list = Array.isArray(files) ? files : [];
  const packages = opts.packages instanceof Set ? opts.packages : new Set();
  const known = new Set(list.map((x) => moduleKey(x && x.path)));
  const importers = new Map();
  const unresolved = new Set();
  let edges = 0;

  const add = (key, importer) => {
    if (!importers.has(key)) importers.set(key, new Set());
    importers.get(key).add(importer);
    edges += 1;
  };

  for (const file of list) {
    if (!file || typeof file.path !== 'string') continue;
    const from = file.path.replace(/\\/g, '/');
    const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
    const { specifiers, hasDynamic } = extractImports(file.content);
    if (hasDynamic) unresolved.add(from); // 원리적으로 못 푼다 → 넓힌다

    for (const spec of specifiers) {
      if (spec.startsWith('node:') || BUILTINS.has(spec)) continue;
      if (spec.startsWith('.')) {
        // ⚠ 디스크 존재를 확인하지 않는다 — 그게 삭제 파일을 살리는 지점이다.
        const target = moduleKey(normalize(dir ? `${dir}/${spec}` : spec));
        add(target, from);
        add(`${target}/index`, from); // './a'가 'a/index.ts'를 가리킬 수 있다
        continue;
      }
      const mapped = applyPaths(spec, opts.paths);
      if (mapped && known.has(moduleKey(mapped))) {
        add(moduleKey(mapped), from);
        continue;
      }
      if (packages.has(spec.split('/')[0])) continue; // 실재 패키지
      unresolved.add(from); // alias일 텐데 못 푼다 → 넓힌다
    }
  }
  return { importers, unresolved, stats: { files: list.length, edges, unresolved: unresolved.size } };
}

/**
 * 전이 폐포 + 미해석 importer 전부.
 * ⚠ 깊이를 자르지 않는다. `types.ts`를 고쳐 폐포가 레포 대부분이 되면 **그게 진짜
 * blast radius**다. 1~2단계로 자르면 3단계 떨어진 진짜 깨짐을 숨긴다 — 좁혀서 틀리는 쪽이고
 * 이 사이클에서 가장 비싼 실패다. 규모 상한은 호출부의 스캔 예산이 이미 잡는다.
 */
function blastRadius(changedPaths, graph) {
  const changed = Array.isArray(changedPaths) ? changedPaths : [];
  const importers = graph && graph.importers instanceof Map ? graph.importers : new Map();
  const out = new Set();
  const queue = [];

  for (const p of changed) {
    if (typeof p !== 'string') continue;
    const norm = p.replace(/\\/g, '/');
    out.add(norm);
    queue.push(moduleKey(norm));
  }

  const visitedKeys = new Set();
  while (queue.length) {
    const key = queue.shift();
    if (visitedKeys.has(key)) continue; // 순환 종료
    visitedKeys.add(key);
    for (const importer of importers.get(key) || []) {
      if (out.has(importer)) continue;
      out.add(importer);
      queue.push(moduleKey(importer));
    }
  }

  if (out.size && graph && graph.unresolved instanceof Set) {
    for (const u of graph.unresolved) out.add(u);
  }
  return out;
}

module.exports = { moduleKey, extractImports, buildImporters, blastRadius };
