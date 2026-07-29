// compareRules — 소비자 AGENTS.md의 공통 규칙 사본이 플러그인 정본과 같은지 판정한다.
//
// 이 함수는 **남의 레포 파일**을 판정한다. 틀리면 사용자가 자기 규칙을 의심하게 되므로
// 오탐이 미탐보다 비싸다. 그래서 계약의 절반이 "판정하지 않는다"(unknown/custom)에 있다.
//
// 판정은 자유 텍스트 분류가 아니라 **마커라는 형태**로 갈린다 — D24·D25가 남긴
// "좁힐 때는 열거가 아니라 형태로" 를 따른다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';

const dir = path.dirname(fileURLToPath(import.meta.url));
const libPath = path.join(dir, '..', 'hooks', 'lib', 'rules-sync.js');
const { compareRules } = createRequire(import.meta.url)(libPath);

/** 마커로 감싼 AGENTS.md를 만든다 */
function wrap(body, mode = 'managed') {
  return [
    '# AGENTS.md',
    '',
    '## 공통 규칙',
    '',
    `<!-- devkit:rules:start mode=${mode} -->`,
    body,
    '<!-- devkit:rules:end -->',
    '',
    '## 이 레포 고유 규칙',
    '- 사용자가 직접 쓴 내용. 절대 건드리면 안 된다.',
  ].join('\n');
}

const CANON = ['- 규칙 하나', '- 규칙 둘', '- 규칙 셋'].join('\n');

// ── B1: 일치 ──────────────────────────────────────────────
test('B1: 정본과 같은 사본은 current — 조용하다', () => {
  const r = compareRules(CANON, wrap(CANON));
  assert.equal(r.state, 'current');
  assert.equal(r.diffLines, 0);
});

test('B1: 의미 없는 차이(줄 끝 공백·연속 빈 줄·앞뒤 여백)는 current', () => {
  const noisy = ['', '- 규칙 하나   ', '', '', '- 규칙 둘', '- 규칙 셋\t', ''].join('\n');
  const r = compareRules(CANON, wrap(noisy));
  assert.equal(r.state, 'current', `정규화가 부족하다: ${JSON.stringify(r)}`);
});

// REVIEW에서 나온 것: `/kit init`의 AGENTS.md 템플릿은 kit.md의 코드펜스 안에 3칸
// 들여쓰기로 보인다. 모델이 그대로 옮기면 사본 전 줄에 들여쓰기가 붙고, 앞 공백을 보존하면
// **모든 프로젝트가 영원히 stale**이 된다 — 정확히 🔴 소음 리스크. 공통 들여쓰기는 버린다.
test('B1: 사본 전체가 균일하게 들여쓰기돼도 current (kit.md 템플릿 전사 artifact)', () => {
  const indented = ['   - 규칙 하나', '   - 규칙 둘', '   - 규칙 셋'].join('\n');
  assert.equal(compareRules(CANON, wrap(indented)).state, 'current');
});

// 다만 **상대** 들여쓰기는 규칙의 구조다. 공통분만 버리고 중첩은 보존해야 실제 변경을 잡는다.
test('B2: 중첩 들여쓰기가 달라지면 여전히 stale — 공통분만 버린다', () => {
  const nested = ['- 규칙 하나', '  - 하위가 새로 생김', '- 규칙 둘', '- 규칙 셋'].join('\n');
  assert.equal(compareRules(CANON, wrap(nested)).state, 'stale');
});

// ── B2: 낡음 ──────────────────────────────────────────────
test('B2: 정본이 바뀌면 stale, 그리고 몇 줄 다른지 센다', () => {
  const stale = ['- 규칙 하나', '- 규칙 둘(옛날)', '- 규칙 셋'].join('\n');
  const r = compareRules(CANON, wrap(stale));
  assert.equal(r.state, 'stale');
  // "다르다"가 아니라 "N줄 다르다"여야 행동을 유발한다(DESIGN 결정 2)
  assert.ok(r.diffLines > 0, '차이 줄 수를 세야 한다');
});

