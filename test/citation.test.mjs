// 인용 대조 계약 — "evidence가 주장한 명령을 실제로 실행했고, 그 출력에 인용이 있는가".
// 봉인(receipt.js)과 분리된 순수 모듈이라 fs 없이 receipts view를 직접 만들어 검증한다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(dir, '..');
const require = createRequire(import.meta.url);
const { checkCitation, extractQuotes } = require(path.join(repoRoot, 'hooks', 'lib', 'citation.js'));
// 봉인 쪽은 정본에서 그대로 가져다 쓴다 — 재export하지 않는다(두 벌 금지)
const { appendReceipt, readReceipts, FILE } = require(path.join(repoRoot, 'hooks', 'lib', 'receipt.js'));

// receipt ts는 UTC ISO다. 시스템 날짜가 무엇이든 같은 기준으로 비교해야 테스트가 안 흔들린다.
const TODAY = new Date().toISOString().slice(0, 10);
const ev = (o) => ({ kind: 'test', ref: 'test/x.test.mjs:1', cmd: 'node --test', at: TODAY, ...o });

// 실제 봉인을 거치는 테스트는 임시 root에 쓰고 after()에서 지운다
const tmpDirs = [];
function makeRoot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-citation-'));
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

/** readReceipts의 반환 형태를 직접 만든다 — 대조는 파일을 모른다 */
function view(records) {
  const dates = records.map((r) => String(r.ts).slice(0, 10)).sort();
  return { records, present: true, firstDate: dates[0] ?? null };
}
const rec = (cmd, stdout, stderr = '') => ({ ts: `${TODAY}T10:00:00.000Z`, cmd, stdout, stderr });

// ── B1: evidence.cmd와 무관한 receipt는 대조 후보가 아니다 ──
// D15의 정확한 재현 — git diff·cat으로 인용 원문이 화면에 나와도 그건 "실행 흔적"이 아니다.
const B1_QUOTE = 'B1: evidence.cmd와 연관 없는 receipt는 대조 후보에서 제외';

test('B1: git diff·cat 출력에 인용이 실려도 cited가 되지 않는다 (무관한 receipt는 후보 아님)', () => {
  const rs = view([
    rec('git diff --cached', `+  { "id": "B1", "output": "✔ ${B1_QUOTE}" }\n`),
    rec('cat docs/2026-07-26-x/behaviors.json', `{"behaviors":[{"id":"B1","evidence":{"output":"✔ ${B1_QUOTE}"}}]}\n`),
  ]);

  const c = checkCitation(ev({ cmd: 'node --test test/receipt.test.mjs', output: `✔ ${B1_QUOTE}` }), rs);

  assert.equal(c.status, 'no-cmd-match', '주장한 명령을 실행한 receipt가 없다');
  assert.deepEqual(c.hits, [], '무관한 receipt의 출력이 hay에 들어가면 안 된다');
  assert.equal(c.matched, 0);
});

// ── B1: 대조는 '✔로 시작하는 줄'에서만 한다 ────────────────
// REVIEW 🔴1. cmd 매칭은 "무관한 receipt"를 뺄 뿐, evidence.cmd를 정하는 것도 위조자다.
// 위조자가 cmd를 맞춰 적으면(echo·cat·git diff) 그 stdout이 hay가 되어 자기입증이 부활한다.
// extractQuotes가 이미 '✔로 시작하는 조각'만 후보로 뽑으므로, 대조 양쪽의 형태를 맞춘다 —
// 규칙 추가가 아니라 인정 조건 축소다.
const R1_QUOTE = 'ZZZ: 한 번도 실행된 적 없는 위조 인용이다';

