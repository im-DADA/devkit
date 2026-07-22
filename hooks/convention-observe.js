#!/usr/bin/env node
// PostToolUse(Write|Edit): 편집된 파일의 규칙 위반을 "차단 없이 관측만" → .devkit/audit.jsonl.
// 목적: 가드가 못 막고 통과한 위반(lint 미설치 레포 포함)을 가시화. exit 0 고정.
// 넛지(test-missing)만 stderr로 조용히 리마인드해 AI가 후속 조치하도록. 나머지는 audit 기록만.
const fs = require('node:fs');
const path = require('node:path');
const { record } = require('./lib/audit');

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return null; }
}

const file = readInput()?.tool_input?.file_path;
if (!file || !/\.(ts|tsx|js|jsx)$/.test(file)) process.exit(0);

let src;
try { src = fs.readFileSync(file, 'utf8'); } catch { process.exit(0); } // 파일 없으면 관측 스킵(비차단)

const lines = src.split('\n');
const isTsx = /\.(tsx|jsx)$/.test(file);
const findings = [];

lines.forEach((ln, i) => {
  const n = i + 1;
  if (/:\s*any\b|as\s+any\b|<any>/.test(ln)) findings.push({ rule: 'no-any', line: n });
  if (/console\.log\s*\(/.test(ln)) findings.push({ rule: 'no-console-log', line: n });
  if (isTsx && /\buse(Effect|LayoutEffect|Reducer)\s*\(/.test(ln)) findings.push({ rule: 'tsx-side-effect', line: n });
  if (isTsx && /\bfetch\s*\(/.test(ln)) findings.push({ rule: 'tsx-fetch', line: n });
});
if (lines.length > 200) findings.push({ rule: 'file-too-long', line: lines.length });

// ── 넛지: 순수로직 파일인데 대응 테스트가 없으면 리마인드 ──
// 대상: .ts(.tsx 제외), 테스트/타입/설정 파일 아님, utils·validation·format·helpers·lib 등 로직 위치,
//       export된 함수가 있음. 옆에 같은 이름의 *.test.* / *.spec.* 없으면 넛지.
function needsTestNudge() {
  if (isTsx || !/\.(ts|js)$/.test(file)) return false;
  const base = path.basename(file);
  if (/\.(test|spec)\./.test(base)) return false;         // 테스트 파일 자체
  if (/\.d\.ts$/.test(base)) return false;                // 타입 선언
  if (/(config|types?|schema|route|index)\.(ts|js)$/.test(base)) return false; // 설정/타입/라우트/배럴
  const looksLogic = /(utils?|helpers?|lib|validation|valid|format|calc|parse|transform)/i.test(file);
  if (!looksLogic) return false;
  const hasExportedFn = /export\s+(default\s+)?(async\s+)?function\s+\w/.test(src)
    || /export\s+const\s+\w+\s*=\s*(async\s*)?\(/.test(src);
  if (!hasExportedFn) return false;
  // 대응 테스트 존재 여부
  const dir = path.dirname(file);
  const stem = base.replace(/\.(ts|js)$/, '');
  const candidates = [
    path.join(dir, `${stem}.test.ts`), path.join(dir, `${stem}.test.js`),
    path.join(dir, `${stem}.spec.ts`), path.join(dir, `${stem}.spec.js`),
    path.join(dir, '__tests__', `${stem}.test.ts`), path.join(dir, '__tests__', `${stem}.test.js`),
  ];
  return !candidates.some((p) => fs.existsSync(p));
}

if (needsTestNudge()) {
  findings.push({ rule: 'test-missing', line: 1 });
  process.stderr.write(
    `[devkit] 넛지: 순수로직 파일 ${path.basename(file)} 에 대응 테스트가 없다. ` +
    `입출력이 명확한 로직은 테스트를 남길 것 — 러너 없으면 node:test(무설치)로라도. (차단 아님)\n`
  );
}

if (findings.length) {
  record({ hook: 'convention-observe', action: 'warn', file, findings });
}
process.exit(0);
