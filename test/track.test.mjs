// Quick/Full 트랙 계약 — PLAN 첫머리 1줄로 DESIGN 생략 여부를 가른다.
//
// 이 파일의 두 축:
//   ① readTrack 순수함수 계약 (B1~B3) — 어떤 입력에도 throw하지 않고, 못 읽으면 null(추측 금지).
//   ② **트랙은 게이트의 입력이 아니다** (B7) — pdca-gate/pdca-state가 track을 읽지 않는 것이
//      "그렇게 하기로 했다"가 아니라 회귀로 고정된 계약이다. 읽는 순간 사람이 PLAN.md에 손으로
//      쓴 한 줄이 검증 층 전체를 끄는 경로가 열린다(DESIGN §2-1 ②).
//
// B4는 입력을 조립하지 않는다 — 실사용에서 그 입력을 만드는 것은 commands/plan.md의 템플릿이므로
// 거기서 읽어와 파서에 먹인다(invocation-path.test.mjs와 같은 축).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const repoRoot = path.join(dir, '..');
const read = (p) => fs.readFileSync(path.join(repoRoot, p), 'utf8');

const { readTrack } = require(path.join(repoRoot, 'hooks', 'lib', 'track.js'));

/** PLAN 첫머리 형태를 만든다. 앞 2줄(제목+빈 줄)은 실제 PLAN과 같게 둔다 */
const plan = (...lines) => ['# PLAN — t', '', ...lines].join('\n');

// ─────────────────────────────────────────────────────────
// B1 — 선언을 읽는다
// ─────────────────────────────────────────────────────────

test('B1: 상단 10줄의 track 선언에서 Quick을 읽는다', () => {
  const r = readTrack(plan('- **track**: Quick', '- **사이클 ID**: `x`'));
  assert.equal(r.track, 'Quick');
  assert.equal(r.declared, 'Quick');
  assert.equal(r.clarifications, 0);
});

test('B1: Full 선언을 읽는다', () => {
  const r = readTrack(plan('- **track**: Full'));
  assert.equal(r.track, 'Full');
  assert.equal(r.declared, 'Full');
});

test('B1: 대소문자와 불릿 문자가 달라도 정규형으로 돌려준다', () => {
  assert.equal(readTrack(plan('- **track**: quick')).track, 'Quick');
  assert.equal(readTrack(plan('* **track**: FULL')).track, 'Full');
  assert.equal(readTrack(plan('  - **track**:\tFull')).track, 'Full');
  // CRLF 문서에서도 줄 끝 \r이 후미 잔여로 취급되지 않는다
  assert.equal(readTrack('# PLAN\r\n\r\n- **track**: Quick\r\n').track, 'Quick');
});

// ─────────────────────────────────────────────────────────
// B2 — 못 읽으면 null이다 (추측하지 않는다)
// ─────────────────────────────────────────────────────────

test('B2: 볼드 없는 선언이나 값 뒤 잔여 텍스트는 null이다', () => {
  assert.equal(readTrack(plan('- track: Quick')).track, null);
  assert.equal(readTrack(plan('- **track**: Quick (아마도)')).track, null);
  assert.equal(readTrack(plan('- **track**: Quicker')).track, null);
  assert.equal(readTrack(plan('- **track**: Quick, Full')).track, null);
  // 산문 속 언급은 선언이 아니다
  assert.equal(readTrack(plan('첫머리에 `- **track**: Quick`을 적는다')).track, null);
});

test('B2: 11번째 줄의 선언은 읽지 않고 10번째 줄은 읽는다', () => {
  const at = (n) => {
    const lines = Array.from({ length: n - 1 }, () => '');
    lines.push('- **track**: Quick');
    return readTrack(lines.join('\n'));
  };
  assert.equal(at(10).track, 'Quick', '10번째 줄은 경계 안이다');
  assert.equal(at(11).track, null, '11번째 줄은 경계 밖이다');
});

test('B2: 선언이 없으면 null이고 Full로 추측하지 않는다', () => {
  const r = readTrack(plan('- **사이클 ID**: `x`', '목표는 무엇이다.'));
  assert.equal(r.declared, null);
  assert.equal(r.track, null);
});

test('B2: 비문자열 입력에도 throw하지 않고 null 형태를 돌려준다', () => {
  for (const bad of [null, undefined, {}, 42, [], true]) {
    const r = readTrack(bad);
    assert.deepEqual(r, { track: null, declared: null, clarifications: 0 });
  }
});

// ─────────────────────────────────────────────────────────
// B3 — 미해결 마커가 Quick 선언을 무효로 만든다
// ─────────────────────────────────────────────────────────

