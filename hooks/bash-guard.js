#!/usr/bin/env node
// PreToolUse(Bash): 위험 명령 감시. 되돌릴 수 없으면 차단(exit 2), 사고는 아니지만 확인이 필요하면
// 사용자 확인 창(ask). 한 명령에 둘이 섞이면 차단이 이긴다.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { record } = require('./lib/audit');
const { blockedFor } = require('./lib/protected-patterns');
const { deny, ask } = require('./lib/decision');

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return null; }
}

const rawCmd = readInput()?.tool_input?.command;
if (!rawCmd || typeof rawCmd !== 'string') process.exit(0);

// 우회 방지: 백슬래시-개행 이음, 다중 공백 정규화 후 검사(heredoc/줄바꿈으로 패턴 쪼개기 완화).
const cmd = rawCmd.replace(/\\\r?\n/g, ' ').replace(/[ \t]+/g, ' ');

// rm -rf: 위험 경로(/, ~, $HOME, *, /*)를 타겟할 때만 차단. 상대경로(./dist 등)는 허용.
function dangerousRm(c) {
  const calls = c.split(/[;\n]|&&|\|\|/).filter((s) => /\brm\b/.test(s));
  for (const call of calls) {
    const recursive = /\brm\b.*\s-\S*r/i.test(call) || /\brm\b.*\s-r\b/i.test(call);
    const force = /\brm\b.*\s-\S*f/i.test(call) || /\brm\b.*\s-f\b/i.test(call);
    if (!(recursive && force)) continue;
    const targets = call.replace(/^.*?\brm\b/, '').split(/\s+/).filter((t) => t && !t.startsWith('-'));
    for (const t of targets) {
      if (/^\/$|^\/\w*$|^~\/?$|^\$HOME\/?$|^\*$|^~\/\*$|^\/\*/.test(t)) return true;
    }
  }
  return false;
}

const PATTERNS = [
  // ⚠ `--force-with-lease`는 뺀다. 그건 원격에 남의 커밋이 새로 생겼으면 **실패하는**
  // 안전한 변형이고, `--force`가 파괴적인 이유(남의 작업을 말없이 덮어씀)가 성립하지 않는다.
  // `\b`만 쓰면 `--force-with-lease`의 하이픈이 경계라서 같이 걸린다(실사용 4건 확인).
  // ⚠ 플래그는 **push 자기 명령 안에서만** 찾는다 — 줄바꿈·`;`·`|`·`&&`에서 멈춘다. 예전 `[^;]*`는
  // 그걸 넘어가 `git push origin main` 뒤에 붙은 `rm -f /tmp/…`의 `-f`를 push 플래그로 읽었다(실측).
  // 단일 `&`는 멈추지 않는다: `2>&1` 뒤에 붙은 `-f`도 같은 명령이라 잡아야 한다(틀리는 방향이 차단 쪽).
  { re: /\bgit\s+push\b(?:(?!&&)[^;|\n])*\s(--force(?!-with-lease\b)|-f)\b/i, why: 'git push --force' },
  { re: /\bgit\s+reset\s+--hard\b/i, why: 'git reset --hard' },
  { re: /\bgit\s+clean\s+-\S*f/i, why: 'git clean -f (추적 안 된 파일 삭제)' },
  { re: /\b(mkfs\S*|dd)\b[^;]*\bof=\/dev\//i, why: '디스크 직접 쓰기' },
  { re: />\s*\/dev\/sd[a-z]/i, why: '블록 디바이스 덮어쓰기' },
  // 권한을 되돌리기는 번거롭지만 가능하다 → 막지 않고 확인받는다. 나머지는 decision 생략 = deny.
  { re: /\bchmod\s+-R\s+777\b/i, why: 'chmod -R 777', decision: 'ask' },
  { re: /\bcurl\b[^|]*\|\s*(sudo\s+)?(sh|bash)\b/i, why: 'curl | sh (원격 스크립트 실행)' },
  { re: /\bwget\b[^|]*\|\s*(sudo\s+)?(sh|bash)\b/i, why: 'wget | sh (원격 스크립트 실행)' },
  { re: /\bbase64\b\s+-\S*d[^|]*\|\s*(sh|bash)\b/i, why: 'base64 디코드 | sh (난독 실행)' },
  { re: /:\s*\(\)\s*\{[^}]*:\s*\|\s*:[^}]*\}\s*;/, why: 'fork bomb' },
];

