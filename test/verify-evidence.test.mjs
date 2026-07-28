// verify-evidence CLI 계약 — 3층 판정(ref 실존·receipt 인용·커버리지)을 조합해 "보고"한다.
// 차단은 오직 pdca-gate 훅이 한다. 그래서 이 CLI의 exit code는 어떤 상황에도 0이다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { formatHuman, toJson, emit } from '../scripts/lib/report-format.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(dir, '..');
const CLI = path.join(repoRoot, 'scripts', 'verify-evidence.mjs');

// 대조 규칙의 정본에서 그대로 가져온다 — 두 벌로 두면 상수가 바뀔 때 이 보장이 조용히 죽는다
const require = createRequire(import.meta.url);
const { normalize, MIN_QUOTE, SEP } = require(path.join(repoRoot, 'hooks', 'lib', 'citation.js'));

const tmpDirs = [];
function makeRoot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-verify-'));
  fs.mkdirSync(path.join(d, '.git')); // findProjectRoot가 여기를 루트로 잡게 한다
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

// ⚠ node --test는 자식 프로세스에 NODE_TEST_CONTEXT=child-v8을 심는다. 그대로 물려주면
// 손자(이 CLI)가 v8 직렬화 보고 모드로 붙어 stdout이 통째로 사라지는데도 exit=0이 난다.
// 반드시 지우고 띄운다(test/lcov.test.mjs가 같은 함정을 밟았다).
function run(root, args = []) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8', env });
}

function writeCycle(root, id, behaviors) {
  const cycle = path.join(root, 'docs', id);
  fs.mkdirSync(cycle, { recursive: true });
  fs.writeFileSync(
    path.join(cycle, 'behaviors.json'),
    JSON.stringify({ version: 1, cycleId: id, behaviors }, null, 2),
  );
  return cycle;
}

