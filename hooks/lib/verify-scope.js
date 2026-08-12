// 무엇이 바뀌었나(git) + 무엇을 볼까(그래프). IO 경계 — 판정은 import-graph.js(순수)가 한다.
//
// ⚠ 변경 목록이 **비어 있어도 실행한다.** 워킹트리가 깨끗한 건 "아무것도 안 했다"가 아니라
// "내가 무엇을 바꿨는지 볼 수 없다"이다. 그 턴에 편집→커밋을 했다면 검증이 0회 돌아
// 깨진 커밋이 무검증·무보고로 통과한다. 실행해도 delta가 침묵을 책임지므로 출력은 0바이트다.
// 설계 근거: docs/2026-08-12-scoped-verification/DESIGN.md 결정 8·9·10·12
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildImporters, blastRadius } = require('./import-graph');

// 화이트리스트가 아니라 **블랙리스트**다 — 모르는 확장자는 관련 있음으로 본다(넓히는 쪽).
// .mdx는 tsc가 볼 수 있으므로 무관 목록에서 뺐다.
const IRRELEVANT = new Set([
  '.md', '.txt', '.csv', '.log', '.pdf',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.avif',
]);
const SOURCE_EXT = /\.[cm]?[jt]sx?$/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.devkit']);
const BUDGET = { maxFiles: 2000, maxMs: 1500, maxBytes: 512 * 1024 };

/**
 * `git status --porcelain=v1 -z -b` 파싱.
 * ⚠ test-files.js의 `parsePorcelain`을 재사용하지 않는다: 그건 공백 구분 텍스트 모드이고
 * rename의 **원본 경로를 의도적으로 버린다**. 그 원본이 정확히 B13이 요구하는 데이터다.
 */
function parsePorcelainZ(out) {
  const result = { branch: '', entries: [] };
  if (typeof out !== 'string' || !out) return result;
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (!rec) continue;
    if (rec.startsWith('## ')) {
      result.branch = rec.slice(3).split('...')[0].trim();
      continue;
    }
    if (rec.length < 4) continue;
    const x = rec[0];
    const y = rec[1];
    const p = rec.slice(3);
    // rename/copy는 다음 레코드가 원본 경로다
    const renamed = x === 'R' || x === 'C' || y === 'R' || y === 'C';
    const from = renamed ? parts[++i] || null : null;
    result.entries.push({ x, y, path: p, from });
  }
  return result;
}

function gitStatus(root, env) {
  const r = spawnSync('git', ['status', '--porcelain=v1', '-z', '-b'], {
    cwd: root, encoding: 'utf8', timeout: 5000,
    env: env ? { ...process.env, ...env } : process.env,
  });
  if (r.error || r.status !== 0) return null; // fail-open — 호출부가 전체 실행으로 간다
  return parsePorcelainZ(r.stdout);
}

/** 소스 파일을 읽어 그래프 입력으로. **부분 결과를 절대 반환하지 않는다** — 조용히 좁히기 때문이다 */
function scanSources(root, opts = {}) {
  const maxFiles = opts.maxFiles ?? BUDGET.maxFiles;
  const maxMs = opts.maxMs ?? BUDGET.maxMs;
  const started = Date.now();
  const files = [];
  const stack = [root];

  while (stack.length) {
    if (files.length > maxFiles || Date.now() - started > maxMs) {
      return { ok: false, reason: 'budget', files: [] };
    }
    let entries;
    try {
      entries = fs.readdirSync(stack.pop(), { withFileTypes: true });
    } catch {
      continue; // 못 읽는 디렉터리는 건너뛴다(권한 등)
    }
    for (const e of entries) {
      const full = path.join(e.parentPath || e.path, e.name);
      if (e.isSymbolicLink()) continue; // 루트 이탈·순환 방지
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(full);
        continue;
      }
      if (!e.isFile() || !SOURCE_EXT.test(e.name)) continue;
      try {
        if (fs.statSync(full).size > BUDGET.maxBytes) continue;
        files.push({
          path: path.relative(root, full).replace(/\\/g, '/'),
          content: fs.readFileSync(full, 'utf8'),
        });
      } catch {
        continue;
      }
    }
  }
  if (files.length > maxFiles) return { ok: false, reason: 'budget', files: [] };
  return { ok: true, files };
}

const readJson = (p) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
};

function installedPackages(root) {
  try {
    return new Set(fs.readdirSync(path.join(root, 'node_modules')));
  } catch {
    return new Set();
  }
}

/**
 * @returns {{run:boolean, files:Set<string>, mode:'all'|'scoped', reason:string, branch:string}}
 */
function scopeFor(root, kind, opts = {}) {
  const all = (reason, branch = '') => ({ run: true, files: new Set(), mode: 'all', reason, branch });

  const status = gitStatus(root, opts.env);
  if (!status) return all('no-git');
  const branch = status.branch;

  const changed = [];
  for (const e of status.entries) {
    changed.push(e.path);
    if (e.from) changed.push(e.from); // 사라진 원본이 있어야 importer를 찾는다(B13)
  }
  // ⚠ 우리 산출물(.devkit/)은 **아예 안 보이는 것**으로 다룬다. baseline·락·tsbuildinfo가
  // 생기면 git status에 untracked로 잡히는데, 그걸 소스 변경으로 읽으면 **우리가 우리를
  // 깨우는** 루프가 된다(.md 한 줄만 고친 턴에도 타입체크가 돈다).
  // '무관한 변경'으로 세면 안 된다 — 그러면 .devkit만 바뀐 턴이 skip으로 떨어져
  // 검증이 통째로 멈춘다. 걸러낸 **뒤에** 변경 유무를 판단한다.
  const visible = changed.filter((p) => p !== '.devkit' && !p.startsWith('.devkit/'));
  if (!visible.length) return all('no-change', branch); // ⚠ skip이 아니다 — 상단 주석 참조

  const relevant = visible.filter((p) => !IRRELEVANT.has(path.extname(p).toLowerCase()));
  if (!relevant.length) {
    return { run: false, files: new Set(), mode: 'scoped', reason: 'no-relevant-change', branch };
  }

  // 린트 규칙은 파일 로컬이라 importer를 끌어올 이유가 없다.
  if (kind === 'lint') {
    return { run: true, files: new Set(relevant), mode: 'scoped', reason: 'changed-only', branch };
  }

  const scan = scanSources(root, opts);
  if (!scan.ok) return all('scan-budget', branch); // 그래프를 못 만들면 좁히지 않는다

  const tsconfig = readJson(path.join(root, 'tsconfig.json'));
  const graph = buildImporters(scan.files, {
    packages: installedPackages(root),
    paths: tsconfig && tsconfig.compilerOptions && tsconfig.compilerOptions.paths,
  });
  return {
    run: true,
    files: blastRadius(relevant, graph),
    mode: 'scoped',
    reason: 'blast-radius',
    branch,
    graph: graph.stats,
  };
}

module.exports = { parsePorcelainZ, scanSources, scopeFor, IRRELEVANT, BUDGET };