// 리다이렉트/tee로 보호 파일(.env·lockfile·.git)에 쓰는 것 감시 (protected-file 훅의 Bash 우회 방지).
// 차단인지 확인 창인지는 protected-patterns의 `decision`을 그대로 따른다.
// ⚠ 자르기(`>`·`tee`)와 덧붙이기(`>>`·`tee -a`)를 가른다 — `.env`는 통째 대체만 막는다.
const REDIRECT = /(>>?|\btee\b(?:\s+-a\b)?)\s*([^\s;|&>]+)/g;

/**
 * 리다이렉트 대상의 **실제 경로**를 돌려준다. 확실히 못 정하면 `null`.
 *
 * `.env`는 소실만 막으므로(overwriteOnly) 파일이 없으면 `>`도 신규 생성이라 통과해야 한다.
 * 그러려면 존재를 봐야 하고, 존재를 보려면 경로가 정해져야 한다 — 그런데 훅은 명령이
 * **어느 cwd에서 돌지 모른다.** 그래서 정해지는 경우만 정하고 나머지는 포기한다.
 *
 * ⚠ 호출부는 `null`을 "파일이 있다"로 취급해야 한다(fail-closed). 틀리는 방향이
 *   소실 한쪽뿐이라, 모를 때 열면 가드가 무의미해진다.
 * @returns 절대경로, 또는 정할 수 없으면 `null`
 */
function resolveTarget(target, c) {
  if (/[$`*?]/.test(target)) return null;              // 셸 변수·글로브는 훅이 전개 못 한다
  if (target.startsWith('~/')) return path.join(os.homedir(), target.slice(2));
  if (path.isAbsolute(target)) return target;          // 위 둘은 cwd와 무관하게 정해진다
  if (/\b(cd|pushd|popd)\b/.test(c)) return null;      // 상대경로인데 cwd가 바뀐다
  return path.resolve(process.cwd(), target);
}

/** 명령 안의 모든 보호 파일 리다이렉트. 하나만 보고 끝내면 뒤쪽의 deny 대상을 놓친다 */
function redirectsToProtected(c) {
  const hits = [];
  for (const m of c.matchAll(REDIRECT)) {
    const append = m[1] === '>>' || /-a\b/.test(m[1]);
    const target = m[2].replace(/^["']|["']$/g, '');
    const resolved = resolveTarget(target, c);
    const exists = resolved === null ? true : fs.existsSync(resolved);
    // 없는 파일에 `>`는 소실이 아니라 생성이다. lockfile 등 overwriteOnly가 아닌 규칙은
    // blockedFor가 이 값과 무관하게 걸리므로 여기서 따로 가르지 않는다.
    const p = blockedFor(target, { overwrite: !append && exists });
    if (p) hits.push(p);
  }
  return hits;
}

// ⚠ 판정을 **전부 모은 뒤** deny → ask 순으로 고른다. 예전처럼 처음 찾은 하나로 끝내면
// `chmod -R 777 . && git reset --hard`가 확인 창 한 번으로 통과한다(공식 우선순위도 deny > ask).
const hits = [];
if (dangerousRm(cmd)) hits.push({ why: 'rm -rf (위험 경로)', decision: 'deny' });
for (const p of redirectsToProtected(cmd)) {
  hits.push({ why: `보호 파일에 리다이렉트 쓰기: ${p.why}`, decision: p.decision });
}
for (const p of PATTERNS) if (p.re.test(cmd)) hits.push({ why: p.why, decision: p.decision || 'deny' });

const denied = hits.find((h) => h.decision === 'deny');
if (denied) {
  record({ hook: 'bash-guard', action: 'blocked', reason: denied.why, command: rawCmd });
  deny(`[devkit] 위험 명령 차단: ${denied.why}\n대상: ${rawCmd}\n정말 필요하면 사용자가 직접 실행하세요.\n`);
}
const asked = hits.find((h) => h.decision === 'ask');
if (asked) {
  record({ hook: 'bash-guard', action: 'asked', reason: asked.why, command: rawCmd });
  ask(
    `[devkit] ${asked.why} — 실행할까요?\n${rawCmd}`,
    `[devkit] "${asked.why}"라 사용자 확인 창을 띄웠다. 거절되면 같은 효과를 내는 다른 명령으로 우회하지 마라.`,
  );
}
process.exit(0);