test('B1: ✔로 시작하지 않는 줄에 인용이 실려 있으면 cited가 아니다 (echo·cat·git diff)', () => {
  // 위조자가 cmd를 receipt와 맞춰 적은 3벡터. 셋 다 매칭(matched:1)까지는 성립한다 —
  // 막히는 자리는 후보 선정이 아니라 hay다.
  const vectors = [
    ['(a) echo', 'node --test test/x.test.mjs',
      `echo "node --test test/x.test.mjs → ✔ ${R1_QUOTE}"`,
      `node --test test/x.test.mjs → ✔ ${R1_QUOTE}\n`],
    ['(b) cat behaviors.json', 'cat docs/2026-07-26-x/behaviors.json',
      'cat docs/2026-07-26-x/behaviors.json',
      `{\n  "output": "✔ ${R1_QUOTE}",\n  "at": "${TODAY}"\n}\n`],
    ['(c) git diff', 'git diff HEAD', 'git diff HEAD',
      `+    "output": "✔ ${R1_QUOTE}",\n`],
  ];

  const got = vectors.map(([label, evCmd, recCmd, stdout]) => {
    const c = checkCitation(ev({ cmd: evCmd, output: `✔ ${R1_QUOTE}` }), view([rec(recCmd, stdout)]));
    assert.equal(c.matched, 1, `${label}: 후보로는 잡혀야 이 테스트가 의미가 있다`);
    return `${label} ${c.status}`;
  });

  assert.deepEqual(
    got,
    ['(a) echo uncited', '(b) cat behaviors.json uncited', '(c) git diff uncited'],
    '줄 시작이 ✔가 아니면 실행 로그가 아니다 — hay에 들어가면 D15가 부활한다',
  );
});

test('B1: 진짜 테스트 출력은 그대로 cited다 (탐지력 회귀 가드)', () => {
  const c = checkCitation(
    ev({ cmd: 'node --test test/x.test.mjs', output: `✔ ${R1_QUOTE}` }),
    view([rec(
      'node --test test/x.test.mjs',
      `✔ B1: 진짜 테스트 (1.05ms)\n✔ ${R1_QUOTE} (2.10ms)\n# pass 2\n`,
    )]),
  );
  assert.equal(c.status, 'cited', '✔로 시작하는 줄은 좁히기 전과 똑같이 인정돼야 한다');
  assert.deepEqual(c.hits, [R1_QUOTE]);
});

// ⚠ 남는 벡터(d): receipt stdout에 `✔ …`를 **단독 줄**로 출력하면(예: `echo "✔ ZZZ: …"`)
// 여전히 cited가 된다. 닫으려면 receipt 하나 안에서 "어느 조각의 출력인가"를 갈라야 하고
// 그건 셸 파서다(DESIGN §1.5와 같은 이유). citation.js 주석에 잔여 미탐으로 명시했다.

// ── B2: 실제 실행은 항상 주장의 확장이다 (탐지력 유지) ────
// 실측 receipt.cmd는 evidence.cmd와 글자 단위로 같은 적이 거의 없다 — `rm -f … &&` 접두,
// 커버리지 옵션 6개, `cd … &&`, 뒤따르는 `; echo`. 정확 일치를 요구하면 이 층이 통째로 죽는다.
const B2_QUOTE = 'B2: 커버리지 옵션과 cd 접두가 붙어도 매칭된다';
const B2_STDOUT = `✔ ${B2_QUOTE} (1.234ms)\n# pass 235\n`;

test('B2: 접두·옵션·결합이 붙은 실제 실행도 대조된다 (evidence ⊆ receipt)', () => {
  const evidence = ev({ cmd: 'node --test test/*.test.mjs', output: `✔ ${B2_QUOTE}` });
  const actual = [
    'node --test test/*.test.mjs',
    'rm -f .devkit/receipts.jsonl && node --test --experimental-test-coverage --test-reporter=spec --test-reporter-destination=stdout test/*.test.mjs',
    'cd /Users/x/devkit && node --test test/*.test.mjs',
    'node --test test/*.test.mjs; echo done', // 세미콜론 인접 토큰
  ];

  for (const cmd of actual) {
    const c = checkCitation(evidence, view([rec(cmd, B2_STDOUT)]));
    assert.equal(c.status, 'cited', `실제로 실행했는데 대조에 실패했다: ${cmd}`);
    assert.equal(c.matched, 1, `후보로 인정돼야 한다: ${cmd}`);
  }
});