function writeState(root, id) {
  fs.mkdirSync(path.join(root, '.devkit'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.devkit', 'pdca-state.json'),
    JSON.stringify({ version: 1, cycleId: id, stage: 'gap', status: 'in-progress' }),
  );
}

// ── V1: 사이클을 못 정하는 상황 ──────────────────────────
test('V1: 사이클을 못 정하면 안내만 하고 exit 0', () => {
  const root = makeRoot();
  const r = run(root);

  assert.equal(r.status, 0, `보고 도구는 항상 0이다:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /--cycle/, '무엇을 해야 하는지(=--cycle) 안내해야 한다');
});

// ── V2: behaviors.json이 없는 사이클 ─────────────────────
// 아직 /plan을 안 돌린 사이클이 정상 상태다. 여기서 에러를 내면 보고 도구가
// "아직 시작 안 함"을 사고로 취급하게 된다.
test('V2: behaviors.json이 없으면 안내만 하고 exit 0', () => {
  const root = makeRoot();
  const cycle = path.join(root, 'docs', '2026-07-25-empty');
  fs.mkdirSync(cycle, { recursive: true });

  const r = run(root, ['--cycle', 'docs/2026-07-25-empty']);

  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /behaviors\.json/, '무엇이 없는지 지목해야 한다');
  assert.match(r.stdout, /2026-07-25-empty/, '어느 사이클인지 지목해야 한다');
});

// ── V3: 사이클 결정 순서 ─────────────────────────────────
// /gap이 인자 없이 이 CLI를 부르므로, state를 못 읽으면 도구가 아무것도 못 한다.
test('V3: --cycle이 없으면 pdca-state.json의 cycleId로 사이클을 정한다', () => {
  const root = makeRoot();
  writeCycle(root, '2026-07-25-from-state', []);
  writeState(root, '2026-07-25-from-state');

  const r = run(root);

  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(
    r.stdout, /docs\/2026-07-25-from-state\//,
    `헤더가 어느 사이클을 봤는지 밝혀야 한다:\n${r.stdout}`,
  );
});

// ── V4: unresolved — 유일한 게이트 대상 ──────────────────
// "unresolved 1건"만 알려주면 고칠 수가 없다. 어느 behavior의 어느 ref인지 지목해야 한다.
test('V4: unresolved를 게이트 대상으로 명시하고 어느 behavior의 어느 ref인지 지목한다', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'real.js'), 'module.exports = 1;\n');
  writeCycle(root, '2026-07-25-mixed', [
    {
      id: 'B1',
      passes: true,
      evidence: { kind: 'test', ref: 'src/real.js:1', output: '✔ 실존하는 파일을 가리킨다', at: '2026-07-25' },
    },
    {
      id: 'B2',
      passes: true,
      evidence: { kind: 'test', ref: 't.ts', output: '✔ 위조된 통과 주장이다', at: '2026-07-25' },
    },
  ]);

  const r = run(root, ['--cycle', 'docs/2026-07-25-mixed']);

  assert.match(r.stdout, /unresolved: 1/, `게이트 대상 개수를 리터럴로 내야 gap-detector가 옮겨 적는다:\n${r.stdout}`);
  assert.match(r.stdout, /게이트/, `차단되는 층임을 밝혀야 한다:\n${r.stdout}`);
  assert.match(r.stdout, /B2/, `어느 behavior인지 지목:\n${r.stdout}`);
  assert.match(r.stdout, /t\.ts/, `어느 ref인지 지목:\n${r.stdout}`);
  assert.doesNotMatch(r.stdout, /^.*B1.*파일 없음/m, `정직한 B1을 걸면 안 된다:\n${r.stdout}`);
});

/** receipt 봉인 상태를 만든다. ts는 no-receipt(소급 오탐) 판정의 기준선이 된다 */
function writeReceipts(root, records) {
  fs.mkdirSync(path.join(root, '.devkit'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.devkit', 'receipts.jsonl'),
    records.map((r) => JSON.stringify(r)).join('\n') + '\n',
  );
}

// ── V5: 인용 대조 층은 보고이지 차단이 아니다 ────────────
// uncited(인용이 틀림)와 no-receipt(대조할 receipt가 애초에 없음)는 다른 사건이다.
// 뭉치면 봉인 이전 사이클 전부가 경고로 보여 보고가 소음이 된다.
test('V5: uncited와 no-receipt를 구분해 "차단 아님"으로 보고한다', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'real.js'), 'module.exports = 1;\n');
  writeReceipts(root, [
    { ts: '2026-07-25T10:00:00.000Z', cmd: 'node --test', stdout: '✔ 실제로 실행된 문구다', stderr: '' },
  ]);
  // cmd는 대조 후보를 고르는 키다 — receipt와 같은 명령을 적어야 대조 자체가 성립한다
  const ev = (output, at) => ({
    kind: 'test', ref: 'src/real.js', cmd: 'node --test', output, at,
  });
  writeCycle(root, '2026-07-25-cite', [
    { id: 'B1', passes: true, evidence: ev('✔ 실제로 실행된 문구다', '2026-07-25') },
    { id: 'B2', passes: true, evidence: ev('✔ receipt에 없는 문구다', '2026-07-25') },
    { id: 'B3', passes: true, evidence: ev('✔ 봉인 이전에 기록된 문구다', '2026-07-24') },
  ]);

  const r = run(root, ['--cycle', 'docs/2026-07-25-cite']);

  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /uncited: 1/, `요약:\n${r.stdout}`);
  assert.match(r.stdout, /no-receipt: 1/, `봉인 이전은 uncited가 아니다:\n${r.stdout}`);
  assert.match(r.stdout, /no-cmd-match: 0/, `주장한 명령을 실제로 돌렸으니 대조는 성립한다:\n${r.stdout}`);
  assert.match(r.stdout, /차단 아님/, `게이트 층과 구분해야 한다:\n${r.stdout}`);
  // 원문 전체가 아니라 진부분 접두사로 지목한다 — 원문을 실으면 이 stdout이 봉인돼 자기입증된다
  // 인용 단위는 마커를 포함한 줄 통째다(citation.js는 마커를 벗기지 않는다) — 총 길이도 그 기준
  assert.match(r.stdout, /B2 .*✔ receipt에 없는 문구…\(총 17자\)/, `어느 인용이 안 맞는지 지목:\n${r.stdout}`);
  assert.match(r.stdout, /B3/, `no-receipt 항목도 지목:\n${r.stdout}`);
  assert.doesNotMatch(r.stdout, /B1 /, `cited는 조용해야 한다(소음 방지):\n${r.stdout}`);
});

// ── V5/B5: 매칭 0건은 uncited와 다른 통에 담고 사유를 가른다 ──
// no-receipt에 흡수하면 "그것만으로 ❌를 주지 마라"는 면죄 문구를 위조가 물려받는다(D15).
// uncited에 흡수하면 압도적 다수인 "안 돌렸다"가 진짜 불일치를 덮는다(D18 회귀).
test('V5: no-cmd-match를 uncited와 구분하고 두 사유(cmd 없음 / 안 돌림)를 갈라 지목한다', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'real.js'), 'module.exports = 1;\n');
  writeReceipts(root, [
    { ts: '2026-07-25T10:00:00.000Z', cmd: 'node --test test/real.test.mjs', stdout: '✔ 실제로 실행된 문구다', stderr: '' },
  ]);
  const ev = (output, cmd) => ({
    kind: 'test', ref: 'src/real.js', output, at: '2026-07-25', ...(cmd ? { cmd } : {}),
  });
  writeCycle(root, '2026-07-25-nocmd', [
    { id: 'B1', passes: true, evidence: ev('✔ 실제로 실행된 문구다', 'node --test test/real.test.mjs') },
    { id: 'B2', passes: true, evidence: ev('✔ cmd를 안 적은 주장이다') },
    { id: 'B3', passes: true, evidence: ev('✔ 안 돌린 명령을 주장한다', 'node --test test/never.test.mjs') },
  ]);

  const r = run(root, ['--cycle', 'docs/2026-07-25-nocmd']);

  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /no-cmd-match: 2/, `헤더에 리터럴로 나와야 gap-detector가 옮겨 적는다:\n${r.stdout}`);
  assert.match(r.stdout, /uncited: 0/, `안 돌린 것을 uncited로 뭉개면 안 된다:\n${r.stdout}`);
  assert.match(r.stdout, /no-receipt: 0/, `면죄 문구가 붙는 통에 넣으면 안 된다:\n${r.stdout}`);
  assert.match(r.stdout, /B2 .*cmd가 없다/, `조치 = "실제 실행 명령을 적어라":\n${r.stdout}`);
  assert.match(
    r.stdout, /B3 .*node --test test\/never\.test\.mjs.*실행된 receipt가 없다/,
    `조치 = "그 명령을 그대로 돌려라" — 어느 명령인지 지목해야 한다:\n${r.stdout}`,
  );
  assert.doesNotMatch(r.stdout, /^.*B1 .*receipt/m, `실제로 돌린 B1은 조용해야 한다:\n${r.stdout}`);
});

// ⚠ 실측: node는 경로에 test/ 세그먼트가 있는 파일을 커버리지에서 제외한다(**/test/** 기본 매처).
// 그래서 여기서는 실제 커버리지를 뽑지 않고 lcov 텍스트를 직접 써넣는다 — 판정 대상은
// verify-evidence의 조합 로직이지 node의 커버리지 수집기가 아니다(그건 lcov.test.mjs가 본다).
const LCOV_FIXTURE = [
  'TN:',
  'SF:src/discount.js',
  'DA:2,3',
  'DA:3,0',
  'BRDA:2,0,0,3',
  'BRDA:2,0,1,-',
  'end_of_record',
  '',
].join('\n');

// ── V6: 커버리지 층의 기본 경로 (열린질문 ②) ─────────────
// /gap이 다중 리포터로 .devkit/lcov.info를 떨어뜨린다. --lcov를 매번 적게 하면
// 배선 한 군데만 빠져도 커버리지 층이 조용히 죽는다 — 관례를 코드에 박는다.
test('V6: --lcov 미지정이면 .devkit/lcov.info를 기본 경로로 읽는다', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'discount.js'), 'x\n'.repeat(5));
  fs.mkdirSync(path.join(root, '.devkit'), { recursive: true });
  fs.writeFileSync(path.join(root, '.devkit', 'lcov.info'), LCOV_FIXTURE);
  const ev = { kind: 'test', ref: 'src/discount.js:2', output: '✔ 할인 계산을 검증했다', at: '2026-07-25' };
  writeCycle(root, '2026-07-25-cov', [
    { id: 'B1', passes: true, target: 'src/discount.js:2', evidence: ev },
    { id: 'B2', passes: true, target: 'src/discount.js:3', evidence: ev },
    { id: 'B3', passes: true, target: 'src/nowhere.js:1', evidence: ev },
  ]);

  const r = run(root, ['--cycle', 'docs/2026-07-25-cov']);

  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /dead-branch: 1/, `요약:\n${r.stdout}`);
  assert.match(r.stdout, /uncovered: 1/, `요약:\n${r.stdout}`);
  assert.match(r.stdout, /B1 .*src\/discount\.js:2/, `도달 불가 분기를 지목:\n${r.stdout}`);
  assert.match(r.stdout, /B2 .*src\/discount\.js:3/, `미실행 라인을 지목:\n${r.stdout}`);
});

// lcov를 안 돌린 상태로 /gap을 부르는 것이 정상 경로다. 그때 커버리지 층은 침묵해야 한다 —
// no-data를 경고로 올리면 커버리지를 안 쓰는 사이클이 전부 빨갛게 보인다.
test('V6: .devkit/lcov.info가 없으면 커버리지 층은 전부 no-data (경고 아님)', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'discount.js'), 'x\n'.repeat(5));
  writeCycle(root, '2026-07-25-nocov', [
    {
      id: 'B1',
      passes: true,
      target: 'src/discount.js:2',
      evidence: { kind: 'test', ref: 'src/discount.js:2', output: '✔ 할인 계산을 검증했다', at: '2026-07-25' },
    },
  ]);

  const r = run(root, ['--cycle', 'docs/2026-07-25-nocov']);

  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /uncovered: 0/, `${r.stdout}`);
  assert.match(r.stdout, /dead-branch: 0/, `${r.stdout}`);
  assert.match(r.stdout, /no-data/, `커버리지를 못 봤다는 사실 자체는 밝혀야 한다:\n${r.stdout}`);
});

// ── B6: lcov 부재가 보고에 드러난다 ───────────────────────
// 실측(PLAN ④): target이 없는 사이클에서는 no-data조차 0건이라, 커버리지를 안 돌린 실행과
// 전부 covered인 실행의 출력이 **완전히 같았다**. 파일이 없다는 사실이 어느 카운트에도
// 안 실린다 — 조용한 degrade다. 처방은 새 카운트가 아니라 헤더 표기다(DESIGN §3.2).
const NO_TARGET = [{
  id: 'B1',
  passes: true,
  evidence: { kind: 'test', ref: 'src/discount.js', output: '✔ 할인 계산을 검증했다', at: '2026-07-25' },
}];

function noTargetRoot(id) {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'discount.js'), 'x\n'.repeat(5));
  writeCycle(root, id, NO_TARGET);
  return root;
}

const ABSENT_RE = /커버리지가 반영되지 않았다/;

test('B6-1: lcov가 없으면 헤더가 부재를 밝힌다 (target이 없어 no-data 0건일 때도)', () => {
  const root = noTargetRoot('2026-07-27-b6a');

  const r = run(root, ['--cycle', 'docs/2026-07-27-b6a']);

  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /커버리지 no-data: 0건|no-data: 0|커버리지 출처/, `헤더가 없다:\n${r.stdout}`);
  assert.doesNotMatch(r.stdout, /no-data: [1-9]/, `이 픽스처는 no-data 0건이어야 의미가 있다:\n${r.stdout}`);
  assert.match(r.stdout, ABSENT_RE, `lcov 부재가 출력 어디에도 없다:\n${r.stdout}`);
});

// B6-1과 반드시 쌍이다 — 한쪽만 두면 "항상 경고"가 계약으로 굳는다.
test('B6-2: lcov가 있으면 부재 표기가 나오지 않는다 (오탐 없음)', () => {
  const root = noTargetRoot('2026-07-27-b6b');
  fs.mkdirSync(path.join(root, '.devkit'), { recursive: true });
  fs.writeFileSync(path.join(root, '.devkit', 'lcov.info'), LCOV_FIXTURE);

  const r = run(root, ['--cycle', 'docs/2026-07-27-b6b']);

  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.doesNotMatch(r.stdout, ABSENT_RE, `lcov가 있는데 부재라고 한다:\n${r.stdout}`);
});

// 게이트 승격 방지를 계약으로 못 박는다 — 늘어나는 건 줄 하나가 아니라 그 줄의 뒷부분이다.
test('B6-3: 부재 표기는 counts를 바꾸지 않고 새 경고 섹션도 만들지 않는다', () => {
  const absent = noTargetRoot('2026-07-27-b6c');
  const present = noTargetRoot('2026-07-27-b6c');
  fs.mkdirSync(path.join(present, '.devkit'), { recursive: true });
  fs.writeFileSync(path.join(present, '.devkit', 'lcov.info'), LCOV_FIXTURE);

  const a = run(absent, ['--cycle', 'docs/2026-07-27-b6c', '--json']);
  const p = run(present, ['--cycle', 'docs/2026-07-27-b6c', '--json']);
  assert.equal(a.status, 0, `${a.stdout}\n${a.stderr}`);
  assert.deepEqual(
    JSON.parse(a.stdout).counts,
    JSON.parse(p.stdout).counts,
    'lcov 부재가 카운트를 움직였다 — 보고가 아니라 게이트로 승격됐다',
  );

  const warnLines = (s) => s.split('\n').filter((l) => l.startsWith('⚠')).length;
  const ha = run(absent, ['--cycle', 'docs/2026-07-27-b6c']);
  const hp = run(present, ['--cycle', 'docs/2026-07-27-b6c']);
  assert.equal(ha.status, 0, `${ha.stdout}\n${ha.stderr}`);
  assert.equal(warnLines(ha.stdout), warnLines(hp.stdout), `경고 섹션이 늘었다:\n${ha.stdout}`);
});

// gap-detector가 기계 판독으로 옮길 수 있어야 한다 — 사람용 문구를 파싱하게 두지 않는다.
test('B6-4: --json 최상위에 lcovPresent가 있다', () => {
  const absent = noTargetRoot('2026-07-27-b6d');
  const present = noTargetRoot('2026-07-27-b6d');
  fs.mkdirSync(path.join(present, '.devkit'), { recursive: true });
  fs.writeFileSync(path.join(present, '.devkit', 'lcov.info'), LCOV_FIXTURE);

  const a = JSON.parse(run(absent, ['--cycle', 'docs/2026-07-27-b6d', '--json']).stdout);
  const p = JSON.parse(run(present, ['--cycle', 'docs/2026-07-27-b6d', '--json']).stdout);

  assert.equal(a.lcovPresent, false, '부재인데 lcovPresent가 false가 아니다');
  assert.equal(p.lcovPresent, true, '있는데 lcovPresent가 true가 아니다');
});

// 이 stdout은 봉인된다 — 새 문구가 대조 후보가 되면 보고서가 자기입증 채널이 된다.
// ⚠ 첫 단언만으로는 판별력이 없다(실측): 요약 줄은 `devkit${SEP}` 접두를 받고 그 위에
//   emit의 무조건 백스톱까지 있어, 표기에서 SEP를 빼도 프로세스 경계에선 초록이 유지된다.
//   그래서 **표기 자신도 형태를 만족하는지**를 따로 본다 — 이 줄이 접두 없는 자리로 옮겨져도
//   후보가 되지 않아야 한다(DESIGN §3.2가 "본문에 SEP 하나 더"를 설계로 명시한 이유).
test('B6-5: 부재 표기 줄은 대조 후보가 아니다', () => {
  const root = noTargetRoot('2026-07-27-b6e');

  const r = run(root, ['--cycle', 'docs/2026-07-27-b6e']);

  const line = r.stdout.split('\n').find((l) => ABSENT_RE.test(l));
  assert.ok(line, `부재 표기 줄이 없다:\n${r.stdout}`);
  assert.equal(citable(line), false, `부재 표기 줄이 대조 후보다: ${line}`);

  const marker = line.slice(line.indexOf(SEP) + SEP.length);
  assert.equal(citable(marker), false, `접두를 떼면 대조 후보가 된다 — 표기 자신에 SEP가 없다: ${marker}`);
});

// ── V7: exit code는 어떤 상황에도 0 ──────────────────────
// unresolved>0을 exit 1로 만들면 gap-detector의 Bash 호출이 "실패"로 보이고,
// 나아가 보고 도구가 작업을 막는 역할 혼선이 생긴다. 차단은 pdca-gate 훅만 한다.
test('V7: unresolved>0이어도, 입력이 깨져도, lcov를 못 읽어도 exit 0', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, '.devkit'), { recursive: true });
  fs.writeFileSync(path.join(root, '.devkit', 'receipts.jsonl'), '{깨진 줄\n{"ts":"2026-07-25T00:00:00.000Z","stdout":"x"}\n');
  writeCycle(root, '2026-07-25-hostile', [
    null, 42, 'nope', [],
    { id: 'B1', passes: true, evidence: { kind: 'test', ref: 't.ts', output: '✔ 없는 파일을 가리킨다', at: '2026-07-25' } },
    { id: 'B2', passes: true, evidence: { kind: 'test', ref: '../../etc/passwd', output: '✔ 루트 밖을 가리킨다', at: '2026-07-25' } },
    { id: 'B3', passes: true, target: 42, evidence: { kind: 'test', ref: 42, output: '✔ ref가 문자열이 아니다', at: '2026-07-25' } },
    { id: 'B4', passes: true, evidence: [] },
  ]);
  // 깨진 JSON 사이클 — readBehaviors가 null로 degrade해야 한다
  const broken = path.join(root, 'docs', '2026-07-25-broken');
  fs.mkdirSync(broken, { recursive: true });
  fs.writeFileSync(path.join(broken, 'behaviors.json'), '{ "behaviors": [ }');

  const cases = [
    ['--cycle', 'docs/2026-07-25-hostile'],
    ['--cycle', 'docs/2026-07-25-hostile', '--lcov', '.devkit'], // 디렉터리 (EISDIR)
    ['--cycle', 'docs/2026-07-25-hostile', '--lcov', 'nope/none.info'], // ENOENT
    ['--cycle', 'docs/2026-07-25-broken'],
    ['--cycle'], // 값 누락
    ['--cycle', 'docs/없는-사이클'],
  ];
  for (const args of cases) {
    const r = run(root, args);
    assert.equal(r.status, 0, `${args.join(' ')} → exit ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.equal(r.signal, null, `${args.join(' ')} 이 시그널로 죽었다: ${r.signal}`);
  }

  // 게이트 대상이 실제로 잡히면서도 exit은 0이어야 의미가 있다
  const r = run(root, ['--cycle', 'docs/2026-07-25-hostile']);
  assert.match(r.stdout, /unresolved: 2/, `깨진 엔트리에 가려 진짜 위조를 놓치면 안 된다:\n${r.stdout}`);
  assert.equal(r.status, 0);
});

// ── V8: 정보성 표시 — 게이트와 무관하다 ──────────────────
// lineDrift를 게이트로 올리면 파일이 줄어드는 정직한 리팩터가 위조로 판정된다(DESIGN §1.2).
// archive 폴백은 반대로 "왜 통과했는지"를 밝히지 않으면 폴백이 조용한 우회처럼 보인다.
test('V8: lineDrift와 archive 폴백을 정보성으로 표시한다 (unresolved에 안 센다)', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'short.js'), 'a\nb\nc\n');
  const archived = path.join(root, 'docs', 'archive', '2026-07-25', 'old');
  fs.mkdirSync(archived, { recursive: true });
  fs.writeFileSync(path.join(archived, 'REVIEW.md'), '# 리뷰\n');
  writeCycle(root, '2026-07-25-info', [
    {
      id: 'B1',
      passes: true,
      evidence: { kind: 'manual', ref: 'docs/2026-07-25-old/REVIEW.md', output: '리뷰를 사람이 읽고 확인했다', at: '2026-07-25' },
    },
    {
      id: 'B2',
      passes: true,
      evidence: { kind: 'test', ref: 'src/short.js:99', output: '✔ 짧은 파일을 검증했다', at: '2026-07-25' },
    },
  ]);

  const r = run(root, ['--cycle', 'docs/2026-07-25-info']);

  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /unresolved: 0/, `아카이빙된 사이클 문서를 위조로 몰면 안 된다:\n${r.stdout}`);
  assert.match(r.stdout, /lineDrift/, `${r.stdout}`);
  assert.match(r.stdout, /B2 .*src\/short\.js:99.*총 3줄/, `어느 ref가 몇 줄짜리인지 밝혀야 한다:\n${r.stdout}`);
  assert.match(r.stdout, /게이트 무관/, `게이트가 아님을 명시해야 한다:\n${r.stdout}`);
  assert.match(
    r.stdout, /B1 .*docs\/2026-07-25-old\/REVIEW\.md.*docs\/archive\/2026-07-25\/old\/REVIEW\.md/,
    `어디로 폴백했는지 밝혀야 조용한 우회로 안 보인다:\n${r.stdout}`,
  );
});

