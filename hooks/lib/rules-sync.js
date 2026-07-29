// 소비자 프로젝트의 AGENTS.md 공통 규칙 사본이 플러그인 정본과 같은지 판정한다.
//
// 왜 필요한가: `/kit init`이 RULES.md의 SUMMARY 블록을 AGENTS.md에 **인라인 복사**하는데
// (Cursor·Codex도 읽게 하려면 링크로는 안 된다) 재동기화 경로가 없다. devkit이 규칙을
// 바꿔도 이미 init한 프로젝트에는 영원히 도달하지 않고, 에이전트는 AGENTS.md를 **우선**
// 읽는다. 결함로그 D26의 세 번째 갈래 — devkit 레포 안의 테스트로는 원리적으로 못 잡는다.
//
// ⚠ 이 함수는 **남의 레포 파일**을 판정한다. 틀리면 사용자가 자기 규칙을 의심하게 되므로
// 오탐이 미탐보다 비싸다. 계약의 절반이 "판정하지 않는다"(unknown/custom)에 있는 이유다.
//
// 해시도 버전 번호도 두지 않는다 — 정본이 런타임에 옆에 있는데(플러그인 RULES.md) 지문을
// 따로 보관하면 **그 지문이 또 낡는다.** 드리프트를 막으려고 드리프트할 수 있는 것을
// 새로 만들지 않는다. fs를 안 보는 순수함수이므로 파일 읽기는 호출자(session-start)가 한다.

// 구간은 마커라는 **형태**로 갈린다. 자유 텍스트를 분류해 "이건 커스터마이즈인가"를
// 추론하지 않는다 — 그건 허용목록이 되어 양방향으로 틀린다(D24·D25).
const START = /<!--\s*devkit:rules:start(?:\s+mode=([A-Za-z]+))?\s*-->/;
const END = /<!--\s*devkit:rules:end\s*-->/;
const MODES = ['managed', 'custom'];

// `/kit init`이 심는 절 제목. **마커가 도입되기 전에 만들어진 사본**을 식별하는 유일한
// 형태다 — 이 사이클이 목표한 인구가 정확히 그들이고, 마커 없음을 전부 침묵 처리하면
// 그 인구에서 기능이 통째로 안 돈다(GAP G1, 실측). 마커를 넣으려면 `/kit sync`를 돌려야
// 하는데 돌릴 이유를 알려주는 게 그 안내라서, 침묵시키면 순환에 빠진다.
const DEVKIT_SECTION = /^##\s*공통 규칙\s*$/m;

// 비교 대상은 **규칙 줄들**이지 마크다운 서식이 아니다. 빈 줄과 줄 끝 공백은 규칙 내용을
// 담지 않으므로 전부 버린다.
// ⚠ DESIGN은 "연속 빈 줄 1개로 축약"이라 적었는데 그걸론 부족했다(빈 줄 1개가 삽입되면
// 영원히 stale). 방향도 DESIGN이 반대로 적었다 — 이 탐지기에서 비싼 실패는 미탐이 아니라
// **오탐**이다. 낡은 사본이 하루 더 사는 것보다, 멀쩡한 사본에 매 세션 경고가 뜨는 쪽이
// 기능 자체를 무력화한다(무시 학습). 그래서 좁게가 아니라 넉넉히 정규화한다.
// 들여쓰기는 남긴다 — 중첩 목록은 규칙의 구조라서 버리면 실제 변경을 놓친다.
function normalize(text) {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '');
  // 공통 들여쓰기는 버린다(dedent). `/kit init`의 템플릿은 `kit.md`의 코드펜스 안에
  // 들여쓰기된 채 보이므로, 모델이 그대로 옮기면 사본 전 줄에 들여쓰기가 붙는다 —
  // 앞 공백을 그대로 두면 **모든 프로젝트가 영원히 stale**이 된다(리뷰에서 실측).
  // 상대 들여쓰기는 남는다 — 중첩 목록은 규칙의 구조라서 버리면 실제 변경을 놓친다.
  const minIndent = lines.reduce((m, l) => Math.min(m, l.length - l.trimStart().length), Infinity);
  return (minIndent > 0 && minIndent < Infinity ? lines.map((l) => l.slice(minIndent)) : lines)
    .join('\n');
}

/** 대칭 차집합의 줄 수. "3줄 다르다"는 행동을 유발하고 "다르다"는 안 한다. */
function countDiffLines(a, b) {
  const remaining = new Map();
  for (const line of b.split('\n')) remaining.set(line, (remaining.get(line) || 0) + 1);
  let diff = 0;
  for (const line of a.split('\n')) {
    const n = remaining.get(line);
    if (n) remaining.set(line, n - 1);
    else diff += 1;
  }
  for (const n of remaining.values()) diff += n;
  return diff;
}

const unknown = (reason) => ({ state: 'unknown', diffLines: 0, reason });

/**
 * @param {string} canonical 플러그인 RULES.md의 SUMMARY 블록 원문
 * @param {string} agentsMd  소비자 AGENTS.md 전문
 * @returns {{state:'current'|'stale'|'custom'|'unknown', diffLines:number, reason:string}}
 *   - current  사본이 정본과 같다 → 조용히 있는다
 *   - stale    다르다. diffLines에 차이 줄 수
 *   - custom   사용자가 소유를 선언했다 → 비교조차 하지 않는다
 *   - unknown  판정 불가(마커 없음·깨짐·모르는 모드) → 경고하지 않는다
 */
function compareRules(canonical, agentsMd) {
  if (typeof canonical !== 'string' || typeof agentsMd !== 'string') {
    return unknown('입력이 문자열이 아니다');
  }

  const start = START.exec(agentsMd);
  if (!start) {
    // 마커가 없는 것은 "낡음"이 아니다 — 어디까지가 devkit 사본인지 모르므로 비교하지 않는다.
    // 다만 devkit이 심은 절이 보이면 **마이그레이션 대상**으로 갈라낸다. 이걸 unknown에
    // 묶어 침묵시키면 기존 사용자 전원이 영원히 탐지 밖에 남는다(GAP G1).
    return DEVKIT_SECTION.test(agentsMd)
      ? { state: 'unmarked', diffLines: 0, reason: 'devkit 사본으로 보이나 마커가 없다' }
      : unknown('devkit 흔적 없음 — 남의 파일');
  }

  const mode = start[1] || 'managed';
  if (!MODES.includes(mode)) return unknown(`모르는 mode: ${mode}`);
  // custom은 내용을 읽지도 않는다. 침묵이 계약이다.
  if (mode === 'custom') return { state: 'custom', diffLines: 0, reason: '사용자 소유 구간' };

  const rest = agentsMd.slice(start.index + start[0].length);
  const end = END.exec(rest);
  if (!end) return unknown('end 마커 없음');

  const mine = normalize(rest.slice(0, end.index));
  const theirs = normalize(canonical);
  if (mine === theirs) return { state: 'current', diffLines: 0, reason: '' };

  const diffLines = countDiffLines(mine, theirs);
  return { state: 'stale', diffLines, reason: `${diffLines}줄 다르다` };
}

module.exports = { compareRules, normalize, START, END };