const MARKER = '[NEEDS ' + 'CLARIFICATION';

test('B3: 미해결 마커 1건이면 Quick 선언이 Full로 강등된다', () => {
  const r = readTrack(plan('- **track**: Quick', '', `${MARKER}: 이 값은 어디서 오나]`));
  assert.equal(r.declared, 'Quick', '선언은 문서에 적힌 그대로 남는다');
  assert.equal(r.track, 'Full', '실효 트랙은 Full이다');
  assert.equal(r.clarifications, 1);
});

test('B3: 마커는 문서 전체에서 센다', () => {
  const tail = Array.from({ length: 30 }, () => '본문').join('\n');
  const r = readTrack(plan('- **track**: Quick', '', tail, `${MARKER}: 하나]`, `${MARKER}: 둘]`));
  assert.equal(r.clarifications, 2, '10줄 밖의 마커도 센다');
  assert.equal(r.track, 'Full');
});

test('B3: 강등은 Quick 선언에만 적용된다', () => {
  const full = readTrack(plan('- **track**: Full', '', `${MARKER}: 질문]`));
  assert.equal(full.track, 'Full', 'Full은 마커가 있어도 Full 그대로다');
  const none = readTrack(plan('선언 없음', '', `${MARKER}: 질문]`));
  assert.equal(none.track, null, '선언이 없으면 Full을 발명하지 않는다');
  assert.equal(none.clarifications, 1);
});

test('B3: 마커를 지우면 Quick이 유효해지고 대소문자는 무시한다', () => {
  const lower = readTrack(plan('- **track**: Quick', '', '[needs   clarification: 질문]'));
  assert.equal(lower.clarifications, 1, '소문자와 공백 여러 칸도 마커다');
  assert.equal(lower.track, 'Full');
  const resolved = readTrack(plan('- **track**: Quick', '', '답: 설정 파일에서 온다.'));
  assert.equal(resolved.clarifications, 0);
  assert.equal(resolved.track, 'Quick');
});

// ─────────────────────────────────────────────────────────
// B4 — 입력 층 검증: 실사용에서 이 입력을 만드는 것은 commands/plan.md다
// ─────────────────────────────────────────────────────────

/**
 * 코드펜스 **안**에서 `- **track**`으로 시작하는 줄만 뽑는다.
 * ⚠ TRACK_RE를 쓰지 않는다 — 파서가 고른 입력을 그 파서가 파면 "정규식이 자기에게 맞는 줄에
 * 맞는다"뿐이라 무검사다. 추출은 **구조**(펜스 안 + 불릿 접두)로만 하고, 형태 판정(콜론 간격·
 * 값·10줄·후미 잔여)은 전부 readTrack에 맡긴다.
 */
function fencedTrackLines(md) {
  const out = [];
  let inFence = false;
  for (const line of md.split('\n')) {
    if (line.trim().startsWith('```')) { inFence = !inFence; continue; }
    if (inFence && line.trim().startsWith('- **track**')) out.push(line);
  }
  return out;
}

test('B4: commands/plan.md의 트랙 템플릿 줄을 그대로 파싱한다', () => {
  const lines = fencedTrackLines(read('commands/plan.md'));
  // 하한이 없으면 "0건이라 통과"가 성립해 규약이 깨져도 초록이다
  assert.ok(lines.length >= 2, `펜스 안 track 템플릿 줄이 2개 이상이어야 한다 (실제: ${lines.length})`);

  const values = new Set();
  for (const line of lines) {
    const r = readTrack(`# PLAN\n\n${line}\n`);
    assert.notEqual(r.track, null, `문서의 템플릿 줄이 파싱되지 않는다: ${JSON.stringify(line)}`);
    values.add(r.track);
  }
  assert.deepEqual([...values].sort(), ['Full', 'Quick'], '두 트랙 모두 복사 가능한 원문이 있어야 한다');
});

// ─────────────────────────────────────────────────────────
// B6 · B8 — 문서 문자열 존재. "그 문자열이 행동을 바꾼다"까지는 주장하지 않는다
// ─────────────────────────────────────────────────────────

test('B6: RULES.md에 트랙 표가 있고 Quick 멈춤점이 1곳이다', () => {
  const rules = read('RULES.md');
  const row = rules.split('\n').find((l) => l.includes('**Quick**') && l.includes('|'));
  assert.ok(row, 'RULES.md에 Quick 행이 있어야 한다');
  assert.ok(/1곳/.test(row), `Quick 행이 멈춤점 1곳을 말해야 한다: ${row}`);
  assert.ok(rules.includes(MARKER), 'Quick 유효 조건(미해결 마커 0건)이 적혀 있어야 한다');
  assert.ok(/게이트의 입력이 아니다/.test(rules), '트랙이 게이트 입력이 아님을 명시해야 한다');
});

