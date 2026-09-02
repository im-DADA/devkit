#!/usr/bin/env node
// PreToolUse(Bash): 위험 명령 차단. 매칭되면 exit 2 (stderr에 사유) → 도구 실행 거부됨.
const fs = require('node:fs');
const { record } = require('./lib/audit');
const { blockedFor } = require('./lib/protected-patterns');

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
  { re: /\bgit\s+push\b[^;]*\s(--force(?!-with-lease\b)|-f)\b/i, why: 'git push --force' },
  { re: /\bgit\s+reset\s+--hard\b/i, why: 'git reset --hard' },
  { re: /\bgit\s+clean\s+-\S*f/i, why: 'git clean -f (추적 안 된 파일 삭제)' },
  { re: /\b(mkfs\S*|dd)\b[^;]*\bof=\/dev\//i, why: '디스크 직접 쓰기' },
  { re: />\s*\/dev\/sd[a-z]/i, why: '블록 디바이스 덮어쓰기' },
  { re: /\bchmod\s+-R\s+777\b/i, why: 'chmod -R 777' },
  { re: /\bcurl\b[^|]*\|\s*(sudo\s+)?(sh|bash)\b/i, why: 'curl | sh (원격 스크립트 실행)' },
  { re: /\bwget\b[^|]*\|\s*(sudo\s+)?(sh|bash)\b/i, why: 'wget | sh (원격 스크립트 실행)' },
  { re: /\bbase64\b\s+-\S*d[^|]*\|\s*(sh|bash)\b/i, why: 'base64 디코드 | sh (난독 실행)' },
  { re: /:\s*\(\)\s*\{[^}]*:\s*\|\s*:[^}]*\}\s*;/, why: 'fork bomb' },
];

// 리다이렉트/tee로 보호 파일(.env·lockfile·.git)에 쓰는 것 차단 (protected-file 훅의 Bash 우회 방지).
// ⚠ 자르기(`>`·`tee`)와 덧붙이기(`>>`·`tee -a`)를 가른다 — `.env`는 통째 대체만 막는다.
// 여기선 파일 존재를 확인하지 않는다(명령의 cwd를 모른다). `>` .env는 존재하면 소실이므로
// 항상 막고, 새로 만들 일이 있으면 Write가 통과시킨다.
const REDIRECT = /(>>?|\btee\b(?:\s+-a\b)?)\s*([^\s;|&>]+)/g;

function redirectToProtected(c) {
  for (const m of c.matchAll(REDIRECT)) {
    const append = m[1] === '>>' || /-a\b/.test(m[1]);
    const target = m[2].replace(/^["']|["']$/g, '');
    const p = blockedFor(target, { overwrite: !append });
    if (p) return p.why;
  }
  return null;
}

let hit = null;
if (dangerousRm(cmd)) hit = { why: 'rm -rf (위험 경로)' };
else {
  const redir = redirectToProtected(cmd);
  if (redir) hit = { why: `보호 파일에 리다이렉트 쓰기: ${redir}` };
  else hit = PATTERNS.find((p) => p.re.test(cmd)) || null;
}

if (hit) {
  record({ hook: 'bash-guard', action: 'blocked', reason: hit.why, command: rawCmd });
  process.stderr.write(
    `[devkit] 위험 명령 차단: ${hit.why}\n대상: ${rawCmd}\n정말 필요하면 사용자가 직접 실행하세요.\n`
  );
  process.exit(2);
}
process.exit(0);
