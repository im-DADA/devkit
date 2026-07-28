// 호출 경로 계약 — "devkit 밖 프로젝트에서 도는가". verify-evidence.test.mjs와 분리한 이유:
// 거기 265개는 CLI 절대경로를 **테스트가 직접 조립**해서 spawn한다. 그래서 문서가 무슨 경로를
// 지시하든 영향받지 않았고, 상대경로 결함이 3사이클을 살아남았다(DESIGN §2.1).
// 여기서는 반대로 간다 — **문서/출력에 적힌 문자열을 뽑아 그대로 실행한다.**
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(dir, '..');
const read = (p) => fs.readFileSync(path.join(repoRoot, p), 'utf8');

const tmpDirs = [];
function makeRoot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-invoke-'));
  fs.mkdirSync(path.join(d, '.git')); // findProjectRoot가 여기를 루트로 잡게 한다
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

const CYCLE = '2026-07-27-invoke';
function writeCycle(root) {
  const cycle = path.join(root, 'docs', CYCLE);
  fs.mkdirSync(cycle, { recursive: true });
  fs.writeFileSync(path.join(cycle, 'behaviors.json'), JSON.stringify({
    version: 1,
    cycleId: CYCLE,
    behaviors: [{ id: 'X1', desc: 'dummy', priority: 'P1', passes: false, evidence: null }],
  }));
  return cycle;
}

// ⚠ NODE_TEST_CONTEXT를 물려주면 손자 프로세스가 v8 직렬화 보고 모드로 붙어 stdout이
// 통째로 사라지는데도 exit=0이 난다(verify-evidence.test.mjs가 같은 함정을 기록해 뒀다).
function env() {
  const e = { ...process.env };
  delete e.NODE_TEST_CONTEXT;
  return e;
}