// ── R4: 보고서가 인용 원문을 싣지 않는다 ─────────────────
// 이 stdout은 bash-receipt가 그대로 봉인한다. 원문이 실리면 다음 실행에서
// checkCitation의 부분 문자열 검사에 걸려 위조가 'cited'로 뒤집힌다.
test('R4: uncited 보고는 인용 원문 대신 앞 24자만 싣는다', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'real.js'), 'module.exports = 1;\n');
  writeReceipts(root, [
    { ts: '2026-07-25T10:00:00.000Z', cmd: 'node --test', stdout: '✔ 전혀 관계없는 출력이다', stderr: '' },
  ]);
  const QUOTE = 'B9: 한 번도 실행된 적 없는 위조 주장이고 길이가 24자를 넘는다';
  // 인용 단위는 마커를 포함한 줄 통째다 — 보고서가 감춰야 하는 원문도 그 단위다
  const CITED = `✔ ${QUOTE}`;
  assert.ok(QUOTE.length > 24, '픽스처가 24자를 넘어야 의미가 있다');
  writeCycle(root, '2026-07-25-selfseal', [
    {
      id: 'B1',
      passes: true,
      evidence: {
        kind: 'test', ref: 'src/real.js', cmd: 'node --test', output: `✔ ${QUOTE}`, at: '2026-07-25',
      },
    },
  ]);

  const r = run(root, ['--cycle', 'docs/2026-07-25-selfseal']);

  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /uncited: 1/, `${r.stdout}`);
  assert.ok(
    !r.stdout.includes(CITED),
    `인용 원문이 보고서에 실렸다 — 봉인되면 다음 실행에서 cited로 뒤집힌다:\n${r.stdout}`,
  );
  assert.ok(
    r.stdout.includes(CITED.slice(0, 24)),
    `무엇을 못 찾았는지는 알아볼 수 있어야 한다:\n${r.stdout}`,
  );
  assert.match(
    r.stdout, new RegExp(`총 ${CITED.length}자`),
    `절단본과 원문을 구분하려면 총 길이를 밝혀야 한다:\n${r.stdout}`,
  );
});

