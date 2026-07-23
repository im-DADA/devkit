// pdca-detect 감지 규칙 회귀 테스트 — 오탐(워크플로가 잡담에 뜨는 것)이 가장 큰 리스크라
// 발동/미발동 경계를 여기서 고정한다. 순수함수라 프로세스 실행 없이 직접 호출.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { shouldTriggerPdca, BUILD_VERB_RE } = require(
  path.join(dir, '..', 'hooks', 'lib', 'pdca-patterns.js'),
);

// ── 발동해야 하는 것 (기능 요청) ──
const TRIGGER_CASES = [
  '결제 실패 시 자동 재시도하는 기능 만들어줘. 백오프는 지수로 하고 최대 3회, 실패하면 알림도 보내야 해',
  '대시보드 페이지 새로 하나 추가해줘 — 매출 차트랑 유저 목록, 필터까지',
  '소셜 로그인 붙여줘. 카카오랑 구글 둘 다 지원하고 기존 이메일 계정이랑 연동돼야 함',
  'implement a full checkout flow with cart, payment and order confirmation pages',
];

// ── 발동하면 안 되는 것 [입력, 이유] ──
const SKIP_CASES = [
  ['결제 기능은 어떻게 만들어?', 'question'],
  // 11자라 길이 게이트가 질문 게이트보다 먼저 걸린다(배제 순서: 길이 → 질문)
  ['이 파일 뭐하는 거야?', 'too-short'],
  ['user-card.tsx에 오타 하나만 고쳐줘', 'trivial'],
  ['ㅇㅋ 진행해줘', 'too-short'],
  ['/flow 결제 재시도', 'slash'],
  ['버튼 색상만 파란색으로 바꿔줘 지금 회색인데', 'trivial'],
  // "왜"가 있어 question 게이트가 meta보다 먼저 걸린다 — 어느 쪽이든 미발동이라 무해
  ['devkit 훅이 왜 발동 안 하지 pdca-detect.js 좀 봐줘', 'question'],
  // 질문 어투가 없는 순수 meta 케이스
  ['devkit 플러그인 훅 구조를 좀 정리해서 만들어줘 지금 파일이 흩어져 있어', 'meta'],
  ['x'.repeat(4001), 'too-long'],
  ['이거 리팩토링 좀 해줄래 코드가 너무 길어졌어', 'low-score'],
  ['', 'too-short'],
  ['   ', 'too-short'],
];

test('shouldTriggerPdca: 기능 요청은 발동', () => {
  for (const prompt of TRIGGER_CASES) {
    assert.equal(shouldTriggerPdca(prompt).trigger, true, `발동해야 함: ${prompt.slice(0, 30)}`);
  }
});

test('shouldTriggerPdca: 질문·사소·메타·짧은 입력은 미발동', () => {
  for (const [prompt, why] of SKIP_CASES) {
    const result = shouldTriggerPdca(prompt);
    assert.equal(result.trigger, false, `미발동해야 함(${why}): ${prompt.slice(0, 30)}`);
    // reason까지 고정해야 배제 게이트 순서가 바뀌는 회귀를 잡는다
    assert.equal(result.reason, why, `사유가 달라짐: ${prompt.slice(0, 30)}`);
  }
});

test('불변식: 발동했다면 반드시 동사(BUILD_VERB_RE)가 매치한다', () => {
  for (const prompt of [...TRIGGER_CASES, ...SKIP_CASES.map(([p]) => p)]) {
    const { trigger } = shouldTriggerPdca(prompt);
    assert.ok(!trigger || BUILD_VERB_RE.test(prompt), `동사 게이트키퍼 위반: ${prompt.slice(0, 30)}`);
  }
});

test('멱등성: 같은 입력을 두 번 호출해도 결과가 같다', () => {
  for (const prompt of [...TRIGGER_CASES, ...SKIP_CASES.map(([p]) => p)]) {
    assert.deepEqual(shouldTriggerPdca(prompt), shouldTriggerPdca(prompt));
  }
});
