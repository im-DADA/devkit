// 호출 경로 계약 — "devkit 밖 프로젝트에서 도는가". verify-evidence.test.mjs와 분리한 이유:
// 거기 265개는 CLI 절대경로를 **테스트가 직접 조립**해서 spawn한다. 그래서 문서가 무슨 경로를
// 지시하든 영향받지 않았고, 상대경로 결함이 3사이클을 살아남았다(DESIGN §2.1).
// 여기서는 반대로 간다 — **문서/출력에 적힌 문자열을 뽑아 그대로 실행한다.**
//
// 이 파일에는 두 세대의 behavior id가 산다:
//   `B1`·`B1b`·`B2`  = 호출 경로 계약(2026-07-27, 문서의 명령이 devkit 밖에서 도는가)
//   `SCAN-B1`~`B8`   = 스캔 판정 계약(2026-07-28, 무엇이 "실행 지시"인가)
// 접두를 나눈 이유는 인용 대조가 **줄 전체 일치**라, 이름이 겹치면 한 계약의 evidence가
// 다른 계약의 출력 줄로도 cited가 되기 때문이다.
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
// 판정은 **형태 하나**다 — 명령이 인용부호 안에서 시작하면 인용이지 지시가 아니다.
// 전에는 디렉토리 허용목록(`test`·`docs`를 통째로 제외)으로 오탐을 눌렀는데, 차원이 달라
// **양방향으로 틀렸다**: 제외 밖의 산문은 여전히 걸리고(CHANGELOG가 과거의 상대경로 형태를
// 인용하는 순간 "상대경로 실행 지시가 남아 있다"는 **틀린 진단**이 난다), 제외 안의 진짜
// 지시는 원리적으로 안 잡혔다. 인용부호로 감싸는 행위가 곧 "이건 데이터다"라는 표시이고,
// 감싸지 않고 줄에 놓는 것이 지시다. B1의 execLines가 이미 같은 축(앞)을 보고 있었다.
const SCANNED = ['.md', '.mjs', '.js', '.json'];

/**
 * 스캔 대상 = **플러그인이 배포하는 파일**. git이 추적하는 것이 곧 배포 대상이다.
 *
 * 전에는 디렉토리 이름을 열거해 제외했는데(`test`·`docs`·`node_modules`…) 그 목록은
 * 차원이 달라 양방향으로 틀렸다. `git ls-files`로 바꾸면 우리가 목록을 만들지 않는다 —
 * `docs/`(gitignore, 사이클 문서·아카이브)와 `node_modules`는 **자동으로** 빠지고,
 * `test/`는 tracked라 자동으로 들어온다. 아카이브가 당시의 옳았던 형태를 보존하는 것은
 * 히스토리이지 지시가 아니며, 그것이 배포되지 않는다는 사실을 git이 이미 알고 있다.
 */