// 리뷰의 라이브 재현 그대로 — 코드도 evidence도 안 건드리고 같은 명령만 3번 돌리면
// 1회차 uncited 1 → 2회차 보고서가 인용을 stdout에 출력 → 3회차 uncited 0 이었다.
// /gap이 이 명령을 Bash로 돌리라고 리터럴로 박아둔 실사용 경로다(commands/gap.md:31).
test('R4: 같은 명령을 3번 돌려도 위조는 uncited로 남는다 (봉인 자기입증 차단)', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'real.js'), 'module.exports = 1;\n');
  writeReceipts(root, [
    { ts: '2026-07-25T09:00:00.000Z', cmd: 'node --test', stdout: '✔ 전혀 관계없는 출력이다', stderr: '' },
  ]);
  writeCycle(root, '2026-07-25-loop', [
    {
      id: 'B1',
      passes: true,
      evidence: {
        kind: 'test',
        ref: 'src/real.js',
        // 주장한 명령은 실제로 돌아갔다(위 receipt) — 그래서 no-cmd-match로 도망갈 수 없고
        // 매 회차 진짜 대조가 일어난다. 그런데도 위조는 uncited로 남아야 한다.
        cmd: 'node --test',
        output: '✔ B1: 한 번도 실행된 적 없는 위조 주장이다 — 실행 로그에 존재할 수 없다',
        at: '2026-07-25',
      },
    },
  ]);

  const CMD = 'node scripts/verify-evidence.mjs --cycle docs/2026-07-25-loop';
  const seen = [];
  for (let i = 0; i < 3; i += 1) {
    const r = run(root, ['--cycle', 'docs/2026-07-25-loop']);
    seen.push((/uncited: (\d+)/.exec(r.stdout) || [])[1]);
    assert.match(r.stdout, /no-cmd-match: 0/, `대조가 실제로 일어난 상태여야 의미가 있다 (${i}회차):\n${r.stdout}`);
    // PostToolUse(Bash)가 이 실행을 봉인한다 — 실사용에서 자동으로 일어나는 일이다
    spawnSync(process.execPath, [path.join(repoRoot, 'hooks', 'bash-receipt.js')], {
      input: JSON.stringify({
        tool_input: { command: CMD },
        tool_response: { stdout: r.stdout, stderr: r.stderr, interrupted: false },
      }),
      cwd: root,
      encoding: 'utf8',
    });
  }

  assert.deepEqual(seen, ['1', '1', '1'], `보고서가 스스로를 입증해 탐지력이 0으로 수렴했다: ${seen.join(' → ')}`);
});

// R4(2회차): 자기입증에 개행 주입이 필요하다는 전제가 거짓이었다.
// 사람용 각 행은 `  ${field(r.id)}  …` 형태라 **id가 줄의 첫 non-space 문자**이고,
// 대조식(citation.js TICK_LINE_RE)은 앞 공백을 허용한다. 그래서 id를 '✔ …'로 시작하게
// 두는 것만으로 보고서에 대조 후보 줄이 그대로 생긴다 — 사람용 8개 섹션 전부.
// 게다가 이 벡터는 cmd·ref가 정직해 보여 사람 눈으로도 안 걸린다.
//
// ⚠ 2026-07-27 반전: `TICK_LINE_RE`는 없다. 마커 무관 전체 일치로 바뀌면서 **✔ 없이도**
// 보고 행이 대조 후보가 되므로 이 벡터는 오히려 넓어졌고, 그래서 방벽도 마커가 아니라
// 형태(' · ')로 옮겼다. id가 줄의 첫 non-space라는 관찰은 지금도 유효하다.
test('R4: behavior id가 ✔로 시작해도 보고서가 그 위조를 입증하지 않는다 (id 채널)', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'real.js'), 'module.exports = 1;\n');
  // 테스트와 검증을 한 줄로 잇는 복합 명령 — DESIGN §4.2가 정상 관례로 인정한 형태다.
  // 그래서 검증 보고서 자신이 이 evidence의 대조 후보가 된다(cmd 매칭이 성립한다).
  const CMD = 'node --test test/real.test.mjs && node scripts/verify-evidence.mjs --cycle docs/2026-07-25-idleak';
  writeReceipts(root, [
    { ts: '2026-07-25T09:00:00.000Z', cmd: CMD, stdout: '✔ 전혀 관계없는 출력이다', stderr: '' },
  ]);
  const LEAK = 'ZZZ-LEAK: 한 번도 실행된 적 없는 위조 인용이다';
  writeCycle(root, '2026-07-25-idleak', [
    {
      // 개행이 없다. 이 값이 그대로 행 선두에 놓이는 것이 벡터의 전부다.
      id: `✔ ${LEAK}`,
      passes: true,
      evidence: {
        kind: 'test',
        ref: 'src/real.js',
        cmd: CMD, // 실제로 돌아간 명령 — no-cmd-match로 도망갈 수 없다
        output: `✔ ${LEAK}`,
        at: '2026-07-25',
      },
    },
  ]);

  const seen = [];
  const ticks = [];
  for (let i = 0; i < 3; i += 1) {
    const r = run(root, ['--cycle', 'docs/2026-07-25-idleak']);
    seen.push((/uncited: (\d+)/.exec(r.stdout) || [])[1]);
    assert.match(r.stdout, /no-cmd-match: 0/, `대조가 실제로 일어난 상태여야 의미가 있다 (${i}회차):\n${r.stdout}`);
    // 원인의 판정식도 계약을 따라간다: 구 기준은 '선두 ✔'였고 그 근거가 소멸했다.
    // 이제 후보 조건은 형태다 — 길이 하한 이상 + SEP 부재(citableLinesOf).
    for (const l of citableLinesOf(r.stdout)) ticks.push(`${i}회차 ${JSON.stringify(l)}`);
    // PostToolUse(Bash)가 이 실행을 봉인한다 — 실사용에서 자동으로 일어나는 일이다
    spawnSync(process.execPath, [path.join(repoRoot, 'hooks', 'bash-receipt.js')], {
      input: JSON.stringify({
        tool_input: { command: CMD },
        tool_response: { stdout: r.stdout, stderr: r.stderr, interrupted: false },
      }),
      cwd: root,
      encoding: 'utf8',
    });
  }

  assert.deepEqual(seen, ['1', '1', '1'], `id 채널로 자기입증이 성립했다 — uncited ${seen.join(' → ')}`);
  // 원인까지 고정한다. 결과(uncited 유지)만 보면 cmd 매칭이 우연히 막아준 상황과 구분되지 않는다.
  assert.deepEqual(ticks, [], `보고서가 대조 후보 형태의 줄을 냈다:\n${ticks.join('\n')}`);
});

