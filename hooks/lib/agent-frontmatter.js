// 에이전트의 `model`·`effort` 두 줄을 읽고 바꾼다. **순수** — 문자열 in, 문자열 out.
//
// 설계: docs/2026-09-21-devkit-config/DESIGN.md §3.3
//
// 왜 플러그인 파일을 직접 고치나(경로 A, 2026-09-21 사용자 결정):
//   - 플러그인 에이전트는 `devkit:architect`처럼 **이름이 네임스페이스로 갈린다.** 그래서
//     `~/.claude/agents/architect.md`는 오버라이드가 아니라 **이름이 다른 별개 에이전트**가
//     된다(같은 일을 하는 에이전트가 둘 생기고 어느 쪽이 불릴지 비결정적이다).
//   - settings.json으로 덮는 키는 **찾지 못했다**(`agentModels`·`agentOverrides`·
//     `subagentModel`까지 봤다. 없다고 단정하지는 않는다).
//   - 남는 길은 frontmatter를 직접 고치는 것뿐이다. 실측(CC 2.1.278)으로 플러그인
//     에이전트도 `model`·`effort`가 유효함을 확인했다 — 무시되는 것은
//     `permissionMode`·`hooks`·`mcpServers` 셋뿐이다.
//
// 대가: **플러그인을 업데이트하면 설정이 풀린다.** 풀리는 방향이 기본값이라 안전한 쪽이지만
// 조용하다. `modelDriftMessage`가 그 침묵을 없애는 유일한 방어선이다(B21).
//
// ⚠ frontmatter 파싱이 어긋나면 에이전트가 통째로 망가진다. 그래서 이 모듈은
// **있는 줄만 바꾸고, 없는 줄은 만들지 않는다.** 형태가 예상과 다르면 실패를 돌려준다 —
// 모르는 파일을 고쳐 놓는 것보다 아무것도 안 하는 쪽이 낫다.

// ⚠ `ultra`를 여기 넣지 마라. 이 목록은 **Claude Code frontmatter가 받는 값**이고
// `ultra`는 Codex 캐시에만 있는 effort다(2026-09-30 실측). 설정 파일이 받는 값은
// config-schema.js의 `isEffort`이고 그쪽에는 `ultra`가 있다 — **두 목록이 갈린 것이 맞다.**
// 합치면 Codex effort가 applyModel을 타고 CC frontmatter로 새어 에이전트가 망가진다(B18).
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

/** `low|medium|high|xhigh|max` 또는 **양의 정수**(CC 2.1.278의 허용값 그대로) */
function validateEffort(v) {
  if (typeof v === 'string') return EFFORTS.includes(v);
  return Number.isInteger(v) && v > 0;
}

/**
 * 모델 이름은 **형태만** 본다 — 이름을 열거하면 그 목록이 낡아 새 모델을 쓰려는 사용자를
 * 막는다(rules-sync.js:10-13이 경계한 것과 같은 실패). `inherit`은 거부한다: 세션 모델을
 * 물려받으면 "계획은 최고 모델로"라는 이 설정의 목적 자체가 사라진다.
 */
function validateModel(v) {
  return typeof v === 'string' && v.trim().length > 0 && !/\s/.test(v) && v.trim() !== 'inherit';
}

/** 문서 앞머리의 `---` ~ `---` 구간. 없으면 `null` */
function frontmatterRange(md) {
  if (typeof md !== 'string' || !md.startsWith('---')) return null;
  const end = md.indexOf('\n---', 3);
  if (end < 0) return null;
  return { start: 0, end: end + 1 };
}

const LINE = (key) => new RegExp(`^${key}:[ \\t]*(\\S.*?)[ \\t]*$`, 'm');

/**
 * frontmatter의 `model`·`effort`.
 * @returns {{model:string, effort:string}|null} 둘 중 하나라도 없으면 `null`
 */
function readModel(md) {
  const fm = frontmatterRange(md);
  if (!fm) return null;
  const head = md.slice(fm.start, fm.end);
  const model = LINE('model').exec(head);
  const effort = LINE('effort').exec(head);
  if (!model || !effort) return null;
  return { model: model[1], effort: effort[1] };
}

