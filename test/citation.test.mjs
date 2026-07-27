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
const {
  checkCitation, extractQuotes, normalize, MIN_QUOTE, SEP,
} = require(path.join(repoRoot, 'hooks', 'lib', 'citation.js'));
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

// ── B3/B4/B5: 대조는 receipt의 '한 줄 전체'와만 성립한다 ────
// REVIEW 🔴1. cmd 매칭은 "무관한 receipt"를 뺄 뿐, evidence.cmd를 정하는 것도 위조자다.
// 위조자가 cmd를 맞춰 적으면(echo·cat·git diff) 그 stdout이 대조 대상이 되어 자기입증이 부활한다.
// ⚠ 구 처방은 "'✔로 시작하는 줄'만 건초더미"였고 그 전제가 이 사이클에서 소멸했다.
//   지금 셋을 막는 것은 마커가 아니라 **형태**다: 세 벡터 모두 위조 문자열이 **줄 가운데**
//   박혀 있고(`node --test … → ✔ ZZZ` · `"output": "…",` · `+ "output": …`), 전체 일치는
//   앞뒤에 뭐가 붙는 순간 깨진다. 러너가 무엇이든, 마커가 있든 없든 성립한다.
const R1_QUOTE = 'ZZZ: 한 번도 실행된 적 없는 위조 인용이다';

test('B3/B4/B5: 위조 문자열이 줄 가운데 박혀 있으면 cited가 아니다 (echo·cat·git diff)', () => {
  // 위조자가 cmd를 receipt와 맞춰 적은 3벡터. 셋 다 매칭(matched:1)까지는 성립한다 —
  // 막히는 자리는 후보 선정이 아니라 줄 대조다.
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
    '앞뒤에 다른 내용이 붙은 줄은 실행 로그가 아니다 — 인정하면 D15가 부활한다',
  );
});

test('B3/B4/B5: 진짜 테스트 출력은 그대로 cited다 (탐지력 회귀 가드)', () => {
  const c = checkCitation(
    ev({ cmd: 'node --test test/x.test.mjs', output: `✔ ${R1_QUOTE}` }),
    view([rec(
      'node --test test/x.test.mjs',
      `✔ B1: 진짜 테스트 (1.05ms)\n✔ ${R1_QUOTE} (2.10ms)\n# pass 2\n`,
    )]),
  );
  assert.equal(c.status, 'cited', '실행 로그의 그 줄 통째는 좁히기 전과 똑같이 인정돼야 한다');
  // 마커를 벗기지 않는다 — 인용 단위는 `✔ …` 통째인 줄이고 receipt 줄도 normalize 후 같다
  assert.deepEqual(c.hits, [`✔ ${R1_QUOTE}`]);
});

// ⚠ 남는 벡터(d): 인용 줄을 **단독 줄**로 직접 출력하면(예: `echo "ZZZ: …"`) 여전히 cited다.
// 마커가 없어졌으므로 이제 ✔조차 필요 없다 — 직전 사이클보다 비용이 낮아진 것을 인정한다.
// 닫으려면 receipt 하나 안에서 "어느 조각의 출력인가"를 갈라야 하고 그건 셸 파서다.
// **테스트로 단언하지 않는다** — 단언하면 구멍이 계약으로 굳는다. citation.js 주석이 정본.

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
const ARCHIVE_B1 = "✔ B1: REVIEW.md 없이 REPORT.md를 쓰면 차단 + 생성 커맨드 안내 · 라이브: 실제 사이클 폴더 REPORT.md Write → exit=2, stderr 'REVIEW.md → /review' · 뮤테이션 M1(STAGE_REQUIREMENTS에서 REVIEW.md 제거) → 이 테스트 실패";

