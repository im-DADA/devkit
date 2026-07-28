// evidence 적합성 보고 — ref 실존 · receipt 인용 · 커버리지 3층을 조합해 출력한다.
// 실행: node "${CLAUDE_PLUGIN_ROOT}/scripts/verify-evidence.mjs" [--cycle <dir>] [--lcov <path>] [--json]
//   (플러그인 안에 있는 스크립트다 — 프로젝트 상대경로로 부르면 MODULE_NOT_FOUND)
//
// ★ exit code는 어떤 상황에도 0이다. 이건 보고 도구다 — 차단은 pdca-gate 훅만 한다.
//   unresolved>0을 exit 1로 만들면 gap-detector의 Bash 호출이 실패로 보이고,
//   "보고 도구가 작업을 막는다"는 역할 혼선이 생긴다(DESIGN §6.2-5).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  formatHuman, toJson, field, emit,
} from './lib/report-format.mjs';

const require = createRequire(import.meta.url);
// 이 도구가 안내하는 명령은 **자기 자신의 실제 경로**여야 한다. 상대경로를 찍으면 남의
// 프로젝트에서 복붙한 순간 MODULE_NOT_FOUND다 — 도구가 낸 안내가 도구를 죽인다.
// ⚠ 여기에 `${CLAUDE_PLUGIN_ROOT}` 리터럴을 쓰면 안 된다. 이 문자열을 받는 것은 프롬프트
//   렌더러가 아니라 Bash이고 그 환경에 그 변수는 없다 — 치환은 렌더 시점에만 일어난다.
const SELF = fileURLToPath(import.meta.url);
const lib = path.join(path.dirname(SELF), '..', 'hooks', 'lib');
const { findProjectRoot } = require(path.join(lib, 'project-root.js'));
const { readState } = require(path.join(lib, 'pdca-state.js'));
const { readBehaviors, effectivePasses } = require(path.join(lib, 'behaviors.js'));
const { classifyRef } = require(path.join(lib, 'evidence.js'));
const { readReceipts } = require(path.join(lib, 'receipt.js'));
const { checkCitation } = require(path.join(lib, 'citation.js'));
const { parseLcov, classifyTarget } = require(path.join(lib, 'lcov.js'));
const { warn } = require(path.join(lib, 'diag.js'));

// 열린질문 ②: /gap이 다중 리포터로 여기에 lcov를 떨어뜨린다. 관례를 코드에 박아
// --lcov 배선이 한 군데 빠져도 커버리지 층이 조용히 죽지 않게 한다.
const DEFAULT_LCOV = path.join('.devkit', 'lcov.info');

/**
 * lcov 부재는 정상 경로다(커버리지를 안 돌린 사이클). 그 외 에러는 원문을 남기고 degrade.
 * ★ present를 같이 낸다 — 예전엔 빈 문자열로 뭉개서 "커버리지가 돌아 전부 covered"와
 *   "아예 안 돌렸다"의 출력이 완전히 같았다(PLAN 실측 ④). 조용한 degrade를 보고 표면으로 올린다.
 */
function readLcov(p) {
  try {
    return { text: fs.readFileSync(p, 'utf8'), present: true };
  } catch (e) {
    if (e.code !== 'ENOENT') warn(`lcov 읽기 실패 (${p}): ${e.message}`);
    return { text: '', present: false };
  }
}

function parseArgs(argv) {
  const opts = { cycle: null, lcov: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--json') opts.json = true;
    else if (argv[i] === '--cycle' || argv[i] === '--lcov') {
      opts[argv[i].slice(2)] = argv[i + 1] ?? null;
      i += 1;
    }
  }
  return opts;
}

/** --cycle > pdca-state.json의 cycleId. 못 정하면 null (안내 후 정상 종료) */
function resolveCycleDir(opts, root) {
  if (opts.cycle) return path.resolve(root, opts.cycle);
  const state = readState(root);
  if (state && typeof state.cycleId === 'string' && state.cycleId !== '') {
    return path.join(root, 'docs', state.cycleId);
  }
  return null;
}

const opts = parseArgs(process.argv.slice(2));
// cwd 기준 root는 "어느 사이클을 볼지" 정하는 데만 쓴다 — --cycle 상대경로와
// .devkit/pdca-state.json은 명령을 실행한 곳을 기준으로 찾는 게 맞다.
const cwdRoot = findProjectRoot(process.cwd());
const cycleDir = resolveCycleDir(opts, cwdRoot);

// stdout은 emit 하나로만 나간다 — 형태 규칙(lib/emit.mjs)이 걸리는 유일한 출구다.
// 이 안내 블록은 일부러 손으로 손보지 않았다: 자동 교정이 실제로 도는지가 여기서 드러난다.
if (cycleDir === null) {
  emit(
    'evidence 검증 — 대상 사이클을 정하지 못했다.\n'
    + '  .devkit/pdca-state.json이 없거나 cycleId가 비어 있다.\n'
    + `  사이클 폴더를 직접 지정: node "${SELF}" --cycle docs/{사이클폴더}\n`,
  );
  process.exit(0);
}