// ── B3: D20 재현 차단 ────────────────────────────────────
// D20 실측 — 검증하려고 sed로 behaviors.json을 화면에 띄웠더니 그 stdout이 봉인되고,
// 다음 실행에서 위조가 cited로 뒤집혔다. 매칭 후보가 있어도(=명령은 실제로 돌렸어도)
// 후보 밖 receipt의 출력은 hay에 들어가면 안 된다.
const B3_QUOTE = 'B3: 한 번도 실행된 적 없는 위조 인용이다 — 실행 로그에 존재할 수 없다';

test('B3: 인용 원문을 화면에 출력한 receipt가 있어도 위조는 uncited로 남는다 (D20)', () => {
  const forged = ev({ at: '2026-07-26', cmd: 'node --test test/citation.test.mjs', output: `✔ ${B3_QUOTE}` });
  const rs = {
    present: true,
    firstDate: '2026-07-26',
    records: [
      { // (a) D20 실측 형태 — 검증하려고 원문을 화면에 띄웠다. 절단까지 걸렸다고 하자.
        ts: '2026-07-26T01:00:00.000Z',
        cmd: "cd /Users/jaehun/Projects/devkit; sed -n '1,40p' docs/2026-07-26-x/behaviors.json",
        stdout: `{"id":"B3","evidence":{"output":"✔ ${B3_QUOTE}"}}\n`,
        stderr: '',
        truncated: true,
      },
      { // (b) 1회차 보고서 자신 — uncited 섹션에 인용 프리뷰가 실려 있다
        ts: '2026-07-26T02:00:00.000Z',
        cmd: 'node scripts/verify-evidence.mjs --cycle docs/2026-07-26-x',
        stdout: `⚠ uncited\n  B3  ref t.mjs  인용 ${B3_QUOTE} 를 receipt에서 못 찾음\n`,
        stderr: '',
      },
      { // (c) 주장한 명령의 실제 실행 — 위조 인용은 여기에 없다
        ts: '2026-07-26T03:00:00.000Z',
        cmd: 'node --test test/citation.test.mjs',
        stdout: '✔ B1: git diff·cat 출력에 인용이 실려도 cited가 되지 않는다 (1.05ms)\n# pass 2\n',
        stderr: '',
      },
    ],
  };

  const c = checkCitation(forged, rs);

  assert.equal(c.status, 'uncited', '매칭 후보 (c)가 있으므로 no-cmd-match가 아니다 — 진짜 불일치다');
  assert.deepEqual(c.hits, [], '(a)·(b)의 오염 출력이 hay에 들어가면 안 된다');
  assert.equal(c.matched, 1, '후보는 (c) 하나뿐이다');
  assert.equal(c.truncatedNearby, false, '후보 밖 receipt의 절단은 이 인용의 오탐 근거가 아니다');
});

// ── B4: 이름 블랙리스트(SELF_RE) 없이 자기입증을 닫는다 ────
// 구 구현은 cmd에 'verify-evidence'가 들어간 receipt를 통째로 뺐다. 그래서 이 레포의 실제
// 관례인 복합 명령(테스트 실행 && 검증)이 자기 자신 때문에 영원히 uncited였다(REVIEW 2회차 🟡1).
// 이제는 형태로 닫는다 — 검증 단독 실행에는 --test·테스트 파일 토큰이 없어 어차피 후보가 아니다.
const B4_QUOTE = 'B4: SELF_RE 없이도 자기 출력이 대조에 안 걸린다';
const B4_CMD = 'node --test test/citation.test.mjs && node scripts/verify-evidence.mjs --cycle docs/2026-07-26-x';

test('B4: verify-evidence를 포함한 정직한 복합 명령도 대조된다 (이름으로 빼지 않는다)', () => {
  const c = checkCitation(
    ev({ cmd: B4_CMD, output: `✔ ${B4_QUOTE}` }),
    view([rec(B4_CMD, `✔ ${B4_QUOTE} (0.9ms)\n# pass 4\n`)]),
  );
  assert.equal(c.status, 'cited', '실제로 돌린 복합 명령이 이름 때문에 제외되면 안 된다');
  assert.equal(c.matched, 1);
});

