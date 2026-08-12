// stop-verify의 delta 배선 — **2턴 계약**. (docs/2026-08-12-scoped-verification/ H1~H14)
//
// 여기가 가장 중요한 자리다. 배선 중 실측으로만 드러난 버그가 있었다 — delta 경로가
// 공유 notice를 덮어써서 lint 알림이 매 턴 반복됐는데, 그때 테스트는 전부 초록이었다.
// **2턴 계약은 1턴짜리 단언으로 원리적으로 못 잡는다.**
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const hook = (name) => path.join(dir, '..', 'hooks', `${name}.js`);
const { writeBaseline, readBaseline } = createRequire(import.meta.url)(
  path.join(dir, '..', 'hooks', 'lib', 'verify-baseline.js'),
);

const tmpDirs = [];
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

function gitIn(root, ...args) {
  return spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    },
  });
}

/** typecheck가 지정한 줄들을 뱉는 git 레포. setLines()로 턴 사이에 진단을 바꾼다 */
function deltaProject(lines = []) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-delta-'));
  tmpDirs.push(d);
  fs.writeFileSync(
    path.join(d, 'package.json'),
    JSON.stringify({ name: 't', scripts: { typecheck: 'node fx.js' } }),
  );
  fs.mkdirSync(path.join(d, 'src'), { recursive: true });
  fs.writeFileSync(path.join(d, 'src', 'a.ts'), 'export const a = 1;\n');
  // ⚠ 레포 안에 두면 untracked 파일이 되어 스코프 판정을 오염시킨다
  const runsLog = path.join(os.tmpdir(), `devkit-runs-${path.basename(d)}.log`);
  process.env.DEVKIT_TEST_RUNS_LOG = runsLog;
  const setLines = (ls) => {
    const body = ls.map((l) => `console.log(${JSON.stringify(l)});`).join('\n');
    fs.writeFileSync(
      path.join(d, 'fx.js'),
      `require("fs").appendFileSync(process.env.DEVKIT_TEST_RUNS_LOG, "x");\n${body}\nprocess.exit(${ls.length ? 1 : 0});\n`,
    );
  };
  setLines(lines);
  gitIn(d, 'init', '-q', '-b', 'main');
  gitIn(d, 'add', '-A');
  gitIn(d, 'commit', '-qm', 'init');
  return {
    root: d,
    setLines,
    runs: () => (fs.existsSync(runsLog) ? fs.readFileSync(runsLog, 'utf8').length : 0),
  };
}

const ERR1 = "src/a.ts:1:7 - error TS2322: Type 'string' is not assignable to type 'number'.";
const ERR2 = 'src/b.ts:9:3 - error TS2345: Argument of type A is not assignable.';
const ERR3 = 'src/c.ts:2:2 - error TS2304: Cannot find name Foo.';
const BASE = (root) => path.join(root, '.devkit', 'verify-baseline.json');
/** typecheck만 켠다 — lint 알림이 섞이면 이 테스트들이 stdout 전체를 보게 된다 */
const TC = { DEVKIT_VERIFY: 'typecheck' };