test('B2: 정본에 줄이 추가되면 그 개수만큼 stale', () => {
  const old = ['- 규칙 하나', '- 규칙 둘'].join('\n');
  const r = compareRules(CANON, wrap(old));
  assert.equal(r.state, 'stale');
  assert.equal(r.diffLines, 1, '한 줄 추가면 1줄 차이');
});

// ── B3: 마커 없음 = 마이그레이션 전 ────────────────────────
test('B3: devkit 흔적이 없는 파일은 unknown — 남의 AGENTS.md에 참견하지 않는다', () => {
  const foreign = '# AGENTS.md\n\n## Setup\n\n- 우리 회사 규칙\n';
  const r = compareRules(CANON, foreign);
  assert.equal(r.state, 'unknown');
  assert.equal(r.diffLines, 0);
});

// G1(실측): 이 사이클이 목표한 인구 — 이미 /kit init을 돌린 프로젝트 — 의 AGENTS.md에는
// 마커가 없다. 마커 없음을 전부 unknown(침묵)으로 묶으면 **정확히 그 인구에서 기능이
// 작동하지 않는다.** 마커를 넣으려면 /kit sync를 돌려야 하는데, 돌릴 이유를 알려주는 게
// 그 안내라서 순환이 된다. devkit이 심은 `## 공통 규칙` 절은 형태로 구분되므로 갈라낸다.
test('B3: `## 공통 규칙` 절이 있는데 마커가 없으면 unmarked — 마이그레이션 대상이다', () => {
  const legacy = '# AGENTS.md\n\n## 공통 규칙\n\n- 규칙 하나\n- 완전히 다른 내용\n';
  const r = compareRules(CANON, legacy);
  assert.equal(r.state, 'unmarked', '기존 /kit init 산출물이 침묵 처리되면 이 사이클은 목표를 못 이룬다');
  assert.equal(r.diffLines, 0, 'unmarked는 내용을 비교하지 않는다 — 어디까지가 사본인지 모른다');
});

test('B3: start만 있고 end가 없으면 unknown (깨진 마커를 추측으로 메우지 않는다)', () => {
  const broken = '<!-- devkit:rules:start mode=managed -->\n- 규칙 하나\n';
  assert.equal(compareRules(CANON, broken).state, 'unknown');
});

test('B3: 모르는 mode는 unknown — 새 모드를 managed로 넘겨짚지 않는다', () => {
  assert.equal(compareRules(CANON, wrap(CANON, 'frozen')).state, 'unknown');
});

// ── B7: 커스터마이즈는 완전 침묵 ───────────────────────────
test('B7: mode=custom은 내용이 아무리 달라도 custom — 비교조차 하지 않는다', () => {
  const totallyDifferent = '- 우리 팀만의 규칙\n- devkit과 무관\n- 세 번째';
  const r = compareRules(CANON, wrap(totallyDifferent, 'custom'));
  assert.equal(r.state, 'custom');
  assert.equal(r.diffLines, 0, 'custom은 차이를 세지도 않는다(침묵이 계약)');
});

// ── B5: 어떤 입력에도 throw 안 함 ──────────────────────────
test('B5: 판정 불가 입력에 throw하지 않고 unknown으로 degrade한다', () => {
  const bad = [
    [null, null], [undefined, undefined], ['', ''], [CANON, null], [null, wrap(CANON)],
    [CANON, ''], [CANON, '<!-- devkit:rules:start'], [123, {}], [CANON, wrap(CANON).repeat(3)],
  ];
  for (const [a, b] of bad) {
    let r;
    assert.doesNotThrow(() => { r = compareRules(a, b); }, `throw함: ${JSON.stringify([a, b]).slice(0, 60)}`);
    assert.ok(['current', 'stale', 'custom', 'unknown'].includes(r.state), `상태 밖: ${r.state}`);
  }
});