test('B4: 검증 단독 실행 receipt는 테스트 evidence의 후보가 아니다 (형태로 닫힌다)', () => {
  const rs = view([
    // 보고서 자신 — stdout에 인용이 그대로 실려 있다고 해도 --test·테스트 파일 토큰이 없다
    rec('node scripts/verify-evidence.mjs --cycle docs/2026-07-26-x', `⚠ uncited\n  B4 인용 ${B4_QUOTE}\n`),
  ]);
  const c = checkCitation(ev({ cmd: 'node --test test/citation.test.mjs', output: `✔ ${B4_QUOTE}` }), rs);
  assert.equal(c.status, 'no-cmd-match');
  assert.deepEqual(c.hits, []);

  // 이름 블랙리스트는 이미 실패한 첫 처방이다(D15) — 되살아나면 여기서 잡는다
  const src = fs.readFileSync(path.join(repoRoot, 'hooks', 'lib', 'citation.js'), 'utf8');
  assert.doesNotMatch(src, /verify-evidence/, '명령 이름 블랙리스트가 다시 들어왔다');
});

// ── B5: 매칭 0건은 uncited가 아니라 구분되는 상태다 ────────
// "그 명령을 안 돌렸다"와 "돌렸는데 출력이 다르다"를 한 통에 넣으면 uncited가 다시 소음이 된다.
// 사유는 필드로 가른다 — cite.cmd가 null이면 "적을 것을 안 적었다", 아니면 "안 돌렸다".
const B5_QUOTE = 'B5: 매칭 0건은 uncited가 아니라 no-cmd-match다';

test('B5: cmd를 쓸 수 없으면 no-cmd-match + cmd:null (uncited로 뭉개지 않는다)', () => {
  const rs = view([rec('node --test test/x.test.mjs', `✔ ${B5_QUOTE}\n`)]);

  // ① cmd 자체가 없다
  const a = checkCitation(ev({ cmd: undefined, output: `✔ ${B5_QUOTE}` }), rs);
  assert.equal(a.status, 'no-cmd-match');
  assert.equal(a.cmd, null, '무엇을 대조하려 했는지 없음을 필드로 밝혀야 조치가 갈린다');
  assert.equal(a.matched, 0);

  // ② 토큰 1개 — 모든 node 실행이 걸리면 자기입증 경로가 되살아난다
  const b = checkCitation(ev({ cmd: 'node', output: `✔ ${B5_QUOTE}` }), rs);
  assert.equal(b.status, 'no-cmd-match');
  assert.equal(b.cmd, null, '토큰 1개는 대조에 쓸 수 없다 — cmd 부재와 같은 조치다');
});

test('B5: cmd는 쓸 수 있는데 매칭이 0건이면 cmd 원문을 남긴다 (조치가 다르다)', () => {
  const rs = view([rec('node --test test/other.test.mjs', `✔ ${B5_QUOTE}\n`)]);
  const c = checkCitation(ev({ cmd: 'node --test test/x.test.mjs', output: `✔ ${B5_QUOTE}` }), rs);

  assert.equal(c.status, 'no-cmd-match');
  assert.equal(c.cmd, 'node --test test/x.test.mjs', '어느 명령을 돌려야 하는지 알려줘야 한다');
  assert.equal(c.matched, 0);
});

test('B5: 매칭은 됐는데 인용을 못 찾으면 uncited다 (진짜 불일치는 여전히 잡힌다)', () => {
  const rs = view([rec('node --test test/x.test.mjs', '✔ 전혀 다른 테스트가 통과함\n')]);
  const c = checkCitation(ev({ cmd: 'node --test test/x.test.mjs', output: `✔ ${B5_QUOTE}` }), rs);

  assert.equal(c.status, 'uncited');
  assert.equal(c.cmd, 'node --test test/x.test.mjs');
  assert.equal(c.matched, 1);
});