// ── B4: 보고 출력에 인용 원문이 실리지 않는다 (불변식) ────
// SELF_RE(이름 블랙리스트)를 없앤 대가로 이 불변식이 자기입증을 막는 유일한 방벽이 된다.
// evidence.cmd가 검증을 포함한 복합 명령이면 그 receipt는 이제 정상 매칭되고, 그 stdout에는
// 보고서 자신이 들어 있다 — preview가 원문을 그대로 내보내면 다음 실행에서 cited로 뒤집힌다.
const row = (over) => ({
  id: 'B1',
  ref: 'src/real.js',
  refResult: null,
  cite: {
    status: 'skipped', quotes: [], hits: [], cmd: null, matched: 0, truncatedNearby: false,
  },
  target: null,
  cov: { status: 'no-data', uncoveredLines: [], deadBranches: [] },
  ...over,
});

const citeRow = (q) => row({
  cite: {
    status: 'uncited', quotes: [q], hits: [q], cmd: 'node --test test/x.test.mjs', matched: 1, truncatedNearby: false,
  },
});

const EMPTY_GROUPS = {
  unresolved: [], uncited: [], noReceipt: [], noCmdMatch: [], deadBranch: [], uncovered: [], drifted: [], viaArchive: [],
};

const viewOf = (r, group = 'uncited') => ({
  cycle: 'docs/2026-07-26-x',
  lcov: '.devkit/lcov.info',
  counts: {
    total: 1,
    evaluated: 0,
    unresolved: 0,
    uncited: 1,
    noReceipt: 0,
    noCmdMatch: 0,
    uncovered: 0,
    deadBranch: 0,
    noData: 1,
    lineDrift: 0,
    viaArchive: 0,
  },
  rows: [r],
  receipts: { present: true, firstDate: '2026-07-26' },
  groups: { ...EMPTY_GROUPS, [group]: [r] },
});

test('B4: 어떤 길이의 인용도 보고 출력(사람용·--json)에 원문 그대로 실리지 않는다', () => {
  for (const len of [8, 24, 25, 60]) { // MIN_QUOTE=8 ~ 기존 QUOTE_HEAD 경계 전후
    const q = (`B4:${len}` + '가'.repeat(len)).slice(0, len);
    assert.equal(q.length, len, '픽스처 길이가 의도와 달라졌다');
    const v = viewOf(citeRow(q));

    const human = formatHuman(v);
    assert.ok(!human.includes(q), `길이 ${len}: 사람용 보고에 인용 원문이 실렸다 — 봉인되면 자기입증된다:\n${human}`);
    assert.match(human, new RegExp(`총 ${len}자`), `길이 ${len}: 절단본과 원문을 구분하려면 총 길이를 밝혀야 한다`);

    const json = JSON.stringify(toJson(v));
    assert.ok(!json.includes(q), `길이 ${len}: --json의 quotes/hits에 인용 원문이 실렸다:\n${json}`);
  }
});

// preview 불변식의 반례 (REVIEW 🟡1) — "머리 q.length-1자"만으로는 진부분 접두사가 보장되지
// 않는다. 접두사가 마커('…(총 N자)')와 이어져 원문을 재구성하는 주기적 문자열이 있다:
// q = '…'.repeat(7) + '(' → 머리 '…'×7 + 마커 '…(…' 에서 q가 그대로 다시 나타난다.
// 실제로 2회차에 uncited → cited 전환까지 재현됐다. 길이가 아니라 형태가 원인이므로
// 경계값 몇 개가 아니라 적대적 입력으로 잠근다.
test('B4: preview 불변식 — 주기적 문자열에서도 원문이 재구성되지 않는다', () => {
  const cases = [
    ['길이 1(주기적)', '…'],
    ['길이 2(주기적)', '……'],
    ['길이 8(주기적)', '…'.repeat(7) + '('], // MIN_QUOTE 도달 — 실제로 인용 후보가 될 수 있다
    ['길이 8', '가'.repeat(8)],
    ['길이 24', '가'.repeat(24)], // QUOTE_HEAD 경계
    ['길이 25', '가'.repeat(25)],
    ['길이 60', '나'.repeat(60)],
    ['마커 모양', '(총 6자)'], // 마커 자신을 흉내 내는 인용
  ];

  const leaked = [];
  for (const [name, q] of cases) {
    const human = formatHuman(viewOf(citeRow(q)));
    const json = JSON.stringify(toJson(viewOf(citeRow(q))));
    if (human.includes(q)) leaked.push(`사람용 ← ${name} ${JSON.stringify(q)}`);
    if (json.includes(q)) leaked.push(`--json ← ${name} ${JSON.stringify(q)}`);
  }
  assert.deepEqual(leaked, [], `축약 결과가 원문을 다시 담고 있다 — 봉인되면 자기입증된다:\n${leaked.join('\n')}`);

  // 빈 문자열은 모든 문자열의 부분 문자열이라 불변식이 정의되지 않는다 — 죽지만 않으면 된다
  assert.doesNotThrow(() => formatHuman(viewOf(citeRow(''))), '빈 인용에 죽으면 보고 층이 통째로 멈춘다');
  assert.doesNotThrow(() => toJson(viewOf(citeRow(''))));
});

// 불변식은 함수(preview)가 아니라 **출력 경로 전체**에 건다 (REVIEW 🔴2).
// 위 테스트는 uncited 그룹의 quotes/hits만 밟는다 — 같은 stdout에 evidence.cmd·ref·missing·
// escaped가 흐르는데 거기엔 아무 방벽이 없었다. 셋 다 위조자 통제 필드다.
//
// 여기서 막아야 하는 것은 "원문 노출" 자체가 아니라 **자기입증이 성립하는 형태**다.
// 대조는 이제 '✔로 시작하는 줄'에서만 일어나므로(citation.js tickLines), 보고서가
// 자기입증 채널이 되는 조건은 정확히 하나 — 이 stdout에 ✔로 시작하는 줄이 생기는 것.
// 위조자는 필드에 개행을 심어 그 줄을 만든다.
//
// ⚠ 위 두 문단은 2026-07-27에 뒤집혔다(원래 기록 자리에 남긴다). `tickLines`도
// `TICK_LINE_RE`도 더 이상 존재하지 않는다 — 대조가 마커 무관 **한 줄 전체 일치**로
// 바뀌면서 "✔로 시작하는 줄"이라는 조건 자체가 사라졌다. 지금 자기입증을 막는 것은
// `emit`/`diag.warn`이 강제하는 **형태**(모든 줄이 ' · '를 품거나 8자 미만)다.
// 이 테스트가 겨냥하는 위험(보고서 한 행이 봉인돼 다음 회차에 위조를 입증하는 것)은
// 그대로라 테스트는 살아 있고, 단언만 형태 쪽으로 옮겨졌다.
// ⚠ 원문 축약(preview)으로 이 필드들을 덮을 수는 없다: V4(ref)·V5(cmd)·V8(lineDrift)·
//   V9(--json ref/missing)가 원문 그대로를 사람/기계 판독 계약으로 고정하고 있다.
const LEAK = 'ZZZ-LEAK: 한 번도 실행된 적 없는 위조 인용이다';