function tracked() {
  const r = spawnSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ls-files 실패: ${r.stderr}`);
  return r.stdout.split('\0')
    .filter((p) => p && SCANNED.includes(path.extname(p)))
    .map((p) => path.join(repoRoot, p));
}

// `\S*`는 공백을 못 넘어 `node --no-warnings scripts/…`를 놓쳤다(REVIEW 1회차 🔴 — 이 사이클이
// 잡은 결함군의 재발 경로가 그대로 열려 있었다). 줄 안에서 node와 경로 사이에 무엇이 오든 잡는다.
const INVOKE_RE = /node\b[^\n]*?verify-evidence\.mjs/g;
const WANT = '${CLAUDE_PLUGIN_ROOT}/scripts/verify-evidence.mjs';

// 명령이 **인용 구간 안**에서 시작하면 인용·데이터다. 직전 문자만 보면
// `` `fix(gap): node … verify-evidence.mjs` `` 처럼 인라인 코드 **중간**에서 시작하는
// 인용을 놓친다(실측 — HANDOFF의 예시 문장이 그대로 오탐이 됐다).
//
// 종류별 홀짝을 세는 방식도 틀렸다: `echo "don't" && node …`에서 큰따옴표 안의 아포스트로피가
// `'` 카운트를 홀수로 만들어 **진짜 지시를 인용으로 뒤집었다**(GAP 신규 관측). 여는 부호가
// 무엇이었는지 기억하고 **같은 부호로만 닫는** 구간 파싱이면 안쪽의 다른 부호는 문자일 뿐이다.
// ⚠ **판정**은 파일 경로·디렉토리를 보지 않는다 — 그게 허용목록으로 되돌아가는 문이다.
//   (스캔 **대상 선정**은 아직 `SCANNED` 확장자를 본다. `templates/ci.yml`·`templates/pre-commit`이
//    그 밖에 있고 검증 명령이 적힐 법한 자리다 — 남은 열거이고 REPORT에 잔여로 적었다.)
// 백틱은 **연속 개수**가 곧 구분자 길이다(``…``는 내용에 백틱이 들어갈 때 쓰는 정규 표기).
// 한 글자씩 토글하면 ``로 열고 ``로 닫힌 인용이 "열고 닫고 열고 닫고"로 읽혀 명령이
// 인용 밖으로 보인다 — 이 사이클이 없애려던 그 틀린 진단이 그대로 난다(REVIEW 🟡1).
const QUOTES = ['`', "'", '"'];
function isQuoted(before) {
  let open = null; // {ch, len}
  let i = 0;
  while (i < before.length) {
    const ch = before[i];
    if (ch === '`') {
      let len = 0;
      while (before[i + len] === '`') len += 1;
      if (!open) open = { ch, len };
      else if (open.ch === '`' && open.len === len) open = null;
      i += len;
      continue;
    }
    if (QUOTES.includes(ch)) {
      if (!open) open = { ch, len: 1 };
      else if (open.ch === ch) open = null;
    }
    i += 1;
  }
  return open !== null;
}

/**
 * 한 파일에서 **실행 지시**만 뽑는다. 인용된 것(산문 속 인라인 코드, 문자열 리터럴 픽스처,
 * CHANGELOG의 히스토리 인용)은 지시가 아니므로 제외한다.
 * @returns {{line:number, text:string, quoted:boolean}[]} quoted까지 돌려주는 이유는
 *   "몇 건을 왜 뺐나"를 실패 메시지가 말할 수 있어야 하기 때문이다.
 */
function scanInvocations(src) {
  const out = [];
  src.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(INVOKE_RE)) {
      out.push({
        line: i + 1,
        text: m[0],
        quoted: isQuoted(line.slice(0, m.index)),
      });
    }
  });
  return out;
}

/**
 * 스캔 결과가 "검사로서 성립하는가"를 본다. **인라인 단언으로 두면 그 단언이 지워져도
 * 아무 테스트도 안 죽는다** — 실제로 첫 회차의 자기참조 시드가 세 하한을 전부 삭제해도
 * 초록이었다(GAP M7). 함수로 뽑아야 "0건이면 실패한다"를 동작으로 단언할 수 있다.
 * @throws 판정이 헛돌고 있으면
 */
function assertScanIsLive({ fileCount, directives, quoted }) {
  assert.ok(fileCount > 20, `배포 대상 파일이 ${fileCount}개다 — 목록이 헛돌고 있다`);
  assert.ok(directives.length >= 1, '실행 지시를 한 건도 못 찾았다 — 검사가 헛돌고 있다');
  assert.ok(quoted.length >= 1, '인용을 한 건도 못 걸렀다 — 인용 판정이 죽었다');
}

/**
 * 파일 목록을 받아 지시/인용으로 가른다. **목록을 주입받는 것이 요점**이다 —
 * 레포를 직접 훑으면 "같은 내용을 다른 이름으로 먹여도 판정이 같은가"를 물을 수 없고,
 * 그러면 경로 기반 회귀를 동작으로 잡을 방법이 사라진다(REVIEW 🔴1).
 * @param {{rel:string, src:string}[]} files
 */
