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
  // 훅 경로로도 같은 결론이 나오는지(주입 유무)
  assert.equal(run({ prompt: '결제 기능은 어떻게 만들어?', cwd }).stdout.trim(), '');
  assert.notEqual(run({ prompt: FEATURE_PROMPT, cwd }).stdout.trim(), '');
});

test('질문 프롬프트 → 주입 없음(빈 stdout)', () => {
  const cwd = makeRoot();
  const { code, stdout } = run({ prompt: '결제 기능은 어떻게 만들어?', cwd });
  assert.equal(code, 0);
  assert.equal(stdout.trim(), '');
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