// ── B10: 인용 조각 대조 (보고이지 차단이 아니다) ──────────
// 실측 output(v0.11.0 아카이브 B1). ' · '로 나뉜 3조각 중 실행 로그는 첫 조각뿐이고
// '라이브: …'·'뮤테이션 M1 …'은 서술이라 receipt에 문자열로 존재할 수 없다.
// 후보에 넣으면 100% uncited가 나와 보고가 소음이 된다.
const ARCHIVE_B1 = "✔ B1: REVIEW.md 없이 REPORT.md를 쓰면 차단 + 생성 커맨드 안내 · 라이브: 실제 사이클 폴더 REPORT.md Write → exit=2, stderr 'REVIEW.md → /review' · 뮤테이션 M1(STAGE_REQUIREMENTS에서 REVIEW.md 제거) → 이 테스트 실패";

test('B10: 후보는 ✔ 조각만 — 서술(라이브·뮤테이션)은 인용이 아니다', () => {
  assert.deepEqual(
    extractQuotes(ev({ output: ARCHIVE_B1 })),
    ['B1: REVIEW.md 없이 REPORT.md를 쓰면 차단 + 생성 커맨드 안내'],
  );
  // ✔ 조각이 2개인 실측 형식(아카이브 B3)
  assert.equal(extractQuotes(ev({ output: '✔ B3: 없는 것만 정확히 지목한다 · ✔ gatePrerequisite: REVIEW.md만 없으면 그것만 지목' })).length, 2);
});

test('B10: kind가 test가 아니면 대조하지 않는다 (오탐 방지)', () => {
  const out = 'matcher: startup|resume|clear|compact / pre-compact.js: No such file (의도대로 부재)';
  assert.deepEqual(extractQuotes(ev({ kind: 'manual', output: out })), []);
  assert.deepEqual(extractQuotes(ev({ kind: 'visual', output: '✔ 스크린샷 대조 완료' })), []);
  assert.deepEqual(extractQuotes(null), []);
});

test('B10: 인용이 receipt에 있으면 cited', () => {
  const root = makeRoot();
  appendReceipt(root, {
    command: 'node --test test/*.test.mjs',
    stdout: '✔ B1: REVIEW.md 없이 REPORT.md를 쓰면 차단 + 생성 커맨드 안내 (12.34ms)\n# pass 166\n',
    stderr: '', interrupted: false,
  });
  const c = checkCitation(ev({ output: ARCHIVE_B1 }), readReceipts(root));
  assert.equal(c.status, 'cited');
  assert.equal(c.hits.length, 1);
});

test('B10: 인용을 못 찾으면 uncited로 보고한다 — throw하지 않는다(차단 아님)', () => {
  const root = makeRoot();
  appendReceipt(root, { command: 'node --test', stdout: '✔ 전혀 다른 테스트가 통과함\n', stderr: '', interrupted: false });
  let c;
  assert.doesNotThrow(() => { c = checkCitation(ev({ output: ARCHIVE_B1 }), readReceipts(root)); });
  assert.equal(c.status, 'uncited');
  assert.deepEqual(c.hits, []);
  assert.equal(c.quotes.length, 1, '무엇을 못 찾았는지 알려줘야 판단이 된다');
});

test('B10: 소요시간 표기 차이는 불일치가 아니다', () => {
  const root = makeRoot();
  appendReceipt(root, { command: 'node --test', stdout: '✔ B7: 정상 4필드는 통과 (13.502ms)\n', stderr: '', interrupted: false });
  assert.equal(checkCitation(ev({ output: '✔ B7: 정상 4필드는 통과 (2.1ms)' }), readReceipts(root)).status, 'cited');
});

test('B10: stderr도 대조 대상 (훅 차단 메시지는 stderr로 나온다)', () => {
  const root = makeRoot();
  const CMD = 'node hooks/pdca-gate.js';
  appendReceipt(root, { command: CMD, stdout: '', stderr: "✔ B1: REVIEW.md 없이 REPORT.md를 쓰면 차단 + 생성 커맨드 안내\n", interrupted: false });
  // evidence.cmd는 실제 실행 명령과 맞아야 후보가 된다 — 그래야 stderr까지 본다는 계약이 드러난다
  assert.equal(checkCitation(ev({ cmd: CMD, output: ARCHIVE_B1 }), readReceipts(root)).status, 'cited');
});

