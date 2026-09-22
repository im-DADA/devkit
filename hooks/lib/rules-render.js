// 설정에 따라 주입할 규칙 텍스트를 만든다. **순수** — fs도 config 로딩도 하지 않는다
// (호출자가 원문과 설정을 준다. rules-sync.js:13과 같은 계약이다).
//
// 설계: docs/2026-09-21-devkit-config/DESIGN.md §3.2·§6.4·§9
//
// ⚠ **이 모듈은 규칙 문장을 쓰지 않는다. 지우기만 한다.**
// 코드가 규칙 문장을 생성하기 시작하면 정본이 둘이 되고, 그게 D23·D26이 기록한 실패다
// (RULES.md:189 — 규칙이 소비되는 자리가 갈라지면 한쪽이 조용히 낡는다).
// 그래서 설정이 기본값이면 출력이 원문과 **바이트 단위로 같다**. 그 항등식이
// "설정 안 한 사람은 지금과 100% 동일"의 증명이고 test/rules-render.test.mjs U6·U7이 고정한다.
//
// ⚠ **제거만으로는 절반이 표현되지 않는다.** SUMMARY는 항목 수 상한이 15개로 이미 차 있어
// (test/plugin.test.mjs:117) 줄을 쪼갤 수 없고, 머지 전략처럼 애초에 주입 규칙에 없는 항목은
// 지울 줄 자체가 없다. 그 자리는 `renderSettingsNote`가 **규칙이 아니라 값만** 한 줄씩 찍어
// 메운다 — `- [devkit 설정] 머지 전략: merge`는 "왜"를 말하지 않으므로 절차 정본과 경쟁하지 않는다.
//
// ⚠ **매핑 정규식은 RULES.md 문구에 붙어 있다.** 문구를 고치면 매치 0건 → 제거 0건 →
// 설정이 조용히 안 먹는다. 그 침묵을 막는 유일한 장치가 U9(매핑 생존 테스트)다. 지우지 마라.

/** SUMMARY 블록에서 설정에 따라 **줄 하나**를 뺀다. `match`는 그 줄에만 맞아야 한다(U9) */
const SUMMARY_MAP = [
  { key: 'pdca', match: /^- 🔄 PDCA 사이클:/, drop: (c) => !c.pdca.enabled },
  { key: 'structure', match: /^- Feature 구조:/, drop: (c) => c.structure !== 'features' },
  { key: 'tsxLogic', match: /^- 🔒 \.tsx엔 로직 금지/, drop: (c) => !c.rules.tsxLogic },
  { key: 'naming', match: /^- 네이밍\(린터가 못 잡는 것만\):/, drop: (c) => !c.rules.naming },
  { key: 'testing', match: /^- 🧪 새 순수함수/, drop: (c) => c.testing === 'off' },
  {
    key: 'commit',
    match: /^- 커밋: Conventional Commits/,
    // 이 줄은 규약과 Co-Authored-By 금지를 **둘 다** 담는다. 하나만 끈 사람에게서 줄을 빼면
    // 남은 규칙까지 사라지므로, 둘 다 껐을 때만 뺀다(틀리는 방향을 "규칙이 남는다" 쪽으로).
    drop: (c) => c.commit.convention === 'free' && c.commit.coAuthoredBy === 'allow',
  },
];

