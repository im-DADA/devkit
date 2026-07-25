// pdca-detect 훅 본체의 프로세스 계약 — 가장 중요한 불변식은
// "어떤 입력에도 프롬프트를 차단하지 않는다(exit 0)"이다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const hook = path.join(dir, '..', 'hooks', 'pdca-detect.js');

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