// ★ 판정 root는 게이트(pdca-gate.js:43)와 **같은 근거**로 산정한다 — findProjectRoot(cycleDir).
// cwd 기준으로 잡으면 워크스페이스 패키지가 자기 package.json을 가질 때 두 값이 갈려
// "CLI는 unresolved 0인데 REPORT.md는 차단"되는 원인 불명 데드락이 난다(DESIGN 설계원칙 6).
const root = findProjectRoot(cycleDir);

// field()를 통과시킨다 — cycleId는 위조자 통제 필드고(pdca-state.json은 파일이다),
// 아래 조기 종료 출구는 formatHuman을 안 거친다. cycleId에 개행을 심으면 이 헤더가
// 그대로 대조 후보 줄을 낸다(벡터 A, 실측).
// (2026-07-27: 원래 근거였던 `detick` 방벽은 제거됐다 — 지금 그 자리를 `emit`의 형태
//  강제가 대신한다. field() 통과가 필요하다는 결론은 그대로다.)
const rel = (p) => field(path.relative(root, p).split(path.sep).join('/'));
const doc = readBehaviors(cycleDir);

if (doc === null) {
  emit(
    `evidence 검증 — ${rel(cycleDir)}/\n`
    + '  behaviors.json이 없거나 읽을 수 없다 — 판정할 대상이 없다.\n'
    + '  behavior 목록은 /plan 단계에서 만든다.\n',
  );
  process.exit(0);
}

const receipts = readReceipts(root);
const lcovPath = path.resolve(root, opts.lcov ?? DEFAULT_LCOV);
const lcovFile = readLcov(lcovPath);
const cov = parseLcov(lcovFile.text, root);

// ref 층의 분모는 게이트(gateEvidence)와 정확히 같다 — passes:true + evidence 유효.
// 분모가 다르면 "unresolved 0이라는데 왜 막히나"가 생긴다(DESIGN 설계원칙 6).
const rows = doc.behaviors.map((b) => {
  const ev = (b && typeof b === 'object') ? b.evidence : null;
  return {
    id: (b && b.id) || '?',
    ref: (ev && typeof ev.ref === 'string') ? ev.ref : null,
    refResult: effectivePasses(b) ? classifyRef(ev.ref, root) : null,
    cite: checkCitation(ev, receipts),
    target: (b && typeof b.target === 'string') ? b.target : null,
    cov: classifyTarget(cov, b && b.target),
  };
});

const refIs = (s) => rows.filter((r) => r.refResult !== null && r.refResult.status === s);
const citeIs = (s) => rows.filter((r) => r.cite.status === s);
const covIs = (s) => rows.filter((r) => r.cov.status === s);
const unresolved = refIs('unresolved');
const uncited = citeIs('uncited');
const noReceipt = citeIs('no-receipt');
// "그 명령을 안 돌렸다"는 uncited(진짜 불일치)와도, no-receipt(소급 불가)와도 조치가 다르다
const noCmdMatch = citeIs('no-cmd-match');
const drifted = rows.filter((r) => r.refResult !== null && r.refResult.lineDrift.length > 0);
const viaArchive = rows.flatMap((r) => (r.refResult === null ? [] : Object.keys(r.refResult.via)
  .filter((p) => r.refResult.via[p] === 'archive')
  .map((p) => ({ id: r.id, from: p }))));
const uncovered = covIs('uncovered');
const deadBranch = covIs('dead-branch');
const noData = covIs('no-data');

const counts = {
  total: rows.length,
  evaluated: rows.filter((r) => r.refResult !== null).length,
  unresolved: unresolved.length,
  uncited: uncited.length,
  noCmdMatch: noCmdMatch.length,
  noReceipt: noReceipt.length,
  uncovered: uncovered.length,
  deadBranch: deadBranch.length,
  noData: noData.length,
  lineDrift: drifted.length,
  viaArchive: viaArchive.length,
};

const view = {
  cycle: rel(cycleDir),
  lcov: rel(lcovPath),
  lcovPresent: lcovFile.present,
  counts,
  rows,
  receipts,
  groups: {
    unresolved, uncited, noCmdMatch, noReceipt, deadBranch, uncovered, drifted, viaArchive,
  },
};

if (opts.json) {
  // 무들여쓰기 — 들여쓰면 각 줄이 `"id": "…",` 형태라 위조자 통제 값이 그대로 한 줄이 되고
  // 그 줄은 대조 후보가 된다. 한 줄이면 toJson의 상수 필드가 SEP를 실어 형태 규칙을 만족한다.
  emit(JSON.stringify(toJson(view)) + '\n');
  process.exit(0);
}
emit(formatHuman(view));