function auditFiles(files) {
  const directives = [];
  const quoted = [];
  for (const { rel, src } of files) {
    for (const hit of scanInvocations(src)) {
      (hit.quoted ? quoted : directives).push({ file: `${rel}:${hit.line}`, text: hit.text });
    }
  }
  return { fileCount: files.length, directives, quoted };
}

/** 배포 대상 전체를 훑는다. 워크트리에서 지워졌지만 아직 stage 안 한 파일은 건너뛴다 */
function auditRepo() {
  const files = [];
  for (const abs of tracked()) {
    const rel = path.relative(repoRoot, abs);
    if (!fs.existsSync(abs)) continue; // 삭제 후 미stage — 판정 대상이 아니지 크래시 사유가 아니다
    files.push({ rel, src: read(rel) });
  }
  const audit = auditFiles(files);
  assertScanIsLive(audit);
  return audit;
}

test('B2: 검증 스크립트 실행 지시가 전부 플러그인 경로다', () => {
  const audit = auditRepo(); // 하한 단언은 auditRepo가 반환 전에 스스로 건다

  for (const { file, text } of audit.directives) {
    assert.ok(
      text.includes(WANT),
      `${file}: 상대경로 실행 지시가 남아 있다 — devkit 밖에서 MODULE_NOT_FOUND다\n  ${text}`,
    );
  }
});

// ── 회귀 시드: 판정이 양방향으로 틀리던 두 자리 ──────────────────────
// 실제 파일이 아니라 **문자열을 판정 함수에 직접 먹인다**. 레포 상태가 바뀌어도
// 이 두 계약은 그대로 남아야 한다.

test('SCAN-B1: 히스토리 산문이 과거의 상대경로 형태를 인용해도 실행 지시가 아니다', () => {
  // CHANGELOG가 "예전엔 이랬다"를 적는 것은 정상 서술이다. 전에는 이게 빨간불을 내고
  // "상대경로 실행 지시가 남아 있다"는 **틀린 진단**을 했다 — 고치려면 히스토리를 위조해야 했다.
  const src = [
    '- `node scripts/verify-evidence.mjs`였던 것을 플러그인 경로로 고쳤다.',
    '- 검증 지시 6곳을 `node "${CLAUDE_PLUGIN_ROOT}/scripts/verify-evidence.mjs"`로 통일. 열거는 빗나갔다.',
    // 인라인 코드 **중간**에서 명령이 시작한다. 직전 문자만 보는 판정은 이걸 놓쳤다(실측 —
    // HANDOFF가 "이런 산문이 걸린다"고 적은 예시 문장이 그대로 오탐이 됐다).
    '- ① `fix(gap): node … verify-evidence.mjs …` 같은 정상 산문이 걸린다',
    // 결함 서술 안에서 상대경로를 언급하는 것도 정상이다.
    "- 훅이 'node scripts/verify-evidence.mjs'를 부르면 남의 프로젝트에서 죽는다",
  ].join('\n');
  const hits = scanInvocations(src);
  assert.equal(hits.length, 4, '네 줄 다 매치는 돼야 한다(제외는 판정이지 미탐이 아니다)');
  assert.ok(
    hits.every((h) => h.quoted),
    `인용된 명령은 전부 지시에서 빠져야 한다: ${JSON.stringify(hits.filter((h) => !h.quoted))}`,
  );
});

test('SCAN-B2: test 디렉토리 아래에 있어도 진짜 실행 지시는 판정 대상이다', () => {
  // 전에는 SKIP_DIRS가 test/를 통째로 빼서 이 경로가 원리적으로 안 잡혔다.
  const src = '   node scripts/verify-evidence.mjs --cycle docs/x';
  const [hit] = scanInvocations(src);
  assert.ok(hit, '들여쓴 실행 지시를 놓쳤다');
  assert.equal(hit.quoted, false, '인용부호가 없으므로 지시다');
  assert.ok(!hit.text.includes(WANT), '이 시드는 상대경로라 위반으로 잡혀야 한다');
});