// SUMMARY 블록은 session-start가 매 세션 그대로 주입하는 원문이다 — 모델이 **항상 보는**
// 유일한 채널이고, 본문 표는 RULES.md를 직접 열었을 때만 보인다. 둘이 어긋나면 강한 쪽이
// 이기므로, 트랙 표를 본문에만 넣고 SUMMARY를 그대로 두면 Quick이 배포 시점에 무효화된다
// (1회차 리뷰 🔴). 정합성을 여기서 고정한다.
test('B6: SUMMARY 블록이 본문 트랙 표와 같은 멈춤점을 말한다', () => {
  const rules = read('RULES.md');
  const summary = rules.slice(
    rules.indexOf('<!-- SUMMARY:START -->'),
    rules.indexOf('<!-- SUMMARY:END -->'),
  );
  assert.ok(summary.length > 100, 'SUMMARY 블록을 찾지 못했다');
  assert.ok(/track/.test(summary), 'SUMMARY가 트랙 선언을 언급해야 한다');
  assert.ok(/Quick/.test(summary) && /Full/.test(summary), 'SUMMARY가 두 트랙을 모두 말해야 한다');
  assert.doesNotMatch(
    summary, /멈춤점은 PLAN·DESIGN 승인 2곳/,
    'SUMMARY가 트랙 도입 이전의 무조건 2곳을 말하고 있다 — 본문 표와 충돌한다',
  );
  assert.ok(/1곳|Quick 1/.test(summary), 'SUMMARY가 Quick의 멈춤점 1곳을 말해야 한다');
});

test('B8: commands/plan.md가 Quick에서 Full로의 단방향 승격을 규정한다', () => {
  const cmd = read('commands/plan.md');
  assert.ok(/Quick\s*→\s*Full/.test(cmd), '승격 방향이 적혀 있어야 한다');
  assert.ok(/Full\s*→\s*Quick\s*강등은 금지/.test(cmd), '강등 금지가 적혀 있어야 한다');
  assert.ok(cmd.includes(MARKER), 'PLAN 작성 시 마커 지시가 있어야 한다');
});

// ─────────────────────────────────────────────────────────
// B7 — 트랙은 게이트의 입력이 아니다 (회귀 고정)
// ─────────────────────────────────────────────────────────

const GATE_FILES = ['hooks/pdca-gate.js', 'hooks/lib/pdca-state.js'];
const TRACK_WORD = /\btrack\b/i;

test('B7: pdca-gate와 pdca-state가 track을 참조하지 않는다', () => {
  // 탐지기가 죽어 있으면 0건이 나와도 초록이므로, 맞아야 하는 쪽을 먼저 확인한다
  assert.ok(TRACK_WORD.test(read('hooks/lib/track.js')), '탐지기가 track.js에는 맞아야 한다');

  for (const f of GATE_FILES) {
    const src = read(f);
    assert.ok(src.trim().length > 0, `${f}를 읽지 못했다`);
    assert.equal(
      TRACK_WORD.test(src), false,
      `${f}가 track을 참조한다. 트랙이 게이트 판정에 들어가면 PLAN.md에 손으로 쓴 한 줄이\n`
      + '검증 층을 끄는 경로가 된다. (주석에 track이라는 단어를 쓴 것뿐이라면 그 설명을\n'
      + 'DESIGN/테스트 쪽에 두고 여기서는 빼라)',
    );
  }
});

test('B7: 어떤 훅도 lib/track을 require하지 않는다', () => {
  // require 그래프 순회를 쓰지 않는 이유: pdca-gate.js는 셔뱅 달린 실행 스크립트라
  // require하면 main()이 돌면서 fd 0을 읽고 테스트가 매달린다.
  const jsFiles = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) jsFiles.push(p);
    }
  };
  walk(path.join(repoRoot, 'hooks'));
  assert.ok(jsFiles.length > 5, `hooks 아래 js 파일을 찾지 못했다 (${jsFiles.length}개)`);

  const wired = jsFiles.filter((p) => /require\([^)]*lib\/track/.test(fs.readFileSync(p, 'utf8')));
  assert.deepEqual(wired, [], '이번 사이클에서 track.js는 어느 훅에도 배선되지 않는다');
});