// 셸로 넘기기 전 검사. **허용 형태를 열거하지 않는다** — 1회차 처방이 그랬다가 양방향으로 틀렸다:
// `[^"]`가 `$`·백틱을 허용해 `node "/$(touch …)/…/verify-evidence.mjs"`가 통과했고(bash는 큰따옴표
// 안에서도 `$( )`를 전개한다 — 실측), 동시에 이 도구가 **스스로 안내하는** `--cycle docs/{사이클폴더}`와
// 방금 정당하다고 인정한 `node --no-warnings …`를 거부했다(REVIEW 2회차 🔴·🟡4).
//
// 대신 **전개 후 불변식**을 쓴다: expand()가 ${CLAUDE_PLUGIN_ROOT}를 이미 치환했으므로 정직한 명령에는
// 셸이 더 해석할 것이 남아 있지 않다. 남아 있으면 그건 문서가 셸을 부리려는 것이다.
// 열거가 아니라 형태라서 인자·플래그·경로가 어떻게 늘어도 안 깨진다.
const SHELL_META = /[$`\;&|<>()\n]/;

/** 문서/출력에서 뽑은 명령 문자열을 **셸에** 그대로 넘긴다 — 조립하지 않는 것이 이 파일의 요점 */
const sh = (cmd, cwd) => spawnSync(cmd, {
  shell: true, cwd, encoding: 'utf8', env: env(),
});

/** 하네스가 프롬프트 렌더 시점에 하는 일을 흉내낸다. 하네스가 실제로 치환한다는 명제는
 *  이 테스트가 주장하지 않는다(DESIGN §2.4 · §8-1) — 치환된 뒤 도는가만 주장한다. */
const expand = (s) => s.replaceAll('${CLAUDE_PLUGIN_ROOT}', repoRoot);

const noModuleError = (r) => {
  assert.doesNotMatch(
    `${r.stdout}${r.stderr}`,
    /MODULE_NOT_FOUND|Cannot find module/,
    `devkit 밖에서 모듈을 못 찾았다:\n${r.stdout}\n${r.stderr}`,
  );
};

function writeState(root) {
  fs.mkdirSync(path.join(root, '.devkit'), { recursive: true });
  fs.writeFileSync(path.join(root, '.devkit', 'pdca-state.json'), JSON.stringify({
    version: 1, cycleId: CYCLE, stage: 'gap', status: 'in-progress',
  }));
}

/** 문서에 적힌 "이걸 실행하라"는 줄만 뽑는다. 산문 속 파일명 언급은 대상이 아니다. */
const execLines = (src) => src.split('\n')
  .filter((l) => /^\s*node\s+.*verify-evidence\.mjs/.test(l))
  .map((l) => l.trim());

// 검증 명령을 **지시하는** 문서. 여기 적힌 문자열이 남의 프로젝트에서 그대로 실행된다.
const EXEC_DOCS = ['commands/gap.md', 'agents/gap-detector.md'];

// ── B1: 문서에 적힌 명령이 devkit 밖에서 실제로 돈다 ─────────────────
// 3사이클 동안 안 잡힌 이유는 devkit 레포에서 상대경로가 우연히 맞기 때문이다.
// cwd를 임시 root로 옮기는 것 하나로 그 우연이 무력화된다.
test('B1: 문서의 검증 명령이 플러그인 경로 치환 후 devkit 밖 프로젝트에서 실행된다', () => {
  const root = makeRoot();
  writeCycle(root);
  writeState(root);

  let n = 0;
  for (const d of EXEC_DOCS) {
    const lines = execLines(read(d));
    assert.ok(lines.length >= 1, `${d}: 검증 명령 줄을 못 찾았다 — 0건이면 무검사다`);
    for (const raw of lines) {
      n += 1;
      const cmd = expand(raw);
      // ⚠ 이 문자열은 셸로 간다. commands/*.md·agents/*.md는 INTEGRITY 매니페스트 밖이라
      // 검사 없이 넘기면 **매니페스트가 안 보는 파일이 실행 코드**가 된다(REVIEW 1회차 🔴,
      // `&& touch PWNED` 주입이 세 테스트 초록인 채 실행되는 것을 실증). 조립하지 않는다는
      // 요점은 유지하되, 넘기기 전에 형태만 못 박는다.
      assert.doesNotMatch(
        cmd, SHELL_META,
        `${d}: 전개 후에도 셸 메타문자가 남았다 — 셸에 넘기지 않는다:\n${cmd}`,
      );
      const r = sh(cmd, root);
      noModuleError(r);
      assert.equal(r.status, 0, `${d}의 명령이 실패했다: ${cmd}\n${r.stdout}\n${r.stderr}`);
      assert.match(r.stdout, /evidence 검증/, `${d}: 판정 출력이 아니다:\n${r.stdout}`);
      assert.match(r.stdout, new RegExp(CYCLE), `${d}: 그 사이클을 판정하지 않았다:\n${r.stdout}`);
    }
  }
  assert.ok(n >= EXEC_DOCS.length, `실행한 명령이 ${n}건이다 — 하한을 못 채웠다`);
});

// ── B2: 실행 지시가 한 벌이다 (상대경로 잔존 0건) ────────────────────
// test/·docs/는 제외한다 — 픽스처 cmd와 아카이브에 상대경로가 남는 건 실행 지시가 아니다
// (DESIGN §8-7: 복사 원본이 될 수는 있다는 잔여는 수용한다).
const SKIP_DIRS = new Set(['.git', 'node_modules', '.devkit', 'test', 'docs', 'evals']);
const SCANNED = ['.md', '.mjs', '.js', '.json'];

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(d, e.name), out);
    } else if (SCANNED.includes(path.extname(e.name))) out.push(path.join(d, e.name));
  }
  return out;
}

// `\S*`는 공백을 못 넘어 `node --no-warnings scripts/…`를 놓쳤다(REVIEW 1회차 🔴 — 이 사이클이
// 잡은 결함군의 재발 경로가 그대로 열려 있었다). 줄 안에서 node와 경로 사이에 무엇이 오든 잡는다.
const INVOKE_RE = /node\b[^\n]*?verify-evidence\.mjs/g;
const WANT = '${CLAUDE_PLUGIN_ROOT}/scripts/verify-evidence.mjs';

test('B2: 검증 스크립트 실행 지시가 전부 플러그인 경로다', () => {
  const found = [];
  for (const f of walk(repoRoot)) {
    for (const m of read(path.relative(repoRoot, f)).matchAll(INVOKE_RE)) {
      found.push({ file: path.relative(repoRoot, f), text: m[0] });
    }
  }
  // ⚠ 하한이 없으면 "0건이라 통과"가 성립한다 — 정규식이 헛돌아도 초록이 된다.
  assert.ok(found.length >= 1, '실행 지시를 한 건도 못 찾았다 — 검사가 헛돌고 있다');
  for (const { file, text } of found) {
    assert.ok(
      text.includes(WANT),
      `${file}: 상대경로 실행 지시가 남아 있다 — devkit 밖에서 MODULE_NOT_FOUND다\n  ${text}`,
    );
  }
});

// ── B1b: 도구가 스스로 안내한 명령도 같은 계약을 받는다 ──────────────
// 가장 나쁜 자리다. 주석이 아니라 **런타임에 사용자 화면으로 나가는 안내**라,
// 남의 프로젝트에서 이 도구가 낸 안내를 복붙하면 그대로 죽는다.
test('B1b: 인자 없이 낸 안내 명령을 그대로 실행하면 그 사이클을 판정한다', () => {
  const root = makeRoot();
  writeCycle(root);

  const guide = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'verify-evidence.mjs')], {
    cwd: root, encoding: 'utf8', env: env(),
  });
  assert.equal(guide.status, 0, `${guide.stdout}\n${guide.stderr}`);

  const line = guide.stdout.split('\n').find((l) => l.includes('--cycle'));
  assert.ok(line, `안내에 --cycle 줄이 없다:\n${guide.stdout}`);
  assert.ok(line.includes('node '), `안내 줄에 실행 명령이 없다: ${line}`);

  // 안내가 준 문자열 그대로. 사람이 복붙할 때 바꾸는 것은 사이클 폴더 자리 하나뿐이다.
  const cmd = line.slice(line.indexOf('node ')).replace('docs/{사이클폴더}', `docs/${CYCLE}`);
  const r = sh(cmd, root);

  noModuleError(r);
  assert.equal(r.status, 0, `안내 명령이 실패했다: ${cmd}\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /evidence 검증/, `판정 출력이 아니다:\n${r.stdout}`);
  assert.match(r.stdout, new RegExp(CYCLE), `그 사이클을 판정하지 않았다:\n${r.stdout}`);
});