test('SCAN-B3: evidence.cmd 픽스처는 문자열 리터럴이므로 실행 지시가 아니다', () => {
  // test/를 스캔 대상에 되돌리면서 새 오탐을 만들지 않는다는 계약.
  const src = [
    "        cmd: 'node scripts/verify-evidence.mjs --cycle docs/2026-07-26-x',",
    "  const CMD = 'node scripts/verify-evidence.mjs --cycle docs/2026-07-25-loop';",
    '  const CMD = `node scripts/verify-evidence.mjs --cycle docs/${CYCLE}`;',
  ].join('\n');
  const hits = scanInvocations(src);
  assert.equal(hits.length, 3, '픽스처 3종이 매치는 돼야 한다');
  assert.ok(hits.every((h) => h.quoted), '문자열 리터럴 안의 명령은 지시가 아니다');
});

test('SCAN-B4: 현재 레포의 정당한 실행 지시가 전부 잡힌다', () => {
  const MUST = ['agents/gap-detector.md', 'commands/gap.md', 'scripts/verify-evidence.mjs'];
  for (const f of MUST) {
    const directives = scanInvocations(read(f)).filter((h) => !h.quoted);
    assert.ok(directives.length >= 1, `${f}: 실행 지시를 놓쳤다 — 탐지력이 줄었다`);
    for (const d of directives) {
      assert.ok(d.text.includes(WANT), `${f}:${d.line}: 플러그인 경로가 아니다\n  ${d.text}`);
    }
  }
});

test('SCAN-B6: 지시와 인용을 갈라 세고 위반 위치를 줄 번호까지 지목한다', () => {
  const src = [
    '- `node scripts/verify-evidence.mjs`였던 것을 고쳤다.',   // 인용
    '   node scripts/verify-evidence.mjs --cycle docs/x',      // 지시(위반)
  ].join('\n');
  const hits = scanInvocations(src);
  const directives = hits.filter((h) => !h.quoted);
  assert.equal(directives.length, 1, '지시는 1건이어야 한다 — 산문을 지시라 부르면 진단이 거짓말이다');
  assert.equal(directives[0].line, 2, '위반 줄 번호를 정확히 지목해야 한다');
  assert.equal(hits.filter((h) => h.quoted).length, 1, '인용도 1건으로 세어야 한다');
});

test('SCAN-B7: 판정이 0건이면 통과가 아니라 실패다', () => {
  // ⚠ 소스에서 단언 문자열을 찾는 방식으로 쓰면 **시드가 자기 자신을 읽어 영구히 참**이 된다
  // (첫 회차가 그랬고, 세 하한을 전부 삭제해도 초록이었다 — GAP M7). 동작으로 단언한다.
  //
  // ⚠ 헬퍼가 throw하는지만 보면 **호출 지점이 새 사각지대**가 된다 — auditRepo 안의
  // assertScanIsLive 한 줄을 지워도 아무도 안 죽었다(REVIEW 🔴2). 그래서 여기서
  // **레포 전수 판정을 실제로 돌려** 하한을 직접 확인한다. 검증이 두 곳이라 하나가 죽어도 산다.
  const real = auditRepo();
  assert.ok(real.fileCount > 20, `배포 대상이 ${real.fileCount}개다 — 목록이 헛돌고 있다`);
  assert.ok(real.directives.length >= 1, '레포 전수에서 실행 지시 0건 — 검사가 헛돌고 있다');
  assert.ok(real.quoted.length >= 1, '레포 전수에서 인용 0건 — 인용 판정이 죽었다');

  const live = { fileCount: 30, directives: [{ file: 'a:1' }], quoted: [{ file: 'b:2' }] };
  assert.doesNotThrow(() => assertScanIsLive(live), '정상 판정이 통과해야 한다');

  assert.throws(
    () => assertScanIsLive({ ...live, directives: [] }),
    /검사가 헛돌고 있다/,
    '지시 0건인데 통과했다 — 하한이 죽었다',
  );
  assert.throws(
    () => assertScanIsLive({ ...live, quoted: [] }),
    /인용 판정이 죽었다/,
    '인용 0건인데 통과했다 — 탐지기 헛돎을 못 막는다',
  );
  assert.throws(
    () => assertScanIsLive({ ...live, fileCount: 0 }),
    /목록이 헛돌고 있다/,
    '스캔 대상 0개인데 통과했다',
  );
});