// 주입 형태는 둘이다. 1회차는 (a)만 상정하고 "개행을 죽이면 그 줄은 만들어질 수 없다"고
// 닫았지만, 그 근거인 "모든 필드는 줄 선두가 아니다"가 거짓이었다 — (b)가 실제로 통했다.
// ⚠ 이제 마커는 필요 없다. 대조가 마커 무관 전체 일치라 **평범한 긴 문자열**이 곧 후보다.
const PAYLOADS = [
  ['(a) 개행 주입', `무해해 보이는 값\n${LEAK}`], // 보고서 한복판에 후보 줄을 만든다
  ['(b) 선두 배치', LEAK], // 줄 선두에 놓이는 필드면 개행이 필요 없다
];

/**
 * id는 **모든 섹션의 행 선두**에 찍힌다(`  ${field(r.id)}  …`). 즉 채널이 필드 하나가
 * 아니라 섹션 수만큼이다 — 하나만 밟으면 나머지 7개가 다음 회차에 다시 샌다(R4 2회차).
 */
const idChannels = (q) => [
  ['unresolved', row({ id: q, refResult: { status: 'unresolved', missing: ['t.ts'], escaped: [], lineDrift: [], via: {} } })],
  ['uncited', row({ id: q, cite: { status: 'uncited', quotes: ['무해한 인용이다'], hits: [], cmd: 'node --test test/x.test.mjs', matched: 1, truncatedNearby: false } })],
  ['noCmdMatch', row({ id: q, cite: { status: 'no-cmd-match', quotes: ['무해한 인용이다'], hits: [], cmd: 'node --test test/x.test.mjs', matched: 0, truncatedNearby: false } })],
  ['noReceipt', row({ id: q, cite: { status: 'no-receipt', quotes: ['무해한 인용이다'], hits: [], cmd: null, matched: 0, truncatedNearby: false } })],
  ['deadBranch', row({ id: q, target: 'src/real.js:1', cov: { status: 'dead-branch', uncoveredLines: [], deadBranches: [{ line: 1 }] } })],
  ['uncovered', row({ id: q, target: 'src/real.js:1', cov: { status: 'uncovered', uncoveredLines: [1], deadBranches: [] } })],
  ['drifted', row({ id: q, refResult: { status: 'resolved', missing: [], escaped: [], lineDrift: ['src/real.js:99 (총 3줄)'], via: {} } })],
  // viaArchive 항목은 행이 아니라 {id, from}이다 — 같은 객체에 from을 얹어 그 섹션도 밟는다
  ['viaArchive', row({ id: q, from: 'docs/2026-07-25-old/REVIEW.md' })],
].map(([group, r]) => ({ name: `id (${group} 섹션)`, group, row: r }));

// 각 채널 = "위조 문자열이 보고서로 흘러나가는 evidence 필드 하나"
const leakChannels = (q) => [
  ...idChannels(q),
  {
    name: 'cite.cmd (no-cmd-match)',
    group: 'noCmdMatch',
    row: row({
      cite: {
        status: 'no-cmd-match', quotes: ['무해한 인용이다'], hits: [], cmd: `node --test test/nope.test.mjs ${q}`, matched: 0, truncatedNearby: false,
      },
    }),
  },
  {
    name: 'ref + refResult.missing (unresolved)',
    group: 'unresolved',
    row: row({
      ref: q,
      refResult: {
        status: 'unresolved', missing: [q], escaped: [], lineDrift: [], via: {},
      },
    }),
  },
  {
    name: 'ref (uncited 섹션)',
    group: 'uncited',
    row: row({
      ref: q,
      cite: {
        status: 'uncited', quotes: ['무해한 인용이다'], hits: [], cmd: 'node --test test/x.test.mjs', matched: 1, truncatedNearby: false,
      },
    }),
  },
  {
    name: 'refResult.escaped (unresolved)',
    group: 'unresolved',
    row: row({
      refResult: {
        status: 'unresolved', missing: [], escaped: [q], lineDrift: [], via: {},
      },
    }),
  },
  {
    name: 'refResult.lineDrift (정보성 섹션)',
    group: 'drifted',
    row: row({
      refResult: {
        status: 'resolved', missing: [], escaped: [], lineDrift: [q], via: {},
      },
    }),
  },
];

/**
 * citation.js의 대조 조건과 같은 형태 — 이 줄이 하나라도 있으면 봉인 후 대조 후보가 된다.
 * ⚠ 구 판정식은 `/^\s*[✔✓]\s/`(선두 tick)였다. 대조가 마커 무관 전체 일치로 바뀌면서
 *   그 전제가 소멸했다 — 이제 후보 조건은 **길이 하한과 SEP 부재**다. 인용 조각은
 *   normalize 후 SEP로 잘리므로 SEP를 품은 줄은 어떤 인용과도 같아질 수 없다.
 */
const citable = (line) => {
  const s = normalize(line);
  return s.length >= MIN_QUOTE && !s.includes(SEP);
};
const citableLinesOf = (text) => text.split('\n').filter(citable);

// 템플릿 위생 — 사람용 14개 행 템플릿이 스스로 형태 규칙을 지키는지 본다.
// emit의 자동 교정은 백스톱이지 1차 방어가 아니다(정상 보고서에 'devkit · ' 접두가 붙으면
// 사람이 읽기 나빠진다). 진짜 불변식은 프로세스 경계의 B11이 본다.
test('B4: 사람용 보고 전문의 어떤 줄도 대조 후보가 될 수 없다 (템플릿 위생)', () => {
  const leaked = [];
  for (const [pname, q] of PAYLOADS) {
    for (const ch of leakChannels(q)) {
      const v = viewOf(ch.row, ch.group);
      for (const l of citableLinesOf(formatHuman(v))) leaked.push(`사람용 ← ${pname} ${ch.name}: ${JSON.stringify(l)}`);
      // --json은 CLI가 한 줄로 낸다 — 들여쓰기 여부까지 포함한 실제 형태는 B11이 프로세스에서 본다
      for (const l of citableLinesOf(JSON.stringify(toJson(v)))) leaked.push(`--json ← ${pname} ${ch.name}: ${JSON.stringify(l)}`);
    }
  }
  assert.deepEqual(leaked, [], `보고서가 대조 후보 형태의 줄을 냈다 — 봉인되면 다음 실행에서 위조가 cited로 뒤집힌다:\n${leaked.join('\n')}`);
});

// ── R6/R7: 불변식을 함수가 아니라 **프로세스 경계**에 건다 ──────────────
// 세 번의 실패가 전부 같은 형태였다: preview(quotes/hits만) → field(필드만) → detick
// (formatHuman 안만). 방벽은 매번 맞았고 **범위가 좁았으며**, 세 번 다 테스트가 그 방벽
// 함수를 직접 호출해서(=테스트 경계 == 방벽 경계) 함수 밖의 출력을 한 번도 못 봤다.
// 그래서 여기서는 CLI를 spawn해 **stdout + stderr 전문**을 본다. formatHuman을 안 거치는
// 출구(사이클 미결정·behaviors.json 부재·파싱 실패)가 전부 이 단언 안에 들어온다 —
// 방벽이 몇 개고 어디에 있는지를 사람이 아니라 이 테스트가 검사한다.
const PROC_LEAK = 'ZZZ-PROC: 한 번도 실행된 적 없는 위조 인용이다';