test('B5: state가 stale이 아니면 diffLines는 항상 0 (계약 불변식)', () => {
  const cases = [wrap(CANON), 'no markers', wrap(CANON, 'custom'), wrap(CANON, 'frozen')];
  for (const md of cases) {
    const r = compareRules(CANON, md);
    if (r.state !== 'stale') assert.equal(r.diffLines, 0, `${r.state}인데 diffLines=${r.diffLines}`);
  }
});

// ── B4: 순수성 — 동작으로 단언한다(형태 관찰 금지, D24) ────
// Function.length나 소스 문자열 검색이 아니라, **fs를 만지면 터지는 환경**에서
// 실제로 실행해 본다. 판정 함수가 파일을 읽기 시작하면 이 테스트가 빨개진다.
test('B4: fs를 봉인한 프로세스에서도 정상 판정한다 — 순수함수', () => {
  const probe = `
    const Module = require('module');
    const orig = Module.prototype.require;
    Module.prototype.require = function (id) {
      if (id === 'fs' || id === 'node:fs' || id === 'node:fs/promises') {
        throw new Error('FS_TOUCHED');
      }
      return orig.apply(this, arguments);
    };
    const { compareRules } = require(${JSON.stringify(libPath)});
    const md = '<!-- devkit:rules:start mode=managed -->\\n- a\\n<!-- devkit:rules:end -->';
    process.stdout.write(compareRules('- a', md).state);
  `;
  const out = execFileSync('node', ['-e', probe], { encoding: 'utf8' });
  assert.equal(out, 'current', 'fs 봉인 환경에서 판정이 깨졌다 = 파일을 읽고 있다');
});

test('B4: 같은 입력이면 호출 위치·시점과 무관하게 같은 결과', () => {
  const md = wrap(CANON);
  const a = compareRules(CANON, md);
  const b = compareRules(CANON, md);
  assert.deepEqual(a, b);
});

// ── B6·B8: 훅 배선 — devkit 밖 프로젝트에서 실제로 동작하는가 ──
// 이 축은 devkit 자기 레포에서 원리적으로 관측되지 않는다 — devkit엔 AGENTS.md가 없다.
// D22가 터진 바로 그 형태라, 임시 프로젝트를 만들어 소비자 조건에서 확인한다.
const hook = path.join(dir, '..', 'hooks', 'session-start.js');
const tmpRoots = [];
after(() => { for (const d of tmpRoots) fs.rmSync(d, { recursive: true, force: true }); });

/** devkit 밖에 소비자 프로젝트를 만든다. agentsMd가 null이면 AGENTS.md 없음. */
function makeProject(agentsMd) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-consumer-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"consumer"}');
  if (agentsMd !== null) fs.writeFileSync(path.join(root, 'AGENTS.md'), agentsMd);
  tmpRoots.push(root);
  return root;
}

const runHook = (cwd) => execFileSync('node', [hook], { cwd, encoding: 'utf8' });

/** 플러그인의 현재 SUMMARY 원문 — 사본을 만들 때 정본으로 쓴다 */
function canonicalSummary() {
  const md = fs.readFileSync(path.join(dir, '..', 'RULES.md'), 'utf8');
  return md.match(/<!-- SUMMARY:START -->\n([\s\S]*?)\n<!-- SUMMARY:END -->/)[1].trim();
}

test('B8: 낡은 AGENTS.md를 가진 소비자 프로젝트에서 드리프트가 탐지된다', () => {
  const stale = canonicalSummary().split('\n').slice(0, -2).join('\n') + '\n- 옛날 규칙: views/에 화면을 만든다';
  const out = runHook(makeProject(wrap(stale)));
  assert.match(out, /AGENTS\.md의 공통 규칙이 플러그인 RULES와 \d+줄 다르다/, `탐지 실패:\n${out}`);
});

test('B6: 경고는 고치는 방법을 준다 — 대안 없는 경고는 교착이다', () => {
  const stale = canonicalSummary() + '\n- 사본에만 있는 줄';
  const out = runHook(makeProject(wrap(stale)));
  assert.match(out, /\/kit sync/, '최신화 방법이 없다');
  assert.match(out, /custom/, '커스터마이즈 탈출구가 없다 — 의도적으로 다르게 쓴 사용자가 갈 곳이 없다');
});

