// pdca-detect 훅 본체의 프로세스 계약 — 가장 중요한 불변식은
// "어떤 입력에도 프롬프트를 차단하지 않는다(exit 0)"이다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const hook = path.join(dir, '..', 'hooks', 'pdca-detect.js');
const { shouldTriggerPdca } = createRequire(import.meta.url)(
  path.join(dir, '..', 'hooks', 'lib', 'pdca-patterns.js'),
);

const tmpDirs = [];
function makeRoot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-detect-'));
  fs.writeFileSync(path.join(d, 'package.json'), '{}'); // 프로젝트 루트 표식
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

/** 훅을 실행해 { code, stdout } 반환 */
function run(input) {
  try {
    const stdout = execFileSync('node', [hook], {
      input: typeof input === 'string' ? input : JSON.stringify(input),
      cwd: os.tmpdir(),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout ?? '' };
  }
}

const FEATURE_PROMPT =
  '결제 실패 시 자동 재시도하는 기능 만들어줘. 백오프는 지수로 하고 최대 3회, 실패하면 알림도 보내야 해';

test('기능 요청 + 상태파일 없음 → 컨텍스트 주입', () => {
  const cwd = makeRoot();
  const { code, stdout } = run({ prompt: FEATURE_PROMPT, cwd });
  assert.equal(code, 0);
  assert.match(stdout, /UserPromptSubmit/);
  assert.match(stdout, /PDCA/);
});

// D7·D8 재발 방지 — 자동발동(KICKOFF) 경로가 /plan 커맨드와 같은 산출물을 지시해야 한다.
// 실전 검증에서 KICKOFF에 behaviors.json 지시가 없어 분모가 안 생겼고,
// 상태파일 스키마를 안 박아줘 AI가 cycle/slug/artifacts를 창작했다.
test('KICKOFF는 behaviors.json 생성과 스키마를 지시한다', () => {
  const cwd = makeRoot();
  const { stdout } = run({ prompt: FEATURE_PROMPT, cwd });
  assert.match(stdout, /behaviors\.json/, 'behaviors.json 생성 지시가 있어야 함');
  assert.match(stdout, /passes/, 'passes:false 초기화 지시가 있어야 함');
  assert.match(stdout, /evidence/, 'evidence 규칙이 있어야 함');
});

test('KICKOFF는 pdca-state.json 4필드 스키마를 명시한다', () => {
  const cwd = makeRoot();
  const { stdout } = run({ prompt: FEATURE_PROMPT, cwd });
  for (const field of ['version', 'cycleId', 'stage', 'status']) {
    assert.match(stdout, new RegExp(field), `${field} 필드가 명시돼야 함`);
  }
  // 참조만 시키면 AI가 RULES.md를 안 읽고 창작한다 — 금지 키를 직접 나열해야 함
  assert.match(stdout, /artifacts/, '넣지 말아야 할 키를 명시해야 함');
});

// 자동발동 경로만 옛 워크플로를 가르치면 D7과 같은 실패가 반복된다 —
// 훅이 REPORT.md에 REVIEW.md를 요구하는데 KICKOFF가 gap까지만 안내하면
// AI는 규약대로 하고도 차단당한다.
test('KICKOFF는 review를 필수 단계로 안내한다', () => {
  const cwd = makeRoot();
  const { stdout } = run({ prompt: FEATURE_PROMPT, cwd });
  assert.match(stdout, /\/review/, 'review 단계 안내가 있어야 함');
  assert.match(stdout, /REVIEW\.md/, 'REVIEW.md 산출물을 알려야 함');
  assert.match(stdout, /차단|거부/, '없으면 REPORT가 막힌다는 사실을 알려야 함');
});

// Quick 트랙이 생략하는 것은 DESIGN.md와 두 번째 승인뿐이다. 그 경계를 KICKOFF가 같은
// 안내 안에서 못박지 않으면, 자동발동 경로가 "Quick이니 검증도 가볍게"로 읽힌다.
test('KICKOFF는 트랙을 안내하고 Quick도 behaviors.json이 필수임을 명시한다', () => {
  const cwd = makeRoot();
  const { stdout } = run({ prompt: FEATURE_PROMPT, cwd });
  assert.match(stdout, /track/, '트랙 선언 지시가 있어야 함');
  assert.match(stdout, /Quick/, 'Quick 트랙을 알려야 함');
  assert.match(stdout, /Full/, 'Full 트랙을 알려야 함');
  // 같은 줄에서 필수 산출물을 못박아야 한다 — 다른 절에 흩어져 있으면 트랙과 안 묶인다
  // 훅은 JSON.stringify로 단일 라인을 뱉으므로 개행이 리터럴 `\n`이다 — 이걸 실제 개행('\n')으로
  // "고치면" 조각이 1개가 되어 아래 find가 stdout 전체를 돌려주고 "같은 문장" 단언이 헛돈다.
  const lines = stdout.split('\\n');
  assert.ok(lines.length > 1, '주입 컨텍스트가 줄 단위로 쪼개져야 함(헛돎 방지)');
  const line = lines.find((l) => /Quick도/.test(l));
  assert.ok(line, 'Quick의 필수 산출물을 못박는 문장이 있어야 함');
  for (const must of ['behaviors\\.json', '/gap', '/review', 'REPORT\\.md']) {
    assert.match(line, new RegExp(must), `Quick에서도 필수임을 같은 문장에서 밝혀야 함: ${must}`);
  }
});

// ── 탈출구 (실사용 결함: 사소한 작업에도 전체 사이클이 돌았다) ──────────
// ⚠ 아래 ESCAPE-B1~B4는 **문서 문자열 존재 단언**이다. "이 문구가 AI 행동을 실제로 바꾼다"를
// 주장하지 않는다 — 그건 테스트로 고정 불가능하고, 단언하려 들면 위조다. 실효는 실사용 관측 몫.

/** 주입된 컨텍스트를 줄 배열로. 훅은 JSON 한 줄로 뱉으므로 개행이 리터럴 `\n`이다 */
function kickoffLines(stdout) {
  const lines = stdout.split('\\n');
  assert.ok(lines.length > 5, '주입 컨텍스트가 줄 단위로 쪼개져야 함(헛돎 방지)');
  return lines;
}

test('ESCAPE-B1: 머리말이 감지의 불확실성을 인정하고 판단을 넘긴다 (문구)', () => {
  const cwd = makeRoot();
  const lines = kickoffLines(run({ prompt: FEATURE_PROMPT, cwd }).stdout);
  const head = lines.slice(0, 2).join(' ');

  // ⚠ `/판단|판정/`만 보면 "판정 결과 이 요청은 대규모 작업이다"라는 **완전한 단정문**도
  // 통과한다(GAP 뮤테이션으로 실증). 단정을 막는 것은 어휘가 아니라 **불확실성 인정**이다 —
  // 감지가 틀릴 수 있음을 밝혀야 판정이 권위가 아니라 신호로 읽힌다.
  assert.match(head, /틀린|틀릴/, `감지가 틀릴 수 있음을 밝혀야 함: ${head}`);
  assert.match(head, /판단하라|판단할/, `판단을 읽는 쪽에 넘겨야 함: ${head}`);
  assert.match(head, /\?/, `판단 기준이 질문 형태여야 함: ${head}`);
  assert.doesNotMatch(
    head, /여러 파일에 걸친 기능 작업으로 보인다/,
    '옛 단정문 회귀 — 읽는 쪽은 판정이 이미 끝난 것으로 받아들인다',
  );
});

test('ESCAPE-B2: 탈출 조건이 번호 지시보다 앞에 있다 (문구 순서)', () => {
  const cwd = makeRoot();
  const lines = kickoffLines(run({ prompt: FEATURE_PROMPT, cwd }).stdout);
  const escapeAt = lines.findIndex((l) => /무시하고 바로 진행/.test(l));
  const firstStepAt = lines.findIndex((l) => /^①/.test(l.trim()));
  assert.ok(escapeAt >= 0, '탈출 안내를 찾지 못했다');
  assert.ok(firstStepAt >= 0, '① 지시를 찾지 못했다');
  // 구체적 지시 9개 뒤에 붙은 추상적 허가는 진다(RULES: 충돌하면 예시가 이긴다)
  assert.ok(
    escapeAt < firstStepAt,
    `탈출 조건이 지시보다 뒤에 있다 (탈출 ${escapeAt}행, ① ${firstStepAt}행)`,
  );
});

test('ESCAPE-B3: 탈출 기준이 RULES의 세 조건과 같은 말을 한다 (문구)', () => {
  const cwd = makeRoot();
  const text = kickoffLines(run({ prompt: FEATURE_PROMPT, cwd }).stdout).join(' ');
  // 새 기준을 발명하면 RULES와 어긋난다(D23 재발) — 세 조건을 그대로 가져온다
  assert.match(text, /파일\s*3개/, '파일 3개 기준이 있어야 함');
  assert.match(text, /되돌리기/, '되돌리기 어려움 기준이 있어야 함');
  assert.match(text, /구조\s*결정/, '구조 결정 기준이 있어야 함');
});

test('ESCAPE-B4: 탈출이 정상 경로로 읽히는 표현을 포함한다 (문구)', () => {
  const cwd = makeRoot();
  const text = kickoffLines(run({ prompt: FEATURE_PROMPT, cwd }).stdout).join(' ');
  // 탈출이 위반·예외처럼 읽히면 아무도 안 쓴다
  assert.match(text, /정상|흔한/, '탈출이 정상 경로임을 밝혀야 함');
});

test('ESCAPE-B6: 탈출구 변경이 발동 판정을 건드리지 않는다', () => {
  // 이 사이클은 "발동 후 행동"만 바꾼다. 발동 빈도(오탐·미탐)는 다음 사이클 몫이라,
  // 여기서 판정까지 손대면 두 변경의 효과가 섞여 실사용 관측이 무의미해진다.
  const cwd = makeRoot();
  assert.equal(shouldTriggerPdca(FEATURE_PROMPT).trigger, true, '기능 요청은 여전히 발동');
  assert.equal(shouldTriggerPdca('결제 기능은 어떻게 만들어?').trigger, false, '질문은 여전히 미발동');
  assert.equal(shouldTriggerPdca('오타 하나 고쳐줘').trigger, false, '사소한 요청은 여전히 미발동');
  // 훅 경로로도 같은 결론이 나오는지(KICKOFF 주입 유무).
  // ⚠ "빈 stdout"으로 재지 않는다 — 언어 지시는 매 턴 나가므로 stdout은 항상 비지 않는다.
  assert.doesNotMatch(run({ prompt: '결제 기능은 어떻게 만들어?', cwd }).stdout, /behaviors\.json/);
  assert.match(run({ prompt: FEATURE_PROMPT, cwd }).stdout, /behaviors\.json/);
});

test('질문 프롬프트 → KICKOFF 주입 없음(언어 지시만)', () => {
  const cwd = makeRoot();
  const { code, stdout } = run({ prompt: '결제 기능은 어떻게 만들어?', cwd });
  assert.equal(code, 0);
  assert.doesNotMatch(stdout, /behaviors\.json/, 'PDCA 규약이 새면 안 됨');
  assert.doesNotMatch(stdout, /진행 중 사이클/, '재개 컨텍스트가 새면 안 됨');
});

// ── 출력 언어 고정 (docs/2026-08-12-output-language-lock) ──────────────
// 언어 규칙은 이미 세 곳(전역 CLAUDE.md·RULES SUMMARY·SessionStart)에 있는데도 응답이 영어로 샜다.
// 부재가 아니라 드리프트 — 영어 툴 출력이 쌓이면 출력 언어가 끌린다. 그래서 규칙을 더 쓰는 대신
// 매 턴 가장 최근 위치(UserPromptSubmit)에 1행을 놓는다. 거리 문제는 거리로 푼다.

/**
 * 주입된 컨텍스트에서 언어 지시 1행만 뽑는다.
 * ⚠ stdout을 `split('\\n')`으로 자르면 안 된다 — 언어 지시만 나갈 때는 리터럴 `\n`이 하나도
 * 없어서 조각이 1개가 되고, find가 JSON 래퍼째 stdout 전체를 돌려준다(kickoffLines가 같은
 * 함정에 가드를 걸어둔 이유). 그러면 B7이 재는 값이 지시 길이가 아니라 래퍼 포함 길이가 된다.
 * JSON을 파싱해 additionalContext에서 자른다.
 */
function langLine(stdout) {
  const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext;
  const line = ctx.split('\n').find((l) => /출력 언어/.test(l));
  assert.ok(line, `언어 지시를 찾지 못했다: ${ctx.slice(0, 200)}`);
  return line;
}

test('B1: 사이클 없음 + PDCA 미발동인 평범한 프롬프트에도 언어 지시가 주입된다', () => {
  const cwd = makeRoot();
  const { code, stdout } = run({ prompt: '이거 왜 이래?', cwd });
  assert.equal(code, 0);
  assert.match(stdout, /UserPromptSubmit/);
  langLine(stdout);
});

test('B2: KICKOFF와 동시 발동 시 둘 다 나간다', () => {
  const cwd = makeRoot();
  const { stdout } = run({ prompt: FEATURE_PROMPT, cwd });
  assert.match(stdout, /behaviors\.json/, 'KICKOFF가 살아 있어야 함');
  langLine(stdout);
});

test('B3: 재개 컨텍스트와 동시 발동 시에도 둘 다 나간다', () => {
  const cwd = makeRoot();
  fs.mkdirSync(path.join(cwd, '.devkit'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, '.devkit', 'pdca-state.json'),
    JSON.stringify({ version: 1, cycleId: '2026-07-23-t', stage: 'do', status: 'in-progress' }),
  );
  const { stdout } = run({ prompt: '이거 뭐야?', cwd });
  assert.match(stdout, /진행 중 사이클/, '재개 컨텍스트가 살아 있어야 함');
  langLine(stdout);
});

test('B4: 특정 언어를 고정하지 않는다 — 사용자 언어를 따라간다', () => {
  const cwd = makeRoot();
  const line = langLine(run({ prompt: '이거 왜 이래?', cwd }).stdout);
  // 언어 이름을 박으면 사용자가 언어를 바꿔도 안 따라간다. 그게 이 사이클이 없애려는 것이다.
  for (const hardcoded of ['한국어', 'Korean', '영어로 답']) {
    assert.doesNotMatch(line, new RegExp(hardcoded), `언어를 고정하면 안 됨: ${hardcoded}`);
  }
  assert.match(line, /사용자/, '사용자 기준임을 밝혀야 함');
  // 히스테리시스를 코드가 아니라 문장으로 넣는다 — 짧은 영문 명령 한 줄에 언어가 뒤집히면 안 된다
  assert.match(line, /명령|붙여넣기/, '짧은 명령이 언어 신호가 아님을 밝혀야 함');
});

// REVIEW에서 나온 behavior — PLAN 시점에는 없었다.
// tool_result는 Claude API에서 **user role**로 들어간다. 그래서 Bash·Read를 몇 번 돌리면
// "직전 사용자 메시지"는 영문 툴 출력이 되고, 그게 정확히 이 훅이 막으려던 드리프트다.
// 지시가 원인을 명시적으로 배제하지 않으면 원인을 승인하는 문장이 된다.
test('B8: 툴 출력·로그를 언어 신호에서 명시적으로 제외한다', () => {
  const cwd = makeRoot();
  const line = langLine(run({ prompt: '이거 왜 이래?', cwd }).stdout);
  assert.match(line, /직접 입력/, '사용자가 직접 입력한 것으로 좁혀야 함');
  assert.match(line, /툴 출력/, '툴 출력이 언어 신호가 아님을 밝혀야 함');
  assert.doesNotMatch(
    line, /직전 사용자 메시지의 언어로/,
    '옛 문구 회귀 — tool_result가 user role이라 영문 툴 출력을 언어 신호로 승인한다',
  );
});

test('B5: 기술 용어·에러 원문 유지를 같은 줄에서 밝힌다', () => {
  const cwd = makeRoot();
  const line = langLine(run({ prompt: '이거 왜 이래?', cwd }).stdout);
  assert.match(line, /원문/, '원문 유지 지시가 있어야 함');
  assert.match(line, /에러|로그/, '에러·로그가 대상임을 밝혀야 함');
});

test('B7: 언어 지시는 1행 200자 이내 (주입 비용 상한)', () => {
  const cwd = makeRoot();
  const line = langLine(run({ prompt: '이거 왜 이래?', cwd }).stdout);
  assert.ok(line.length <= 200, `언어 지시가 너무 길다(${line.length}자): ${line}`);
});

// ── 출력 서식 ────────────────────────────────────────────────
// 같은 메커니즘·같은 자리. 위험은 반대 방향이다: 조건 없이 "헤더를 써라"라고 하면
// 한 줄이면 될 답에 ### 와 --- 가 붙어 더 읽기 나빠진다. 그래서 임계와 면제를 강제한다.
function fmtLine(stdout) {
  const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext;
  const line = ctx.split('\n').find((l) => /출력 서식/.test(l));
  assert.ok(line, `서식 지시를 찾지 못했다: ${ctx.slice(0, 200)}`);
  return line;
}

test('F1: 평범한 프롬프트에도 서식 지시가 주입되고, 언어 지시와 공존한다', () => {
  const cwd = makeRoot();
  const { code, stdout } = run({ prompt: '이거 왜 이래?', cwd });
  assert.equal(code, 0);
  fmtLine(stdout);
  langLine(stdout); // 서식을 넣느라 언어가 밀려나면 안 된다
});

test('F2: 언어 지시가 서식보다 뒤에 온다 (가장 가까운 자리는 언어 몫)', () => {
  const cwd = makeRoot();
  const ctx = JSON.parse(run({ prompt: '이거 왜 이래?', cwd }).stdout)
    .hookSpecificOutput.additionalContext;
  const lines = ctx.split('\n').filter(Boolean);
  assert.ok(
    lines.findIndex((l) => /출력 서식/.test(l)) < lines.findIndex((l) => /출력 언어/.test(l)),
    '언어 지시가 맨 뒤여야 한다',
  );
});

test('F3: KICKOFF 머리말이 첫 줄이라는 계약을 서식 줄이 깨지 않는다', () => {
  const cwd = makeRoot();
  const ctx = JSON.parse(run({ prompt: FEATURE_PROMPT, cwd }).stdout)
    .hookSpecificOutput.additionalContext;
  assert.match(ctx.split('\n')[0], /^\[devkit PDCA\]/);
});

// ⚠ 이게 이 기능의 핵심 가드다. 임계 없이 항상 구조를 주면 전역 CLAUDE.md의
// "간결하게, 1줄이면 1줄"과 충돌해 짧은 답까지 헤더가 붙는다 — 고치려던 문제를 키운다.
test('F4: 무조건이 아니라 길 때만 — 짧은 답 면제를 같은 줄에서 밝힌다', () => {
  const cwd = makeRoot();
  const line = fmtLine(run({ prompt: '이거 왜 이래?', cwd }).stdout);
  assert.match(line, /넘거나|이상|여럿/, '언제 구조를 줄지 임계가 있어야 함');
  assert.match(line, /짧게|짧은 답/, '짧은 답 면제가 있어야 함');
});

test('F5: 사용자가 요청한 네 가지를 다 지시한다 (헤더·문단·굵게·디바이더)', () => {
  const cwd = makeRoot();
  const line = fmtLine(run({ prompt: '이거 왜 이래?', cwd }).stdout);
  assert.match(line, /###/, '헤더');
  assert.match(line, /빈 줄|문단/, '문단 구분');
  assert.match(line, /굵게/, '강조');
  assert.match(line, /---/, '디바이더');
});

test('F6: 서식 지시는 1행 200자 이내 (주입 비용 상한)', () => {
  const cwd = makeRoot();
  const line = fmtLine(run({ prompt: '이거 왜 이래?', cwd }).stdout);
  assert.ok(line.length <= 200, `서식 지시가 너무 길다(${line.length}자): ${line}`);
});

test('진행 중 사이클이 있으면 재개 컨텍스트를 주입(감지보다 우선)', () => {
  const cwd = makeRoot();
  fs.mkdirSync(path.join(cwd, '.devkit'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, '.devkit', 'pdca-state.json'),
    JSON.stringify({
      version: 1,
      cycleId: '2026-07-23-test-cycle',
      stage: 'design',
      status: 'awaiting-approval',
    }),
  );
  // 질문이라 감지는 미발동이지만, 진행 중 사이클이므로 재개 컨텍스트가 나와야 함
  const { code, stdout } = run({ prompt: '이거 뭐야?', cwd });
  assert.equal(code, 0);
  assert.match(stdout, /진행 중 사이클/);
  assert.match(stdout, /승인 대기/);
  // 4필드 축소로 제거된 필드를 참조하면 "undefined"가 주입된다 — 재발 방지
  assert.doesNotMatch(stdout, /undefined/, '제거된 필드 참조로 undefined가 새면 안 됨');
});

test('비차단 불변식: 깨진 입력에도 exit 0 + 빈 stdout', () => {
  for (const bad of ['{깨진 JSON', '', JSON.stringify({ cwd: '/tmp' })]) {
    const { code, stdout } = run(bad);
    assert.equal(code, 0, `exit 0이어야 함: ${bad.slice(0, 20)}`);
    assert.equal(stdout.trim(), '');
  }
});