function turn(root, env = {}, sid = 'S1') {
  const r = spawnSync('node', [hook('stop-verify')], {
    input: JSON.stringify({ session_id: sid }),
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...TC, ...env },
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
const ctxOf = (stdout) => JSON.parse(stdout).hookSpecificOutput.additionalContext;

test('H1: 1턴 전문 → 2턴 완전 침묵 (같은 상태)', () => {
  const p = deltaProject([ERR1, ERR2]);
  const first = turn(p.root);
  assert.match(first.stdout, /TS2322/, '1턴엔 진단이 나와야 한다');
  assert.ok(fs.existsSync(BASE(p.root)), '기준선이 생겨야 한다');
  const second = turn(p.root);
  assert.equal(second.stdout.trim(), '', `2턴은 0바이트여야 한다: ${second.stdout}`);
});

test('H2: 양방향 — 새 에러만 나오고 기존 에러 원문은 안 나온다', () => {
  // "조용해졌다"와 "고장났다"를 가르는 유일한 단언이다.
  const p = deltaProject([ERR1, ERR2]);
  turn(p.root);
  p.setLines([ERR1, ERR2, ERR3]);
  const { stdout } = turn(p.root);
  assert.match(stdout, /TS2304/, '새 진단은 나와야 한다');
  assert.doesNotMatch(stdout, /TS2322/, '기존 진단 원문이 다시 나오면 안 된다');
});

test('H3: new가 있으면 꼬리에 unchanged 건수가 붙는다', () => {
  const p = deltaProject([ERR1, ERR2]);
  turn(p.root);
  p.setLines([ERR1, ERR2, ERR3]);
  assert.match(ctxOf(turn(p.root).stdout), /그 외 기존 진단 2건/);
});

test('H4: 전부 해결되면 1줄로 알리고, 그 알림은 1회성이다', () => {
  const p = deltaProject([ERR1, ERR2]);
  turn(p.root);
  p.setLines([]);
  assert.match(turn(p.root).stdout, /전부 해결됨/);
  assert.equal(turn(p.root).stdout.trim(), '');
});

test('H5: 기준선이 깨져 있어도 throw 없이 폴백한다', () => {
  const p = deltaProject([ERR1]);
  fs.mkdirSync(path.dirname(BASE(p.root)), { recursive: true });
  fs.writeFileSync(BASE(p.root), '{깨진');
  const r = turn(p.root);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /TS2322/, '기준선을 못 읽으면 보여주는 쪽으로 떨어진다');
});

test('H6: DEVKIT_VERIFY=off면 기준선 내용이 바뀌지 않는다', () => {
  // ⚠ 파일 "존재"로 단언하면 자명참이 되기 쉽다(사이클 A의 교훈) — 내용 변화로 본다.
  const p = deltaProject([ERR1]);
  turn(p.root);
  const before = fs.readFileSync(BASE(p.root), 'utf8');
  p.setLines([ERR1, ERR2, ERR3]);
  const r = turn(p.root, { DEVKIT_VERIFY: 'off' });
  assert.equal(r.stdout.trim(), '');
  assert.equal(fs.readFileSync(BASE(p.root), 'utf8'), before, '껐는데 기준선을 갱신하면 안 된다');
});

test('H7: typecheck 갱신이 lint 키를 지우지 않는다', () => {
  const p = deltaProject([ERR1]);
  writeBaseline(p.root, 'lint', { fp: 'zz', keys: ['lint-key'], total: 1 });
  turn(p.root);
  assert.deepEqual(readBaseline(p.root, 'lint', 'zz').keys, ['lint-key']);
});

test('H8: failed에서는 기준선을 건드리지 않는다 (B21)', () => {
  // 타임아웃·설정 오류 한 번에 기준선이 비워지면 다음 턴에 전문이 쏟아진다.
  const p = deltaProject([ERR1]);
  turn(p.root);
  const before = fs.readFileSync(BASE(p.root), 'utf8');
  p.setLines(['error TS5023: Unknown compiler option.']); // 위치 없음 → failed/config-error
  assert.match(turn(p.root).stdout, /실행되지 못했다/);
  assert.equal(fs.readFileSync(BASE(p.root), 'utf8'), before);
});

test('H9: 브랜치가 바뀌면 기준선을 다시 잡는다', () => {
  const p = deltaProject([ERR1, ERR2]);
  turn(p.root);
  assert.equal(turn(p.root).stdout.trim(), '', '같은 브랜치에선 침묵');
  gitIn(p.root, 'checkout', '-q', '-b', 'feature');
  assert.match(turn(p.root).stdout, /TS2322/, '지형이 바뀌었으니 다시 보여준다');
});

test('H10: new가 임계를 넘으면 목록을 접고 기준선은 갱신한다', () => {
  const p = deltaProject([ERR1]);
  turn(p.root);
  const many = Array.from({ length: 45 }, (_, i) => `src/m${i}.ts:1:1 - error TS2322: m${i}`);
  p.setLines([ERR1, ...many]);
  const r = turn(p.root);
  assert.match(r.stdout, /지형/);
  assert.doesNotMatch(r.stdout, /m44/, '목록은 접혀야 한다');
  assert.equal(turn(p.root).stdout.trim(), '', '기준선이 갱신됐으니 다음 턴은 침묵');
});

test('H11: tsc-on-edit은 기준선을 만들지도 바꾸지도 않는다 (B23)', () => {
  // 편집 훅이 기준선을 갱신하면 턴 끝의 Stop이 "새 진단 0건"을 보고 침묵한다 —
  // 컨텍스트에 닿는 건 Stop 출력뿐이라 켜져 있는데 아무 말도 안 하는 상태가 된다.
  const p = deltaProject([ERR1]);
  const file = path.join(p.root, 'src', 'a.ts');
  const edit = () => spawnSync('node', [hook('tsc-on-edit')], {
    input: JSON.stringify({ tool_input: { file_path: file } }),
    cwd: p.root, encoding: 'utf8',
    env: { ...process.env, DEVKIT_TSC_ON_EDIT: '1' },
  });
  edit();
  assert.equal(fs.existsSync(BASE(p.root)), false, '편집 훅이 기준선을 만들면 안 된다');
  turn(p.root);
  const before = fs.readFileSync(BASE(p.root), 'utf8');
  edit();
  assert.equal(fs.readFileSync(BASE(p.root), 'utf8'), before);
});

test('H12: 새 세션엔 1줄로 존재를 알리고, 같은 세션 2회차는 침묵', () => {
  const p = deltaProject([ERR1, ERR2]);
  turn(p.root, {}, 'S1');
  assert.equal(turn(p.root, {}, 'S1').stdout.trim(), '');
  const body = ctxOf(turn(p.root, {}, 'S2').stdout)
    .split('\n').filter((l) => l.trim() && !l.startsWith('[devkit]'));
  assert.equal(body.length, 1, `새 세션엔 정확히 1줄: ${JSON.stringify(body)}`);
  assert.match(body[0], /남아 있다/);
  assert.equal(turn(p.root, {}, 'S2').stdout.trim(), '', '같은 세션 2회차는 다시 침묵');
});

test('H13: 무관 파일만 바뀐 턴에는 검증기를 아예 띄우지 않는다', () => {
  const p = deltaProject([ERR1]);
  turn(p.root);
  const before = p.runs();
  fs.writeFileSync(path.join(p.root, 'README.md'), '# hi\n');
  const r = turn(p.root);
  assert.equal(p.runs(), before, '.md 한 줄에 타입체크가 돌면 안 된다');
  assert.equal(r.stdout.trim(), '');
});

test('H14: delta 배선 후에도 어떤 입력에든 exit 0', () => {
  const p = deltaProject([ERR1]);
  for (const input of ['', '{깨진', '{}', JSON.stringify({ stop_hook_active: true })]) {
    const r = spawnSync('node', [hook('stop-verify')], {
      input, cwd: p.root, encoding: 'utf8', env: { ...process.env, ...TC },
    });
    assert.equal(r.status, 0, `exit 0이어야 함: ${input.slice(0, 12)}`);
  }
});

test('H15: 공유 notice를 덮지 않는다 — lint 알림이 매 턴 반복되면 안 된다', () => {
  // 실측으로만 드러났던 버그의 회귀 방지. typecheck의 delta가 공유 notice를 덮어써
  // lint의 알림 이력을 지웠고, 그래서 lint "스크립트 없음" 알림이 매 턴 나갔다 —
  // 이 사이클이 없애려는 반복을 새로 만들 뻔했다.
  const p = deltaProject([ERR1]); // lint 스크립트는 없다
  const both = { DEVKIT_VERIFY: 'typecheck,lint' };
  const first = turn(p.root, both);
  assert.match(first.stdout, /lint 스크립트를 찾지 못했다/, '1턴엔 알린다');
  const second = turn(p.root, both);
  assert.doesNotMatch(second.stdout, /lint 스크립트를 찾지 못했다/, '2턴에 또 말하면 무시 학습이다');
  const third = turn(p.root, both);
  assert.equal(third.stdout.trim(), '', '3턴은 완전 침묵');
});

// DESIGN 배선: 외부 프로젝트가 필요한 측정이 CI를 깨지 않게 하되, 있으면 자동으로 돈다.
// ⚠ 사이클 A의 GAP이 "skip 배선이 설계에만 있고 구현에 없었다"를 잡았다 — 같은 형태의 재발을 막는다.
test('B9 bench: DEVKIT_BENCH_PROJECT가 있으면 실측, 없으면 skip', { skip: !process.env.DEVKIT_BENCH_PROJECT }, () => {
  const r = spawnSync('node', [
    path.join(dir, '..', 'scripts', 'bench-delta.mjs'),
    '--project', process.env.DEVKIT_BENCH_PROJECT, '--inject',
  ], { encoding: 'utf8', timeout: 600000 });
  const json = JSON.parse((r.stdout || '').trim().split('\n').pop());
  assert.equal(json.turn1Status, 'found', `측정 불가한 프로젝트다: ${json.turn1Status}`);
  assert.equal(json.quieter, true, `2턴째가 더 조용하지 않다: ${JSON.stringify(json)}`);
  assert.equal(json.stillReportsNew, true, '새 에러를 못 잡으면 조용해진 게 아니라 고장난 것이다');
  assert.equal(json.onlyNewShown, true, '기존 진단이 다시 나오면 delta가 안 도는 것이다');
});

// ── REVIEW 대응 ────────────────────────────────────────────────────

test('H16: 기준선 없는 턴에 접힌 진단이 있으면 건수를 반드시 밝힌다', () => {
  // 🔴 리뷰가 실측 재현: blast radius 밖 진단이 보고에서 빠지는데 기준선에는 들어가
  // **한 번도 보고되지 않은 채 영구히 묻혔다.** 이 사이클의 유일한 치명 실패 모드다.
  const p = deltaProject([]);
  // z.ts는 아무도 import하지 않는다 → a.ts만 고치면 blast radius 밖이다
  fs.writeFileSync(path.join(p.root, 'src', 'z.ts'), 'export const z = 1;\n');
  gitIn(p.root, 'add', '-A');
  gitIn(p.root, 'commit', '-qm', 'add z');
  p.setLines([ERR1, 'src/z.ts:1:1 - error TS2304: Cannot find name GlobalThing.']);
  fs.writeFileSync(path.join(p.root, 'src', 'a.ts'), 'export const a = 2;\n'); // a만 변경

  const { stdout } = turn(p.root);
  const ctx = ctxOf(stdout);
  const hiddenShown = /TS2304/.test(ctx);
  const foldedDeclared = /접었다/.test(ctx);
  assert.ok(
    hiddenShown || foldedDeclared,
    `보여주지도 않고 접혔다고 밝히지도 않으면 영구 침묵이다: ${ctx}`,
  );
});

test('H17: lint 요약 줄은 진단으로 세지 않는다 (거짓 "새 진단" 방지)', () => {
  // 🔴 리뷰가 실측 재현: eslint stylish 꼬리(✖ N problems)가 개수가 바뀔 때마다
  // 새 키가 되어 **에러를 고칠 때마다 "새 진단 1건"**이 떴다. 이 사이클의 대표 신호를
  // 상시 오염시켜 정확히 무시 학습을 만든다.
  const p = deltaProject([]);
  const lintFx = path.join(p.root, 'lint.js');
  const setLint = (n) => fs.writeFileSync(lintFx, [
    'console.log("/repo/src/a.ts");',
    ...Array.from({ length: n }, (_, i) => `console.log("  ${i + 1}:1  error  Boom${i}  rule-${i}");`),
    `console.log("✖ ${n} problems (${n} errors, 0 warnings)");`,
    'process.exit(1);',
  ].join('\n'));
  setLint(2);
  fs.writeFileSync(path.join(p.root, 'package.json'), JSON.stringify({
    name: 't', scripts: { typecheck: 'node fx.js', lint: 'node lint.js' },
  }));
  const both = { DEVKIT_VERIFY: 'lint' };
  turn(p.root, both);
  setLint(1); // 하나 고쳤다 — 새 문제는 0건이다
  const { stdout } = turn(p.root, both);
  assert.doesNotMatch(stdout, /새 진단/, `고쳤는데 새 진단이 떴다: ${stdout}`);
});

test('H18: 두 세션이 교차해도 각자 1회만 알린다 (핑퐁 회귀 방지)', () => {
  // 실측으로 발견됐던 결함. 순수층(P20)만으로는 stop-verify가 상태를 어떻게 저장하는지
  // 못 본다 — 배선까지 봐야 한다.
  const p = deltaProject([ERR1, ERR2]);
  turn(p.root, {}, 'A');
  assert.equal(turn(p.root, {}, 'A').stdout.trim(), '', 'A 두 번째는 침묵');
  assert.notEqual(turn(p.root, {}, 'B').stdout.trim(), '', 'B는 처음이니 알린다');
  assert.equal(turn(p.root, {}, 'A').stdout.trim(), '', 'B가 끼어들어도 A는 계속 침묵');
  assert.equal(turn(p.root, {}, 'B').stdout.trim(), '');
  assert.equal(turn(p.root, {}, 'A').stdout.trim(), '');
});