/** CODEX 블록. `until`이 있으면 그 줄 **앞까지**가 한 절이다(헤딩 단위 제거) */
const CODEX_MAP = [
  { key: 'pdca', match: /^## PDCA 사이클 — 구현자로서 할 일$/, until: /^## /, drop: (c) => !c.pdca.enabled },
  { key: 'structure', match: /^- Feature 구조\(/, drop: (c) => c.structure !== 'features' },
  { key: 'tsxLogic', match: /^- 🔒 `\.tsx`엔 로직 금지/, drop: (c) => !c.rules.tsxLogic },
  { key: 'naming', match: /^- 네이밍: 훅 /, drop: (c) => !c.rules.naming },
  { key: 'testing', match: /^- 🧪 새 순수함수·명확한 계약/, drop: (c) => c.testing === 'off' },
  {
    key: 'commit',
    match: /^- 커밋: Conventional Commits/,
    drop: (c) => c.commit.convention === 'free' && c.commit.coAuthoredBy === 'allow',
  },
];

/**
 * 매핑이 지시한 줄·절을 뺀 블록.
 *
 * 한 줄이 여러 엔트리에 맞아도 한 번만 지워진다(집합으로 모은 뒤 필터). 지울 것이 없으면
 * **원문 문자열을 그대로** 돌려준다 — join으로 재조립하면 줄바꿈 표기가 미묘하게 달라질 수 있고,
 * 그 차이가 드리프트 탐지의 오탐이 된다.
 */
function renderBlock(raw, cfg, map) {
  if (typeof raw !== 'string') return '';
  const active = map.filter((e) => {
    try {
      return e.drop(cfg);
    } catch {
      return false; // 설정 모양이 예상 밖이면 **지우지 않는다**(규칙이 남는 쪽으로 넘어진다)
    }
  });
  if (!active.length) return raw;

  const lines = raw.split('\n');
  const cut = new Set();
  for (const e of active) {
    for (let i = 0; i < lines.length; i++) {
      if (!e.match.test(lines[i])) continue;
      cut.add(i);
      if (!e.until) continue;
      // 절 제거: 다음 경계(헤딩 등) 앞까지. 경계를 못 만나면 블록 끝까지다.
      for (let j = i + 1; j < lines.length && !e.until.test(lines[j]); j++) cut.add(j);
    }
  }
  return lines.filter((_, i) => !cut.has(i)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const renderSummary = (raw, cfg) => renderBlock(raw, cfg, SUMMARY_MAP);
const renderCodex = (raw, cfg) => renderBlock(raw, cfg, CODEX_MAP);

// 값만 적는다. 규칙을 설명하지 않고 판정 근거도 적지 않는다 — 그건 정본의 일이다.
const NOTES = [
  { when: (c) => c.merge.strategy !== 'squash', line: (c) => `머지 전략: ${c.merge.strategy}` },
  { when: (c) => c.pdca.defaultTrack !== 'Full', line: (c) => `PDCA 기본 트랙: ${c.pdca.defaultTrack}` },
  { when: (c) => c.structure !== 'features', line: (c) => `폴더 구조: ${c.structure}` },
  { when: (c) => c.testing === 'after', line: () => '테스트: 사후 고정(test-after)' },
  { when: (c) => c.tone === 'neutral', line: () => '톤: neutral' },
  { when: (c) => c.commit.coAuthoredBy === 'allow', line: () => 'Co-Authored-By: 허용' },
  { when: (c) => c.commit.convention === 'free', line: () => '커밋 규약: 자유 형식' },
  // SG2 — 검증 문서 게이트를 내린 상태는 **조용히 존재하면 안 된다**(DESIGN §1-④ 반전 블록).
  // devkit이 가장 싫어하는 것은 차단이 아니라 침묵이다.
  {
    when: (c) => c.pdca.docs !== 'full',
    line: (c) => `검증 문서 게이트: ${c.pdca.docs} — GAP·REVIEW를 REPORT 선행조건에서 뺐다`,
  },
];

/**
 * 기본값과 다른 설정만 값으로 한 줄씩. **기본값이면 빈 문자열**이다.
 *
 * ⚠ 이 문자열은 드리프트 비교(`compareRules`)의 정본에 **들어가면 안 된다** — 소비자
 * AGENTS.md 사본에는 없는 내용이라, 섞으면 설정한 사람 전원이 영구 stale이 된다(DESIGN §9.3).
 * @returns 끝에 줄바꿈이 붙은 여러 줄, 또는 `''`
 */
function renderSettingsNote(cfg) {
  const lines = [];
  for (const n of NOTES) {
    try {
      if (n.when(cfg)) lines.push(`- [devkit 설정] ${n.line(cfg)}`);
    } catch {
      // 설정 모양이 예상 밖이면 그 줄만 건너뛴다 — 노트 때문에 세션 시작이 깨지지 않는다
    }
  }
  return lines.length ? `\n${lines.join('\n')}` : '';
}

module.exports = { SUMMARY_MAP, CODEX_MAP, renderBlock, renderSummary, renderCodex, renderSettingsNote };
