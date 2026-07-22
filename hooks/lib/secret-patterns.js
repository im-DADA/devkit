// 시크릿 탐지 패턴. 두 등급:
//   HIGH  — 오탐이 거의 없는 명백한 키 → 편집 차단.
//   SUSPECT — 오탐 가능(JWT·generic credential) → 차단하지 않고 관측(warn)만.
const HIGH = [
  { re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/, why: 'private key' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, why: 'AWS access key id' },
  { re: /\bghp_[A-Za-z0-9]{36}\b/, why: 'GitHub personal token' },
  { re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/, why: 'GitHub fine-grained token' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, why: 'Slack token' },
  { re: /\bsk_live_[A-Za-z0-9]{20,}\b/, why: 'Stripe live key' },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/, why: 'Google API key' },
];
const SUSPECT = [
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\b/, why: 'JWT-like token' },
  { re: /(?:api[_-]?key|secret|passwd|password|access[_-]?token)\s*[:=]\s*['"][^'"\s]{12,}['"]/i, why: 'hardcoded credential' },
];

const scan = (list, text) => (typeof text === 'string' ? list.filter((p) => p.re.test(text)).map((p) => p.why) : []);
const scanHigh = (text) => scan(HIGH, text);
const scanSuspect = (text) => scan(SUSPECT, text);

module.exports = { HIGH, SUSPECT, scanHigh, scanSuspect };