// ⚠ 계약이 바뀐 자리(DESIGN §9). 구 계약은 "후보는 ✔ 조각만"이었고 그 전제가 이 사이클의
// 결함이다 — 마커로 조각을 거르면 pytest·go test는 quotes=0(skipped)이 되어 조용히 무검증이다.
// 신규 계약: **쓸 수 있는 조각은 전부 후보**다. 서술형은 후보에서 빼는 게 아니라 무해하게
// 안 맞을 뿐이고(판정은 "하나라도 맞으면 cited"), 거르는 일은 이제 receipt 쪽 전체 일치가 한다.
test('B10: 조각은 마커로 거르지 않는다 — 서술형도 후보이고 무해하게 안 맞을 뿐이다', () => {
  assert.deepEqual(
    extractQuotes(ev({ output: ARCHIVE_B1 })),
    [
      '✔ B1: REVIEW.md 없이 REPORT.md를 쓰면 차단 + 생성 커맨드 안내',
      "라이브: 실제 사이클 폴더 REPORT.md Write → exit=2, stderr 'REVIEW.md → /review'",
      '뮤테이션 M1(STAGE_REQUIREMENTS에서 REVIEW.md 제거) → 이 테스트 실패',
    ],
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
  assert.equal(c.quotes.length, 3, '무엇을 못 찾았는지 알려줘야 판단이 된다 (조각 전부가 후보다)');
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
  assert.equal(c.quotes.length, 3, '무엇을 대조하려 했는지는 남겨야 한다 (조각 전부가 후보다)');
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

// ── B8: 마커가 없다는 이유로 침묵하지 않는다 (이 사이클의 존재 이유) ──
// pytest·go test·cargo는 ✔를 안 찍는다. 그 사이클에서 이 층은 오탐을 내는 게 아니라
// **아무것도 검증하지 않으면서 보고서에는 문제없어 보였다**(quotes=0 → skipped).
const B8_PYTEST = 'test_discount.py::test_over_limit PASSED [ 50%]';

test('B8: 마커 없는 러너 출력도 대조된다 — 안 맞으면 skipped가 아니라 uncited로 보고된다', () => {
  const c = checkCitation(
    ev({ cmd: 'python3 -m pytest -v', output: B8_PYTEST }),
    view([rec('python3 -m pytest -v tests/', 'test_discount.py::test_under_limit PASSED [ 50%]\n')]),
  );

  assert.notEqual(c.status, 'skipped', '마커가 없다는 이유로 침묵하면 이 층이 통째로 죽는다');
  assert.equal(c.status, 'uncited', '주장한 명령은 돌았고 그 출력에 이 줄이 없다 — 진짜 불일치다');
  assert.equal(c.matched, 1, '후보로는 잡혀야 이 테스트가 의미가 있다');
  assert.deepEqual(c.hits, []);
  assert.deepEqual(c.quotes, [B8_PYTEST], '무엇을 못 찾았는지 알려줘야 판단이 된다');
});

// ── B1: 정직한 pytest evidence가 cited다 ─────────────────
// 인정 근거는 러너 이름이 아니라 형태다 — "실행 로그의 한 줄은 통째로 그 줄이다".
test('B1: 정직한 pytest evidence는 cited다 — 코드에 러너 목록이 없다', () => {
  const c = checkCitation(
    ev({ cmd: 'python3 -m pytest -v tests/', output: B8_PYTEST }),
    view([rec(
      'python3 -m pytest -v tests/',
      'tests/test_discount.py::test_under_limit PASSED [ 25%]\n'
      + `${B8_PYTEST}\n`
      + '===== 2 passed in 0.03s =====\n',
    )]),
  );

  assert.equal(c.status, 'cited', '마커가 없다는 이유로 정직한 실행을 못 알아보면 안 된다');
  assert.deepEqual(c.hits, [B8_PYTEST]);
  assert.equal(c.matched, 1);

  // 러너 화이트리스트는 PLAN이 기각한 방향(a)이다 — 되살아나면 여기서 잡는다
  const src = fs.readFileSync(path.join(repoRoot, 'hooks', 'lib', 'citation.js'), 'utf8');
  assert.doesNotMatch(src, /pytest|go test|cargo|rspec|jest|vitest/, '러너 목록이 코드에 들어왔다');
});

// ── B2: go test — 회차 간 소요시간 표기 차이까지 흡수한다 ──
// evidence는 사람이 1회차 출력에서 옮겨 적고 receipt는 다른 회차다. 소요시간을 그대로 두면
// 전체 일치가 영원히 깨진다 — normalize가 흡수하는 것은 그 표기 오차 하나뿐이다.
test('B2: go test evidence는 소요시간 표기가 달라도 cited다 (같은 줄, 다른 회차)', () => {
  const c = checkCitation(
    ev({ cmd: 'go test ./...', output: '--- PASS: TestOverLimit (0.12s)' }),
    view([rec('go test ./... -run TestOverLimit', '=== RUN TestOverLimit\n--- PASS: TestOverLimit (0.00s)\nPASS\n')]),
  );

  assert.equal(c.status, 'cited', '회차가 다르면 소요시간이 다르다 — 그것 때문에 깨지면 안 된다');
  assert.deepEqual(c.hits, ['--- PASS: TestOverLimit']);
  assert.equal(c.matched, 1);
});

// ── B7: 조각이 섞여 있어도 하나만 맞으면 cited ────────────
// 실측: 아카이브 49건 중 24건이 혼합 스타일이다(`✔ 실행줄 · 라이브: … · 뮤테이션 M1 …`).
// 섞이는 축은 둘 — ' · '(서술 혼합)와 개행(러너 출력 여러 줄 붙여넣기). 양쪽 다 조각으로
// 쪼개지고, 서술 조각은 후보에서 빼는 게 아니라 무해하게 안 맞을 뿐이다.
test('B7: 서술 조각·여러 줄이 섞여도 실행 출력 한 조각이 맞으면 cited다', () => {
  const RUN = 'test_discount.py::test_over_limit PASSED [ 50%]';
  const rs = view([rec('python3 -m pytest -v', `${RUN}\n===== 1 passed in 0.03s =====\n`)]);

  // ① ' · ' 혼합 — 조각 3개 중 실행 로그는 하나
  const mixed = checkCitation(ev({
    cmd: 'python3 -m pytest -v',
    output: `${RUN} · 라이브: python3 실재 확인 · 뮤테이션 M1(lines.has → includes) → 이 테스트 실패`,
  }), rs);
  assert.equal(mixed.quotes.length, 3, '서술 조각도 후보다 — 거르는 일은 receipt 쪽 전체 일치가 한다');
  assert.deepEqual(mixed.hits, [RUN]);
  assert.equal(mixed.status, 'cited');

  // ② 개행 혼합 — 러너 출력 두 줄을 그대로 붙여넣었다(현행은 한 덩어리라 영원히 안 맞았다)
  const pasted = checkCitation(ev({
    cmd: 'python3 -m pytest -v',
    output: `${RUN}\n===== 1 passed in 0.03s =====`,
  }), rs);
  assert.equal(pasted.quotes.length, 2, '줄 단위 붙여넣기는 줄마다 후보가 된다');
  assert.equal(pasted.status, 'cited');
});

// ── B6: 아카이브 evidence의 판정이 불변이다 (회귀 0) ──────
// RED이 원리적으로 불가능하다(구 로직에서도 cited였다). 판별력은 뮤테이션으로 확인한다 —
// **M3(소요시간 흡수 제거)** 하나뿐이다. M1(전체 일치 → 부분 포함)은 인정 조건을 넓히는
// 방향이라 cited를 cited로 남긴다 — 처음엔 M1도 잡는다고 적었으나 Gap에서 반증됐다.
// 전수 대조(실제 receipt·날짜 게이트를 신·구 대칭 억제): 대조가 일어난 44건 중 41건 불변,
// **3건이 cited→uncited**(review-gate-permissions B5·B6·B8 — 전부 러너 줄을 잘라 적은
// 부분 인용. DESIGN §4가 완화하지 않기로 한 트레이드오프의 실사례다).
// 여기 고정하는 것은 그중 대표 픽스처다 — 실측 원문 그대로(archive/2026-07-26/…/B3).
const ARCHIVE_B3 = '✔ B3: 인용 원문을 화면에 출력한 receipt가 있어도 위조는 uncited로 남는다 (D20) (0.3365ms)';

// ⚠ at을 날짜 리터럴로 박지 않는다. rec()의 ts는 벽시계(TODAY)라 리터럴을 쓰면 그 날 하루만
//   통과하고 다음 날 no-receipt로 뒤집힌다 — 실제로 UTC 자정을 넘기며 재현했다(판정 순서 3번).
test('B6: 아카이브 evidence(실측 원문)는 신규 로직에서도 cited다', () => {
  const c = checkCitation(
    ev({ cmd: 'node --test test/*.test.mjs', output: ARCHIVE_B3 }),
    view([rec(
      'node --test test/*.test.mjs',
      // 회차가 다르므로 소요시간 표기가 다르다. 그 차이만 흡수된다.
      '✔ B3: 인용 원문을 화면에 출력한 receipt가 있어도 위조는 uncited로 남는다 (D20) (1.204ms)\n# pass 257\n',
    )]),
  );
  assert.equal(c.status, 'cited', '아카이브 판정이 바뀌면 그 자체가 회귀다');
  assert.deepEqual(c.hits, ['✔ B3: 인용 원문을 화면에 출력한 receipt가 있어도 위조는 uncited로 남는다 (D20)']);
});

// ── MIN_QUOTE 하한 — 짧은 조각은 대조에 쓸 수 없다 ────────
// 보고서의 `  (없음)`(5자)·프롬프트 조각 같은 짧은 줄이 후보가 되면 우연 일치가 시작된다.
// 상수는 정본에서 import한다 — 두 벌로 두면 값이 바뀔 때 경계가 조용히 어긋난다.
test('경계: MIN_QUOTE 미만 조각은 인용 후보도 대조 후보도 아니다', () => {
  const short = 'a'.repeat(MIN_QUOTE - 1);
  const exact = 'b'.repeat(MIN_QUOTE);

  assert.deepEqual(extractQuotes(ev({ output: short })), [], `${MIN_QUOTE}자 미만은 후보가 아니다`);
  assert.deepEqual(extractQuotes(ev({ output: exact })), [exact], `${MIN_QUOTE}자는 후보다`);
  assert.deepEqual(
    extractQuotes(ev({ output: `${short}${SEP}${exact}` })), [exact],
    '조각별로 하한을 본다 — 짧은 조각만 떨어진다',
  );

  // receipt 쪽도 같은 하한이다. 짧은 줄이 집합에 들어가면 evidence의 짧은 조각과 우연히 맞는다
  const rs = view([rec('node --test test/x.test.mjs', `${short}\n${exact}\n`)]);
  assert.equal(checkCitation(ev({ cmd: 'node --test test/x.test.mjs', output: exact }), rs).status, 'cited');
  assert.equal(
    checkCitation(ev({ cmd: 'node --test test/x.test.mjs', output: short }), rs).status, 'skipped',
    '쓸 수 있는 조각이 하나도 없으면 skipped다 — 신규 skipped의 정의',
  );
});

// ── B10: 어떤 입력에도 throw하지 않는다 (보고이지 차단이 아니다) ──
// 전체 일치로 바뀌면서 자료구조가 문자열 → Set이 됐다. 적대 입력이 그 경로에서 죽으면
// 보고 층이 통째로 멈추고, 이 도구는 게이트가 아니라 보고 도구다.
test('B10: 적대 입력(비객체·숫자·거대 문자열·10만 줄·깨진 receipt)에도 throw하지 않는다', () => {
  const hostile = [
    null, 42, 'nope', [], { kind: 'test', output: 42 }, { kind: 'test', output: null },
    { kind: 'test', output: 'x'.repeat(1_000_000), cmd: 'node --test test/x.test.mjs' },
    { kind: 'test', output: `${'긴 줄이 아주 많다\n'.repeat(100_000)}`, cmd: 'node --test test/x.test.mjs' },
  ];
  const broken = {
    present: true,
    firstDate: '2026-07-25',
    records: [
      null, 42, 'nope', [],
      { ts: '2026-07-26T00:00:00.000Z', cmd: null, stdout: null, stderr: undefined },
      { ts: '2026-07-26T00:00:00.000Z', cmd: 'node --test test/x.test.mjs', stdout: 42, stderr: [] },
    ],
  };

  for (const e of hostile) {
    for (const rs of [broken, null, undefined, 42, { records: 'nope', present: true }]) {
      assert.doesNotThrow(() => checkCitation(e, rs), `죽었다: ${JSON.stringify(e).slice(0, 60)}`);
    }
  }
});