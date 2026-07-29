// PDCA 자동 발동 감지 규칙 — 훅 본체와 테스트가 공유하는 단일 정의.
// UserPromptSubmit은 matcher가 없어 모든 프롬프트에 훅이 돈다. 따라서 여기서 걸러야 한다.
// 설계 원칙: 억제 → 배제 → 포함 순. 미탐이 오탐보다 싸다(미탐 비용 = 평소처럼 동작).
// 정규식에 `g` 플래그 금지 — lastIndex가 남아 멱등성이 깨진다.

const QUESTION_RE =
  /뭐(야|지|니|하는)|어떻게\s*(해|하지|되|하나|만들)|왜\s|설명(해|좀)|알려줘|찾아줘|보여줘|확인해|\?\s*$|^(what|why|how|explain|show|find)\b/i;

// 시안·목업은 "로그인 화면"처럼 SCOPE_NOUN을 품고 있어 점수가 오르지만, 산출물을 그리는
// 작업이지 시스템을 짓는 작업이 아니다 — behaviors.json·gap·review를 걸 대상이 아니다.
const TRIVIAL_RE =
  /오타|한\s?줄|이름만|색(상)?만|여기만|방금|되돌려|롤백|지워|삭제해|주석|포맷|시안|목업|mockup|와이어프레임|바꿔줘\s*$/i;

const META_RE = /devkit|훅|hook|RULES\.md|커맨드|에이전트|플러그인|사이클\s*(조회|목록)/i;

const BUILD_VERB_RE =
  /만들어|만들자|구현|추가해|개발|붙여|도입|세팅|구축|리팩(토링)?|마이그레이션|^(build|implement|add|create)\b/i;

const SCOPE_NOUN_RE =
  /기능|페이지|화면|API|엔드포인트|플로우|시스템|모듈|대시보드|인증|로그인|회원가입|결제|알림|검색|필터|flow|page|dashboard|login|auth|checkout/i;

const MIN_LENGTH = 15;
const MAX_LENGTH = 4000;
const SCORE_THRESHOLD = 3;
const LONG_PROMPT = 120;

// ⚠ `countClauses`(절 개수 가점)를 제거했다. "요구 항목 수"를 잰다고 했지만 실제로는
// **구두점을 셌다** — `"README 만들어줘. 설치법이랑 사용법, 예제까지"`처럼 쉼표로 나열만 해도
// 절이 늘어 파일 하나짜리 작업이 임계를 넘었다(실사용 오탐). 요구 항목 수는 **작업 규모가 아니다.**
// 제거 후 실측: 기존 발동 케이스 4건은 전부 3점 유지, 문서·엑셀·유틸 생성 4건은 전부 2점으로 내려간다.

/**
 * 이 프롬프트가 PDCA 사이클을 시작할 만한 기능 요청인가?
 * @returns {{ trigger: boolean, reason: string, score?: number }}
 */
function shouldTriggerPdca(prompt) {
  if (typeof prompt !== 'string') return { trigger: false, reason: 'invalid' };
  const trimmed = prompt.trim();

  // ── 배제 게이트 (포함보다 우선) ──
  if (trimmed.startsWith('/')) return { trigger: false, reason: 'slash' };
  if (trimmed.length < MIN_LENGTH) return { trigger: false, reason: 'too-short' };
  if (prompt.length > MAX_LENGTH) return { trigger: false, reason: 'too-long' };
  if (QUESTION_RE.test(trimmed)) return { trigger: false, reason: 'question' };
  if (TRIVIAL_RE.test(trimmed)) return { trigger: false, reason: 'trivial' };
  if (META_RE.test(trimmed)) return { trigger: false, reason: 'meta' };

  // ── 동사 게이트키퍼: 없으면 점수와 무관하게 미발동 ──
  if (!BUILD_VERB_RE.test(trimmed)) return { trigger: false, reason: 'no-build-verb' };

  // ── 포함 스코어 ──
  let score = 2; // 동사 매치는 여기 도달 시점에 확정
  if (SCOPE_NOUN_RE.test(trimmed)) score += 1;
  if (trimmed.length >= LONG_PROMPT) score += 1;

  if (score < SCORE_THRESHOLD) return { trigger: false, reason: 'low-score', score };
  return { trigger: true, reason: 'match', score };
}

module.exports = {
  shouldTriggerPdca,
  QUESTION_RE,
  TRIVIAL_RE,
  META_RE,
  BUILD_VERB_RE,
  SCOPE_NOUN_RE,
};