test('B6: 경고는 정확히 2줄이다 — 배너는 무시 학습을 만든다', () => {
  const stale = canonicalSummary() + '\n- 사본에만 있는 줄';
  const out = runHook(makeProject(wrap(stale)));
  const warn = out.split('\n').filter((l) => /AGENTS\.md의 공통 규칙|\/kit sync/.test(l));
  assert.equal(warn.length, 2, `2줄이어야 한다: ${JSON.stringify(warn)}`);
});

test('B1: 최신 사본이면 훅은 완전히 침묵한다', () => {
  const out = runHook(makeProject(wrap(canonicalSummary())));
  assert.doesNotMatch(out, /낡았을 수 있다/, `최신인데 경고가 떴다:\n${out}`);
});

test('B7: mode=custom이면 내용이 달라도 침묵한다', () => {
  const out = runHook(makeProject(wrap('- 우리 팀만의 완전히 다른 규칙', 'custom')));
  assert.doesNotMatch(out, /낡았을 수 있다/);
});

test('B3: AGENTS.md가 없거나 devkit 흔적이 없으면 완전히 침묵한다', () => {
  for (const md of [null, '# AGENTS.md\n\n## Setup\n\n- 남의 규칙\n']) {
    const out = runHook(makeProject(md));
    assert.doesNotMatch(out, /낡았을 수 있다|마커가 없다/, `참견했다: ${String(md).slice(0, 25)}`);
  }
});

test('G1: 마커 없는 기존 /kit init 산출물에는 마이그레이션 안내가 뜬다 (목표 인구)', () => {
  const legacy = '# AGENTS.md\n\n## 공통 규칙\n\n- 낡은 규칙\n\n## This repo only\n- 사용자가 쓴 줄\n';
  const out = runHook(makeProject(legacy));
  assert.match(out, /마커가 없다/, `목표 인구에서 침묵했다 — 사이클이 목표를 못 이룬다:\n${out}`);
  assert.match(out, /\/kit sync/, '켜는 방법이 없다');
  // 낡음 경고와 섞이면 안 된다 — 아직 내용을 비교하지 않았다
  assert.doesNotMatch(out, /낡았을 수 있다/, '비교하지도 않고 낡았다고 단정했다');
});

test('훅은 어떤 경우에도 세션 시작을 막지 않는다(리마인드는 항상 나간다)', () => {
  for (const md of [null, 'garbage', wrap('x'), '<!-- devkit:rules:start -->']) {
    const out = runHook(makeProject(md));
    assert.match(out, /devkit 팀 규칙 리마인드/, `리마인드가 사라졌다: ${String(md).slice(0, 30)}`);
  }
});

// ── 중복 주입 제거 ────────────────────────────────────────
// 실측(헤드리스 세션, 파일 도구 차단): Claude Code는 AGENTS.md를 자동 로드하지 않는다.
// CLAUDE.md의 @AGENTS.md import가 있을 때만 로드된다. 그래서 /kit init을 돌린
// 프로젝트에서는 SUMMARY가 훅과 AGENTS.md 두 경로로 **두 번** 들어간다.
//
// ⚠ 비대칭이 극단적이다. 미탐(중복 잔존)은 토큰 낭비지만, 오탐(안 넣었는데 실은
// 없음)은 팀 규칙 전멸이다. 그래서 "생략되면 안 되는" 케이스를 더 많이 깐다.

const IMPORT_MD = '# CLAUDE.md\n\n이 레포 지침은 @AGENTS.md 를 따른다.\n';

/** 프로젝트를 만들되 CLAUDE.md 유무·내용을 지정한다 */
function makeProjectWith(agentsMd, claudeMd) {
  const root = makeProject(agentsMd);
  if (claudeMd !== null) fs.writeFileSync(path.join(root, 'CLAUDE.md'), claudeMd);
  return root;
}
const hasSummary = (out) => /devkit 팀 규칙 리마인드/.test(out);