/**
 * `model`·`effort` **두 줄만** 교체한다. 본문·tools·description은 한 글자도 안 바뀐다.
 *
 * 줄을 추가하지 않는 이유: 없다는 것은 이 파일이 예상한 형태가 아니라는 뜻이고, 그런 파일에
 * 줄을 끼워 넣으면 어디가 깨질지 모른다. 실패를 돌려주고 호출자가 건너뛰게 한다.
 *
 * @param want {{model:string, effort:string|number}}
 * @returns {{ok:true, text:string} | {ok:false, reason:string}}
 *   실패 시 **`text`를 주지 않는다** — 호출자가 잘못된 값을 파일에 쓸 방법이 없어야 한다.
 */
function applyModel(md, want) {
  if (!want || typeof want !== 'object') return { ok: false, reason: 'model·effort를 받지 못했다' };
  if (!validateModel(want.model)) return { ok: false, reason: `model 값이 올바르지 않다: ${JSON.stringify(want.model)}` };
  if (!validateEffort(want.effort)) {
    return { ok: false, reason: `effort 값이 올바르지 않다: ${JSON.stringify(want.effort)} (허용: ${EFFORTS.join('|')} 또는 양의 정수)` };
  }
  const fm = frontmatterRange(md);
  if (!fm) return { ok: false, reason: 'frontmatter를 찾지 못했다' };

  let head = md.slice(fm.start, fm.end);
  if (!LINE('model').test(head) || !LINE('effort').test(head)) {
    return { ok: false, reason: 'model 또는 effort 줄이 없다 — 줄을 추가하지 않는다' };
  }
  // ⚠ **치환 문자열이 아니라 함수 replacer를 쓴다.** 치환 문자열에서 `$&`·`` $` ``·`$1`은
  // 특수 패턴으로 해석되는데, `model` 값은 사용자가 설정 파일에 적는다. 실측(리뷰 1회차):
  // `model:'$&'` → `model: model: fable`, `` model:'$`' `` → `model: ---`(frontmatter 파손).
  // 이 모듈의 존재 이유가 "파싱이 어긋나면 에이전트가 망가진다"인데 그걸 스스로 깨던 자리다.
  head = head.replace(LINE('model'), () => `model: ${want.model}`);
  head = head.replace(LINE('effort'), () => `effort: ${want.effort}`);
  return { ok: true, text: head + md.slice(fm.end) };
}

/**
 * 설정과 실물이 어긋났는가 — 어긋났다면 **플러그인 업데이트로 설정이 풀린 것**이다.
 *
 * ⚠ 읽지 못한 에이전트(`null`)는 드리프트로 보고하지 않는다. 못 읽은 것과 값이 다른 것은
 * 다르고, 못 읽은 것을 "풀렸다"고 하면 설치 경로가 다른 환경에서 매 세션 거짓 경고가 뜬다.
 * @param current `{[agent]: {model,effort}|null}` — 지금 파일들이 들고 있는 값
 * @returns 일치하면 `''`(완전 침묵). 무시 학습을 만들지 않는 것이 이 함수의 절반이다.
 */
function modelDriftMessage(cfg, current) {
  if (!cfg || !cfg.models || !current) return '';
  const off = [];
  for (const [name, want] of Object.entries(cfg.models)) {
    // ⚠ Codex 단계는 **frontmatter로 표현되지 않는다.** 안 빼면 Codex로 돌리는
    // 에이전트마다 매 세션 거짓 경고가 뜨고, 그게 이 함수의 존재 이유(무시 학습 방지)를
    // 스스로 깬다. 그 에이전트의 frontmatter는 **Claude 폴백 정의**로서 의미를 유지한다.
    if (want?.cli === 'codex') continue;
    const got = current[name];
    if (!got) continue;
    if (String(got.model) !== String(want.model) || String(got.effort) !== String(want.effort)) off.push(name);
  }
  if (!off.length) return '';
  return [
    '',
    `⚠ 에이전트 모델 설정이 풀렸다 (${off.join(' · ')}) — 플러그인 업데이트가 frontmatter를 되돌렸을 수 있다.`,
    '  다시 걸기: `/kit setup --reapply`  ·  지금 값이 맞으면 `/kit setup`으로 설정을 갱신한다.',
  ].join('\n');
}

module.exports = { EFFORTS, readModel, applyModel, validateEffort, validateModel, modelDriftMessage };