test('B10: 후보가 0개면 skipped (대조 불가는 위반이 아니다)', () => {
  const root = makeRoot();
  appendReceipt(root, { command: 'ls', stdout: 'x', stderr: '', interrupted: false });
  assert.equal(checkCitation(ev({ kind: 'manual', output: '눈으로 확인함 — 배지가 보인다' }), readReceipts(root)).status, 'skipped');
});

// ── B11: 대조할 receipt가 애초에 없는 경우 ────────────────
// receipt가 없는 것과 인용이 틀린 것은 완전히 다른 사건이다. 둘을 uncited로 뭉치면
// "receipt 도입 이전 사이클"이 전부 위반으로 보여 보고가 못 쓰게 된다.
test('B11: receipts 파일 자체가 없으면 no-receipt (uncited가 아니다)', () => {
  const root = makeRoot(); // .devkit 없음
  const rs = readReceipts(root);
  assert.equal(rs.present, false);
  assert.equal(rs.firstDate, null);

  const c = checkCitation(ev({ output: ARCHIVE_B1 }), rs);
  assert.equal(c.status, 'no-receipt');
  assert.deepEqual(c.hits, []);
  assert.equal(c.quotes.length, 1, '무엇을 대조하려 했는지는 남겨야 한다');
});

// ts를 통제해야 firstDate 경계를 볼 수 있다 — appendReceipt는 now를 쓴다
function seedReceipts(root, lines) {
  const d = path.join(root, '.devkit');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, FILE), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return root;
}
const QUOTED = '✔ B1: REVIEW.md 없이 REPORT.md를 쓰면 차단 + 생성 커맨드 안내 (12.3ms)\n';

test('B11: evidence가 receipt 봉인 시작보다 이전 날짜면 no-receipt', () => {
  const root = seedReceipts(makeRoot(), [
    { ts: '2026-07-25T01:00:00.000Z', cmd: 'node --test', stdout: QUOTED, stderr: '' },
    { ts: '2026-07-26T01:00:00.000Z', cmd: 'ls', stdout: '', stderr: '' },
  ]);
  const rs = readReceipts(root);
  assert.equal(rs.present, true);
  assert.equal(rs.firstDate, '2026-07-25', '가장 오래된 ts의 날짜여야 한다');

  // 문자열은 우연히 맞지만(cited로 보일 수 있다) 봉인 이전이라 대조 자체가 성립하지 않는다
  const c = checkCitation(ev({ at: '2026-07-24', output: ARCHIVE_B1 }), rs);
  assert.equal(c.status, 'no-receipt');
});

// 실측 evidence.at은 '2026-07-25'처럼 날짜만인 경우가 많다. 시각 단위로 비교하면
// 같은 날 봉인된 receipt가 전부 '이전'으로 판정돼 이번 사이클 evidence가 몰살당한다.
test('B11: 같은 날짜는 no-receipt가 아니다 (날짜 단위 비교)', () => {
  const root = seedReceipts(makeRoot(), [
    { ts: '2026-07-25T23:59:59.000Z', cmd: 'node --test', stdout: QUOTED, stderr: '' },
  ]);
  const rs = readReceipts(root);

  // ① at이 날짜만 — receipt ts보다 시각상 앞서지만 같은 날이다
  assert.equal(checkCitation(ev({ at: '2026-07-25', output: ARCHIVE_B1 }), rs).status, 'cited');
  // ② at이 전체 ISO여도 같은 날이면 동일
  assert.equal(checkCitation(ev({ at: '2026-07-25T00:00:01.000Z', output: ARCHIVE_B1 }), rs).status, 'cited');
  // ③ 같은 날인데 인용이 다르면 그건 uncited — no-receipt로 뭉개면 안 된다
  assert.equal(checkCitation(ev({ at: '2026-07-25', output: '✔ 전혀 다른 문구가 통과함' }), rs).status, 'uncited');
  // ④ at이 없으면 날짜 판정을 하지 않는다 (없다고 no-receipt로 몰지 않는다)
  assert.equal(checkCitation(ev({ at: undefined, output: ARCHIVE_B1 }), rs).status, 'cited');
});