test('SCAN-B8: 인용 판정이 여는 부호를 기억한다 (안쪽의 다른 부호는 문자다)', () => {
  // 홀짝 카운트 방식은 큰따옴표 안의 아포스트로피에 뒤집혔다(GAP 신규 관측).
  const cases = [
    ['echo "run" && node scripts/verify-evidence.mjs', false],
    ["echo \"don't\" && node scripts/verify-evidence.mjs", false],
    ["- 훅이 'node scripts/verify-evidence.mjs'를 부른다", true],
    ['- `fix(gap): node … verify-evidence.mjs …` 같은 산문', true],
    // 이중 백틱은 내용에 백틱이 들어갈 때 쓰는 정규 마크다운 표기다. 한 글자씩 토글하면
    // 여기서 인용이 닫힌 것으로 보여 명령이 지시가 되고, 이 사이클이 없애려던 틀린 진단이 난다.
    ['- 예전 형태 ``node scripts/verify-evidence.mjs`` 를 고쳤다', true],
  ];
  for (const [src, wantQuoted] of cases) {
    const [hit] = scanInvocations(src);
    assert.ok(hit, `매치 자체를 놓쳤다: ${src}`);
    assert.equal(hit.quoted, wantQuoted, `인용 판정이 틀렸다: ${src}`);
  }
});

test('SCAN-B5: 같은 내용이면 파일 이름이 달라도 판정이 같다', () => {
  // ⚠ arity 관찰(`scanInvocations.length === 1`)로 쓰면 **기본값 인자 한 개로 우회된다** —
  // `Function.length`는 기본값 앞까지만 세므로 `(src, rel = '')`가 여전히 1이고, 그 rel로
  // `test/`를 통째 걸러도 전원 초록이었다(REVIEW 🔴1-b). 파이프라인에 필터를 꽂은
  // 경우도 마찬가지였다(🔴1-a). 그래서 **동작**으로 본다.
  const src = '   node scripts/verify-evidence.mjs';
  const verdicts = new Set();
  for (const rel of ['test/x.md', 'commands/x.md', 'CHANGELOG.md', 'docs/x.md', 'templates/ci.yml']) {
    const { directives, quoted } = auditFiles([{ rel, src }]);
    verdicts.add(`${directives.length}/${quoted.length}`);
  }
  assert.equal(
    verdicts.size, 1,
    `파일 이름에 따라 판정이 갈렸다 — 위치 기반으로 회귀했다: ${[...verdicts].join(' vs ')}`,
  );
  assert.deepEqual([...verdicts], ['1/0'], '이름과 무관하게 지시 1건으로 판정돼야 한다');

  // 스캔 대상은 git이 정한다. 우리가 디렉토리를 열거하면 그때부터 양방향으로 틀린다.
  const rels = tracked().map((f) => path.relative(repoRoot, f));
  for (const d of ['test/', 'commands/', 'agents/', 'hooks/', 'scripts/']) {
    assert.ok(
      rels.some((r) => r.startsWith(d)),
      `${d}가 스캔에 안 들어온다 — 위치 기반 제외로 회귀했다`,
    );
  }
  // docs/는 gitignore라 자동으로 빠진다. 우리가 뺀 것이 아니라 배포 대상이 아닌 것이다.
  assert.ok(!rels.some((r) => r.startsWith('docs/')), 'docs/가 배포 대상에 들어왔다');
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