test('B1: current + CLAUDE.md의 @AGENTS.md import면 SUMMARY를 생략한다', () => {
  const out = runHook(makeProjectWith(wrap(canonicalSummary()), IMPORT_MD));
  assert.equal(hasSummary(out), false, `중복인데 또 넣었다:\n${out.slice(0, 200)}`);
});

test('B2: CLAUDE.md가 없으면 주입한다 — AGENTS.md는 자동 로드되지 않는다(실측 A)', () => {
  const out = runHook(makeProjectWith(wrap(canonicalSummary()), null));
  assert.ok(hasSummary(out), 'AGENTS.md만 있는데 생략했다 = 규칙 전멸');
});

test('B3: @AGENTS.md import가 없는 CLAUDE.md면 주입한다', () => {
  const out = runHook(makeProjectWith(wrap(canonicalSummary()), '# CLAUDE.md\n\n우리 규칙은 여기 직접 쓴다.\n'));
  assert.ok(hasSummary(out), 'import가 없는데 생략했다 = 규칙 전멸');
});

test('B4: stale·unmarked·custom·unknown이면 전부 주입한다', () => {
  const cases = {
    stale: wrap(canonicalSummary() + '\n- 사본에만 있는 줄'),
    unmarked: '# AGENTS.md\n\n## 공통 규칙\n\n- 마커 없는 옛 파일\n',
    custom: wrap('- 우리 팀만의 규칙', 'custom'),
    unknown: '# AGENTS.md\n\n## Setup\n- 남의 파일\n',
  };
  for (const [label, md] of Object.entries(cases)) {
    assert.ok(hasSummary(runHook(makeProjectWith(md, IMPORT_MD))), `${label}인데 생략했다`);
  }
});

test('B5: 코드펜스 안의 @AGENTS.md는 import로 치지 않는다', () => {
  const documented = '# CLAUDE.md\n\n설정 예시:\n\n```markdown\n이 레포 지침은 @AGENTS.md 를 따른다.\n```\n\n아직 적용 안 함.\n';
  const out = runHook(makeProjectWith(wrap(canonicalSummary()), documented));
  assert.ok(hasSummary(out), '설명하려고 적은 문자열을 실제 import로 봤다(D25 계열)');
});

test('B6: importsAgentsMd는 어떤 입력에도 throw하지 않는다', () => {
  const { importsAgentsMd } = createRequire(import.meta.url)(libPath);
  for (const bad of [null, undefined, '', 123, {}, '```\n@AGENTS.md\n```', '@AGENTS.md']) {
    let r;
    assert.doesNotThrow(() => { r = importsAgentsMd(bad); });
    assert.equal(typeof r, 'boolean');
  }
  assert.equal(importsAgentsMd(IMPORT_MD), true);
  assert.equal(importsAgentsMd('@./AGENTS.md 를 따른다'), true);
});

test('B7: SUMMARY를 생략해도 진행 중 사이클 재개 블록은 나온다', () => {
  const root = makeProjectWith(wrap(canonicalSummary()), IMPORT_MD);
  fs.mkdirSync(path.join(root, '.devkit'), { recursive: true });
  fs.writeFileSync(path.join(root, '.devkit', 'pdca-state.json'),
    JSON.stringify({ version: 1, cycleId: '2026-07-29-x', stage: 'do', status: 'in-progress' }));
  const out = runHook(root);
  assert.equal(hasSummary(out), false, '생략 조건인데 SUMMARY가 나왔다');
  assert.match(out, /진행 중 PDCA 사이클/, '재개 블록까지 사라졌다 — 중복 대상이 아니다');
});

test('B8: CLAUDE.md가 깨져 있어도 세션 시작을 막지 않는다', () => {
  for (const cm of ['', '\0\0\0', 'x'.repeat(50000)]) {
    const out = runHook(makeProjectWith(wrap(canonicalSummary()), cm));
    assert.ok(out.length > 0, '출력이 비었다');
  }
});