// 판정 순서 계약 — 봉인 이전(2·3)이 cmd 매칭(4·5)보다 먼저다. 순서가 뒤집히면 아카이브
// 사이클이 전부 no-cmd-match로 뜨면서 "안 돌렸다"는 잘못된 사유가 붙는다. 실제로는 그 시절에
// 기록 자체가 없었을 뿐이고 소급 조치가 불가능하다(D19) — 사유가 틀리면 조치도 틀린다.
test('B10: 봉인 이전 evidence는 cmd 매칭이 0건이어도 no-receipt다 (순서 계약)', () => {
  const root = seedReceipts(makeRoot(), [
    { ts: '2026-07-25T01:00:00.000Z', cmd: 'node --test test/other.test.mjs', stdout: '✔ 무관한 출력\n', stderr: '' },
  ]);
  // 어떤 receipt와도 매칭되지 않는 cmd — 그래도 봉인 이전이라는 사실이 먼저다
  const c = checkCitation(ev({ at: '2026-07-24', cmd: 'node --test test/gone.test.mjs', output: ARCHIVE_B1 }), readReceipts(root));

  assert.equal(c.status, 'no-receipt', 'cmd 매칭 결과가 봉인 이전 판정을 덮으면 안 된다');
  assert.equal(c.cmd, null, '대조를 시도조차 하지 않았음이 드러나야 한다');
  assert.equal(c.matched, 0);
});

// ── R4: 보고서 자신이 봉인돼 uncited가 스스로 지워지는 것을 막는다 ──
// verify-evidence는 uncited 항목의 인용을 stdout에 찍고, 그 stdout을 bash-receipt가
// 봉인한다. 대조가 전체 receipt에 대한 부분 문자열 검사라, 다음 실행에서 그 인용이
// 발견돼 한 번도 실행된 적 없는 위조가 'cited'로 뒤집힌다(3회 실행이면 uncited: 0).
// → 이제는 이름이 아니라 형태로 끊는다: 그 receipt는 애초에 후보가 아니라서
//   상태가 uncited가 아니라 no-cmd-match다("그 명령을 안 돌렸다"가 사실이다).
test('R4: verify-evidence 자신의 출력은 대조 후보가 아니다 (자기입증 차단)', () => {
  const root = seedReceipts(makeRoot(), [
    {
      ts: '2026-07-25T10:00:00.000Z',
      cmd: 'node scripts/verify-evidence.mjs --cycle docs/2026-07-25-x',
      stdout: '⚠ uncited\n  B1  ref t.ts  인용 "B1: REVIEW.md 없이 REPORT.md를 쓰면 차단 + 생성 커맨드 안내" 를 receipt에서 못 찾음\n',
      stderr: '',
    },
  ]);
  const c = checkCitation(ev({ at: '2026-07-25', output: ARCHIVE_B1 }), readReceipts(root));
  assert.equal(c.status, 'no-cmd-match', '보고서 출력이 봉인됐다고 위조가 cited가 되면 안 된다');
  assert.deepEqual(c.hits, []);
  assert.equal(c.matched, 0);
});

test('R4: 자기 출력을 빼도 실제 실행 receipt는 그대로 대조한다 (탐지력 유지)', () => {
  const root = seedReceipts(makeRoot(), [
    { ts: '2026-07-25T10:00:00.000Z', cmd: 'node scripts/verify-evidence.mjs', stdout: QUOTED, stderr: '' },
    { ts: '2026-07-25T11:00:00.000Z', cmd: 'node --test test/*.test.mjs', stdout: QUOTED, stderr: '' },
  ]);
  assert.equal(checkCitation(ev({ at: '2026-07-25', output: ARCHIVE_B1 }), readReceipts(root)).status, 'cited');
});