// 보호 파일 패턴 — protected-file(Write/Edit)과 bash-guard(리다이렉트) 양쪽에서 공유.
//
// ⚠ `.env`는 `overwriteOnly`다. Read는 애초에 훅이 안 보므로(matcher가 Write|Edit) 이 규칙이
// 지키는 건 유출이 아니라 **소실**이다 — .env는 gitignore라 통째로 날리면 복구가 안 된다.
// 부분 수정(Edit)·추가(`>>`)는 소실을 만들 수 없으니 막을 이유가 없고, 막아 두면 값 하나
// 고치는 실사용까지 전부 걸려 사용자가 직접 하게 된다(그게 지금 상태였다).
// ⚠ `.env.example`·`.env.sample`·`.env.template`·`.env.dist`는 뺀다. 값이 없는 **커밋되는
// 템플릿**이라 소실될 시크릿이 애초에 없고, 막아 두면 플레이스홀더 한 줄 고치는 것까지
// 걸린다(실측: 21개 프로젝트 감사에서 `.env.example` 차단 2건).
// 부정 전방탐색이 `[\w.-]*`로 시작하는 이유는 `.env.local.example`처럼 **마지막** 접미사가
// 템플릿인 경우를 잡기 위해서다.
const ENV_TEMPLATE = String.raw`(?![\w.-]*\.(example|sample|template|dist)$)`;

const PROTECTED = [
  { re: new RegExp(String.raw`(^|/)\.env${ENV_TEMPLATE}(\.[\w.-]+)?$`), why: '.env (시크릿)', overwriteOnly: true },
  { re: /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/, why: 'lockfile (패키지 매니저가 관리)' },
  { re: /(^|\/)\.git\//, why: '.git 내부' },
  { re: /(^|\/)node_modules\//, why: 'node_modules (생성물)' },
];

function matchProtected(file) {
  if (!file || typeof file !== 'string') return null;
  return PROTECTED.find((p) => p.re.test(file)) || null;
}

/**
 * 이 쓰기를 막아야 하는가. 순수 — fs를 보지 않는다(존재 여부 판단은 호출자 몫).
 * @param {string} file
 * @param {{overwrite:boolean}} how overwrite=true면 파일 내용을 통째로 대체한다
 * @returns {{re:RegExp, why:string}|null}
 */
function blockedFor(file, how) {
  const hit = matchProtected(file);
  if (!hit) return null;
  if (hit.overwriteOnly && !(how && how.overwrite)) return null;
  return hit;
}

module.exports = { PROTECTED, matchProtected, blockedFor };