/** CLI를 실제로 띄워 stdout+stderr에서 대조 후보 줄을 긁는다 */
function procCitableLines(root, args) {
  const r = run(root, args);
  assert.equal(r.status, 0, `보고 도구는 항상 0이다:\n${r.stdout}\n${r.stderr}`);
  return [
    ...citableLinesOf(r.stdout).map((l) => `stdout ${JSON.stringify(l)}`),
    ...citableLinesOf(r.stderr).map((l) => `stderr ${JSON.stringify(l)}`),
  ];
}

/** PostToolUse(Bash)가 하는 일 그대로 — 이 실행의 화면 출력을 봉인한다 */
function seal(root, cmd, r) {
  spawnSync(process.execPath, [path.join(repoRoot, 'hooks', 'bash-receipt.js')], {
    input: JSON.stringify({
      tool_input: { command: cmd },
      tool_response: { stdout: r.stdout, stderr: r.stderr, interrupted: false },
    }),
    cwd: root,
    encoding: 'utf8',
  });
}

/** 8섹션을 전부 채우면서 위조자 통제 값이 모든 행 선두에 놓이는 사이클 */
function writeHostileCycle(root, id, payload) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'real.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(root, 'src', 'short.js'), 'a\nb\nc\n');
  fs.mkdirSync(path.join(root, '.devkit'), { recursive: true });
  fs.writeFileSync(path.join(root, '.devkit', 'lcov.info'), LCOV_FIXTURE);
  fs.writeFileSync(path.join(root, 'src', 'discount.js'), 'x\n'.repeat(5));
  const archived = path.join(root, 'docs', 'archive', '2026-07-25', 'old');
  fs.mkdirSync(archived, { recursive: true });
  fs.writeFileSync(path.join(archived, 'REVIEW.md'), '# 리뷰\n');
  // uncited·no-cmd-match 섹션이 실제로 채워지려면 매칭되는 봉인이 있어야 한다
  writeReceipts(root, [
    { ts: '2026-07-26T00:00:00.000Z', cmd: `node --test test/x.test.mjs ${payload}`, stdout: '전혀 관계없는 출력이다\n', stderr: '' },
  ]);
  const ev = (over) => ({
    kind: 'test', ref: 'src/real.js', output: payload, at: '2026-07-26', ...over,
  });
  return writeCycle(root, id, [
    { id: `${payload} unresolved`, passes: true, evidence: ev({ ref: `없는파일.ts\n${payload}` }) },
    { id: `${payload} escaped`, passes: true, evidence: ev({ ref: `../../etc/${payload}` }) },
    { id: `${payload} uncited`, passes: true, evidence: ev({ cmd: `node --test test/x.test.mjs ${payload}` }) },
    { id: `${payload} noCmdMatch`, passes: true, evidence: ev({ cmd: `node --test ${payload}\n${payload}` }) },
    { id: `${payload} noReceipt`, passes: true, evidence: ev({ cmd: 'node --test test/x.test.mjs', at: '2020-01-01' }) },
    { id: `${payload} drift`, passes: true, evidence: ev({ ref: 'src/short.js:99' }) },
    { id: `${payload} archive`, passes: true, evidence: ev({ kind: 'manual', ref: 'docs/2026-07-25-old/REVIEW.md' }) },
    { id: `${payload} deadBranch`, passes: true, target: 'src/discount.js:2', evidence: ev({}) },
    { id: `${payload} uncovered`, passes: true, target: 'src/discount.js:3', evidence: ev({}) },
  ]);
}

// ── B11: 검증 도구 자신의 출력이 위조를 입증하지 않는다 ────────────────
// 형태와 결과를 **한 테스트에** 둔다. 형태만 보면 결과와의 연결이 논증이고, 결과만 보면
// 우연히 막힌 상황(cmd 매칭이 어쩌다 안 걸림)과 구분되지 않는다.
//
// ⚠ 이 벡터는 §8-0에서 e2e로 **실제 재현됐다**: decoy behavior의 id·ref만으로 보고서
//   unresolved 행 한 줄(`  DECOY  ref "src/ghost.js"  파일 없음 src/ghost.js`)이 조립되고,
//   다른 behavior가 그 줄을 evidence.output으로 적으면 1회 봉인 후 2회차에 uncited → cited.
//   마커가 없어졌으므로 tick 없이 성립한다 — 그래서 방벽도 마커가 아니라 형태에 건다.
test('B11: CLI 출력의 어떤 줄도 대조 후보가 될 수 없고(형태), 3회 봉인해도 위조가 뒤집히지 않는다(결과)', () => {
  const leaked = [];

  // ── 형태 ──
  // (1) 사이클 미결정 — formatHuman을 안 거치는 출구
  leaked.push(...procCitableLines(makeRoot(), []).map((l) => `미결정 ← ${l}`));

  // (2) behaviors.json 부재 + cycleId에 개행+페이로드 — 헤더가 cycleId를 그대로 보간한다
  const rootA = makeRoot();
  writeState(rootA, `2026-07-25-a\n${PROC_LEAK}`);
  leaked.push(...procCitableLines(rootA, []).map((l) => `벡터A(behaviors 부재) ← ${l}`));

  // (3) behaviors.json 파싱 실패 — SyntaxError가 입력 스니펫을 **개행째로** 담아 stderr로 나간다.
  //     위조 의도가 없어도 발생한다: 테스트 출력을 붙여넣다 JSON을 깨뜨리면 그 줄이 봉인된다.
  const rootB = makeRoot();
  const cycleB = path.join(rootB, 'docs', '2026-07-25-b');
  fs.mkdirSync(cycleB, { recursive: true });
  fs.writeFileSync(path.join(cycleB, 'behaviors.json'), `[1,\n${PROC_LEAK}`);
  leaked.push(...procCitableLines(rootB, ['--cycle', 'docs/2026-07-25-b']).map((l) => `벡터B(파싱 실패) ← ${l}`));

  // (4) 적대 페이로드 × 8섹션 — id·ref·cmd·lineDrift·viaArchive가 전부 행 선두에 놓인다
  for (const [pname, payload] of PAYLOADS) {
    const rootC = makeRoot();
    writeHostileCycle(rootC, '2026-07-26-proc', payload);
    for (const args of [['--cycle', 'docs/2026-07-26-proc'], ['--cycle', 'docs/2026-07-26-proc', '--json']]) {
      const label = args.includes('--json') ? '--json' : '사람용';
      leaked.push(...procCitableLines(rootC, args).map((l) => `${pname} ${label} ← ${l}`));
    }
  }

  assert.deepEqual(
    leaked, [],
    '프로세스 출력에 대조 후보 형태의 줄이 있다 — 이 stdout/stderr는 bash-receipt가 봉인하므로\n'
    + `다음 실행에서 위조가 cited로 뒤집힌다:\n${leaked.join('\n')}`,
  );

  // ── 결과 ── §1.3 cross-row 조립 벡터로 3회 봉인 루프
  const root = makeRoot();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'real.js'), 'module.exports = 1;\n');
  const CYCLE = '2026-07-26-crossrow';
  const CMD = `node scripts/verify-evidence.mjs --cycle docs/${CYCLE}`;
  // decoy의 id·ref만으로 보고서 unresolved 행 한 줄이 조립된다 — 고정 텍스트까지 베껴 적는다
  const ASSEMBLED = 'DECOY ref "src/ghost.js" 파일 없음 src/ghost.js';
  writeReceipts(root, [
    // 매칭 후보가 이미 있어야 1회차가 uncited다(없으면 no-cmd-match로 도망간다)
    { ts: '2026-07-26T00:00:00.000Z', cmd: CMD, stdout: '전혀 관계없는 출력이다\n', stderr: '' },
  ]);
  writeCycle(root, CYCLE, [
    { id: 'DECOY', passes: true, evidence: { kind: 'manual', ref: 'src/ghost.js', output: '사람이 눈으로 확인했다', at: '2026-07-26' } },
    {
      id: 'FORGED',
      passes: true,
      evidence: {
        kind: 'test', ref: 'src/real.js', cmd: CMD, output: ASSEMBLED, at: '2026-07-26',
      },
    },
  ]);

  const seen = [];
  for (let i = 0; i < 3; i += 1) {
    const r = run(root, ['--cycle', `docs/${CYCLE}`]);
    seen.push((/uncited: (\d+)/.exec(r.stdout) || [])[1]);
    assert.match(r.stdout, /no-cmd-match: 0/, `대조가 실제로 일어난 상태여야 의미가 있다 (${i}회차):\n${r.stdout}`);
    seal(root, CMD, r);
  }
  assert.deepEqual(
    seen, ['1', '1', '1'],
    `cross-row 조립으로 자기입증이 성립했다 — uncited ${seen.join(' → ')}\n`
    + '보고서 한 행이 위조자 통제 값만으로 조립되고, 그 행이 봉인돼 다음 회차에 인용을 입증했다',
  );
});

