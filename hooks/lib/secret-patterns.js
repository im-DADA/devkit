// 시크릿 탐지 패턴. 세 등급:
//   HIGH    — 오탐이 거의 없는 명백한 키 → 편집 차단.
//   SUSPECT — 오탐 가능(JWT·generic credential) → 차단하지 않고 관측(warn)만.
//   MASK_ONLY — 로그에서 가리기만 한다. **차단하지 않는다.**
const HIGH = [
  { re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/, why: 'private key' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, why: 'AWS access key id' },
  { re: /\bghp_[A-Za-z0-9]{36}\b/, why: 'GitHub personal token' },
  { re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/, why: 'GitHub fine-grained token' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, why: 'Slack token' },
  { re: /\bsk_live_[A-Za-z0-9]{20,}\b/, why: 'Stripe live key' },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/, why: 'Google API key' },
  // 실측: 감사 로그에 살아있는 Anthropic 키가 평문으로 남아 있었다(salesflow).
  // 접두가 길고 본문이 80자 이상이라 오탐 여지가 거의 없다 → HIGH.
  { re: /\bsk-ant-[A-Za-z0-9_-]{24,}/, why: 'Anthropic API key' },
];
const SUSPECT = [
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\b/, why: 'JWT-like token' },
  { re: /(?:api[_-]?key|secret|passwd|password|access[_-]?token)\s*[:=]\s*['"][^'"\s]{12,}['"]/i, why: 'hardcoded credential' },
];

// 로그에서 가리기만 하는 패턴 — **HIGH에 넣으면 안 된다.**
// DB URL은 `postgresql://pop:pop@localhost`처럼 테스트 픽스처·docker-compose에 정상적으로
// 들어가므로, 차단 등급에 올리면 그런 파일 작성이 통째로 막힌다(실사용에서 .env.test가 그랬다).
// 로그에 남는 건 막아야 하지만 쓰는 건 막을 이유가 없다 — 그래서 등급을 나눈다.
//
// ⚠ 매치가 **비밀번호 부분만**이도록 전후방탐색을 쓴다. URL 전체를 지우면 어느 DB에
// 붙다 실패했는지가 사라져 로그가 디버깅에 못 쓰이게 된다.
const MASK_ONLY = [
  { re: /(?<=:\/\/[^:@\s/]{1,64}:)[^@\s/]{1,256}(?=@)/, why: 'db password' },
];

const scan = (list, text) => (typeof text === 'string' ? list.filter((p) => p.re.test(text)).map((p) => p.why) : []);
const scanHigh = (text) => scan(HIGH, text);
const scanSuspect = (text) => scan(SUSPECT, text);

module.exports = { HIGH, SUSPECT, MASK_ONLY, scanHigh, scanSuspect };
