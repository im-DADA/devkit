// 보호 파일 패턴 — protected-file(Write/Edit)과 bash-guard(리다이렉트) 양쪽에서 공유.
const PROTECTED = [
  { re: /(^|\/)\.env(\.[\w.-]+)?$/, why: '.env (시크릿)' },
  { re: /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/, why: 'lockfile (패키지 매니저가 관리)' },
  { re: /(^|\/)\.git\//, why: '.git 내부' },
  { re: /(^|\/)node_modules\//, why: 'node_modules (생성물)' },
];

function matchProtected(file) {
  if (!file || typeof file !== 'string') return null;
  return PROTECTED.find((p) => p.re.test(file)) || null;
}

module.exports = { PROTECTED, matchProtected };