test('B4: 위조자 통제 필드는 길이 상한을 받는다 (cmd는 원문 그대로 찍혔다)', () => {
  const huge = `node --test ${'a'.repeat(4000)}.test.mjs`; // MAX_COMMAND 4096까지 심을 수 있다
  const v = viewOf(row({
    cite: {
      status: 'no-cmd-match', quotes: ['무해한 인용이다'], hits: [], cmd: huge, matched: 0, truncatedNearby: false,
    },
  }), 'noCmdMatch');

  const human = formatHuman(v);
  assert.ok(!human.includes(huge), `길이 제한 없이 그대로 찍으면 보고서가 통째로 위조자 통제다:\n${human.slice(0, 300)}`);
  assert.match(human, new RegExp(`총 ${huge.length}자`), '절단본을 원문으로 오해하지 않게 총 길이를 밝혀야 한다');
});

// ── R3: 막는 쪽과 보고하는 쪽의 root가 같아야 한다 ────────
// 게이트는 findProjectRoot(cycleDir), CLI는 findProjectRoot(process.cwd())였다.
// 워크스페이스 패키지가 자기 package.json을 가지면 두 값이 갈리고, 사용자는
// "unresolved: 0"을 보고 REPORT.md를 쓰다가 원인 불명으로 차단된다
// (DESIGN 설계원칙 6 — 막는 쪽과 만드는 쪽의 판정 근거는 대칭).
test('R3: 모노레포에서 CLI가 게이트와 같은 root로 판정한다', () => {
  const mono = makeRoot(); // .git + 여기가 cwd
  fs.writeFileSync(path.join(mono, 'package.json'), '{"name":"mono"}\n');
  const pkg = path.join(mono, 'pkg');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), '{"name":"pkg"}\n'); // 여기가 게이트의 root

  // 파일은 모노레포 루트에만 있다 — pkg를 root로 보면 없는 파일이다
  fs.mkdirSync(path.join(mono, 'src'));
  fs.writeFileSync(path.join(mono, 'src', 'real.js'), 'module.exports = 1;\n');

  const cycle = path.join(pkg, 'docs', '2026-07-25-mono');
  fs.mkdirSync(cycle, { recursive: true });
  fs.writeFileSync(path.join(cycle, 'GAP.md'), '# gap\n');
  fs.writeFileSync(path.join(cycle, 'REVIEW.md'), '# review\n');
  fs.writeFileSync(path.join(cycle, 'behaviors.json'), JSON.stringify({
    version: 1,
    cycleId: '2026-07-25-mono',
    behaviors: [{
      id: 'B1',
      passes: true,
      evidence: { kind: 'test', ref: 'src/real.js:1', output: '✔ 모노레포 경로를 검증했다', at: '2026-07-25' },
    }],
  }));

  // 게이트: REPORT.md Write를 시도한다
  const gate = spawnSync(
    process.execPath, [path.join(repoRoot, 'hooks', 'pdca-gate.js')],
    {
      input: JSON.stringify({ tool_input: { file_path: path.join(cycle, 'REPORT.md'), content: '# 보고\n' } }),
      cwd: mono,
      encoding: 'utf8',
    },
  );
  const blocked = gate.status === 2;

  const r = run(mono, ['--cycle', 'pkg/docs/2026-07-25-mono']);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const reported = /unresolved: 0/.test(r.stdout);

  assert.equal(
    blocked, !reported,
    '게이트와 CLI가 갈렸다 — CLI는 "unresolved: 0"인데 REPORT.md가 차단되면 원인 불명 데드락이다\n'
    + `gate exit=${gate.status} stderr=${gate.stderr}\nCLI:\n${r.stdout}`,
  );
  // 방향까지 고정한다 — 둘 다 "통과"로 수렴해도 대칭은 성립하므로 그것만 보면 위조가 샌다.
  // pkg가 root이므로 src/real.js는 실제로 없는 파일이고, 양쪽 다 그렇게 말해야 한다.
  assert.equal(blocked, true, `게이트가 막아야 한다: exit=${gate.status}`);
  assert.match(r.stdout, /unresolved: 1/, `CLI도 같은 판정을 내야 한다:\n${r.stdout}`);
});

// ── V9: --json — 기계가 읽는 출력 ────────────────────────
// 사람용 출력에 JSON을 섞으면 둘 다 못 쓴다. --json이면 파싱 가능한 JSON 하나만 낸다.
test('V9: --json은 파싱 가능한 JSON 하나만 내고 counts가 사람용과 일치한다', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'discount.js'), 'x\n'.repeat(5));
  fs.mkdirSync(path.join(root, '.devkit'), { recursive: true });
  fs.writeFileSync(path.join(root, '.devkit', 'lcov.info'), LCOV_FIXTURE);
  writeCycle(root, '2026-07-25-json', [
    {
      id: 'B1',
      passes: true,
      target: 'src/discount.js:2',
      evidence: { kind: 'test', ref: 't.ts', output: '✔ 없는 파일을 가리킨다', at: '2026-07-25' },
    },
  ]);

  const r = run(root, ['--cycle', 'docs/2026-07-25-json', '--json']);

  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  let doc;
  assert.doesNotThrow(() => { doc = JSON.parse(r.stdout); }, `JSON 하나만 나와야 한다:\n${r.stdout}`);
  assert.equal(doc.cycle, 'docs/2026-07-25-json');
  assert.equal(doc.counts.unresolved, 1);
  assert.equal(doc.counts.deadBranch, 1);

  const b1 = doc.behaviors.find((b) => b.id === 'B1');
  assert.equal(b1.ref, 't.ts', `어느 ref인지 기계도 알아야 한다:\n${r.stdout}`);
  assert.equal(b1.refStatus, 'unresolved');
  assert.deepEqual(b1.missing, ['t.ts']);
  assert.equal(b1.coverage, 'dead-branch');

  // 사람용과 같은 판정이어야 한다 — 두 출력이 갈리면 어느 쪽을 믿을지 알 수 없다
  const human = run(root, ['--cycle', 'docs/2026-07-25-json']);
  assert.match(human.stdout, /unresolved: 1/, human.stdout);
  assert.match(human.stdout, /dead-branch: 1/, human.stdout);
});

// ── emit 백스톱은 무조건이어야 한다 (1회차 리뷰 🟡1) ──────────
// 접두 하나로는 부족했다: normalize의 소요시간 제거가 접두 SEP의 뒤 공백을 먹어
// 교정 후에도 citable이 남는다. 백스톱이 조건부면 "선언한 범위 > 실제 경계"의
// 또 다른 형태다 — 이 프로젝트가 네 번 밟은 패턴이라 테스트로 고정한다.
test('emit: 어떤 줄을 넣어도 교정 결과는 대조 후보가 아니다 (백스톱 무조건)', () => {
  const citable = (s) => {
    const n = normalize(s);
    return n.length >= MIN_QUOTE && !n.includes(SEP);
  };
  const cases = [
    '  (1234ms)abc · (1234ms)abc', // 1회차 리뷰의 반례 — 접두만으로는 안 닫힌다
    '(12345s)', '  (1.5s)(200ms)xxxxxxxx',
    'evidence 검증 — docs/x/', '❌ unresolved', '정상적인 긴 줄입니다 여기',
    '', '   ', '짧다',
  ];
  for (const c of cases) {
    const w = process.stdout.write;
    let buf = '';
    process.stdout.write = (s) => { buf += s; return true; };
    try { emit(c); } finally { process.stdout.write = w; }
    assert.equal(citable(buf), false, `교정 후에도 대조 후보다: ${JSON.stringify(c)} → ${JSON.stringify(buf)}`);
  }
});
