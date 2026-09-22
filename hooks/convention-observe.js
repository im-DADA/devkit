#!/usr/bin/env node
// PostToolUse(Write|Edit): 편집된 파일의 규칙 위반을 찾아 **그 자리에서 Claude에게 알린다**(차단 없음, exit 0).
//
// 왜 알리나(2026-09-17): 예전엔 audit에 기록만 해서 Claude는 몰랐다. HumanLayer "LLM에게 린터 일을
// 시키지 마라" — 그런데 린터는 **레포 안** 설정이라 레포 밖에서 도는 devkit(전역)의 수단이 아니고,
// 실측한 프로젝트 7개 전부 eslint에 해당 규칙이 없었다. 그래서 devkit 안에서 기계가 잡는다.
//
// ⚠ 소음이 이 기능을 죽인다. 기존 레포의 옛 `any`가 편집할 때마다 반복 경고되면 무시 학습이 생긴다.
//   - Edit은 **이번에 넣은 문자열(new_string)** 안의 위반만 알린다.
//   - 200줄은 **이번 편집으로 넘어섰을 때만** 알린다.
//   - 도구를 알 수 없으면(Write·Edit 아님) 알리지 않고 기록만 한다.
// audit 기록은 예전처럼 파일 전체 기준이다 — `/kit audit` 집계 의미를 바꾸지 않는다.
const fs = require('node:fs');
const path = require('node:path');
const { record } = require('./lib/audit');
const { loadConfig } = require('./lib/config');

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return null; }
}

const input = readInput();
const ti = input?.tool_input;
const file = ti?.file_path;
if (!file || !/\.(ts|tsx|js|jsx)$/.test(file)) process.exit(0);

let src;
try { src = fs.readFileSync(file, 'utf8'); } catch { process.exit(0); } // 파일 없으면 관측 스킵(비차단)

const isTsx = /\.(tsx|jsx)$/.test(file);
const cfg = loadConfig();
// 0이면 줄 수 경고를 끈다(설정 스키마가 음수를 막으므로 여기서 다시 막지 않는다)
const MAX_LINES = cfg.rules.maxLines;

// `key`는 설정 스위치의 이름이다. 규칙을 추가할 때 key를 빼먹으면 `cfg.rules[undefined]`가
// undefined라 **끌 수 없는 규칙**이 되므로, 새 규칙에는 반드시 key를 준다.
const RULES = [
  // 꺾쇠 형태를 `\s*`로 풀어 쓰는 이유: 꺾쇠 안에 any를 붙여 쓰면 이 정의 줄 자체가 위반으로 잡힌다(실측).
  { key: 'noAny', rule: 'no-any', label: '`any` (→ `unknown` + 좁히기)', re: /:\s*any\b|as\s+any\b|<\s*any\s*>/ },
  { key: 'noConsoleLog', rule: 'no-console-log', label: '`console.log` (커밋 전 제거)', re: /console\.log\s*\(/ },
  { key: 'noEmptyCatch', rule: 'empty-catch', label: '빈 catch — 에러 삼키기 (→ throw·전파)', re: /\bcatch\s*(\([^)]*\))?\s*\{\s*\}/ },
  { key: 'tsxLogic', rule: 'tsx-side-effect', label: '.tsx 안 useEffect 등 (→ 커스텀 훅 .ts로)', re: /\buse(Effect|LayoutEffect|Reducer)\s*\(/, tsxOnly: true },
  { key: 'tsxLogic', rule: 'tsx-fetch', label: '.tsx 안 fetch (→ api .ts로)', re: /\bfetch\s*\(/, tsxOnly: true },
];

// 주석·문자열을 지운 뒤 대조한다. 기록만 하던 때는 오탐이 감사 로그에 남고 끝났지만, 지금은
// "지금 고친다"와 함께 Claude에게 가므로 **주석을 고치러 간다**(리뷰 실측: `// any 타입이 아니다`,
// `"예시: any 값"`, `/catch {}/` 3건 오탐). 파서를 쓰지 않는 이상 완벽하지 않으므로, 틀리는 방향을
// 미탐 쪽에 둔다 — 놓친 위반은 Stop 훅의 lint·리뷰가 다시 잡지만, 오탐은 멀쩡한 코드를 망친다.
function stripNoise(line) {
  return line
    .replace(/\\['"`]/g, '')                       // 이스케이프된 따옴표가 짝을 깨지 않게
    .replace(/(['"`])(?:(?!\1).)*\1/g, '$1$1')     // 문자열 리터럴 비우기
    .replace(/\/(?![/*])(?:\\.|[^/\n])+\//g, '//') // 정규식 리터럴 비우기(나눗셈은 //로 남아 무해)
    .replace(/\/\/.*$/, '')                        // 줄 주석
    .replace(/\/\*.*?\*\//g, '');                  // 한 줄 안의 블록 주석
}

/** text의 각 줄을 규칙에 대조한다. startLine은 파일 기준 첫 줄 번호, 모르면 null */
function scan(text, startLine) {
  const out = [];
  text.split('\n').forEach((raw, i) => {
    const ln = stripNoise(raw);
    for (const r of RULES) {
      if (r.tsxOnly && !isTsx) continue;
      if (cfg.rules[r.key] === false) continue; // 설정으로 끈 규칙
      if (r.re.test(ln)) out.push({ rule: r.rule, line: startLine === null ? null : startLine + i });
    }
  });
  return out;
}

const countNewlines = (s) => (typeof s === 'string' ? (s.match(/\n/g) || []).length : 0);
// 끝 개행을 한 줄로 세면 정확히 200줄인 파일이 "201줄"로 경고된다(리뷰 실측)
const countLines = (s) => { const a = s.split('\n'); if (a[a.length - 1] === '') a.pop(); return a.length; };
const afterLines = countLines(src);

// ── 기록(파일 전체) — 예전과 같은 의미 ──
const findings = scan(src, 1);
if (MAX_LINES > 0 && afterLines > MAX_LINES) findings.push({ rule: 'file-too-long', line: afterLines });

// ── 알림(이번 편집이 넣은 것만) ──
let notify = [];
if (input?.tool_name === 'Edit' && typeof ti.new_string === 'string') {
  const at = src.indexOf(ti.new_string);
  // 포매터가 끼어들어 원문이 안 보이면 줄 번호는 모르지만 위반 자체는 알린다
  const startLine = at < 0 ? null : countNewlines(src.slice(0, at)) + 1;
  notify = scan(ti.new_string, startLine);
  const beforeLines = afterLines - (countNewlines(ti.new_string) - countNewlines(ti.old_string));
  if (MAX_LINES > 0 && beforeLines <= MAX_LINES && afterLines > MAX_LINES) notify.push({ rule: 'file-too-long', line: afterLines });
} else if (input?.tool_name === 'Write') {
  notify = scan(src, 1);
  if (MAX_LINES > 0 && afterLines > MAX_LINES) notify.push({ rule: 'file-too-long', line: afterLines });
}

// ── 넛지: 순수로직 파일인데 대응 테스트가 없으면 리마인드 ──
// 대상: .ts(.tsx 제외), 테스트/타입/설정 파일 아님, utils·validation·format·helpers·lib 등 로직 위치,
//       export된 함수가 있음. 옆에 같은 이름의 *.test.* / *.spec.* 없으면 넛지.
function needsTestNudge() {
  if (!cfg.rules.testNudge) return false;
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

if (notify.length) {
  const LABEL = Object.fromEntries(RULES.map((r) => [r.rule, r.label]));
  LABEL['file-too-long'] = `${MAX_LINES}줄 초과 — 현재 ${afterLines}줄 (→ 분리)`;
  const byRule = new Map();
  for (const f of notify) byRule.set(f.rule, [...(byRule.get(f.rule) || []), f.line]);
  const MAX_ROWS = 6;
  const MAX_LINES_SHOWN = 8;
  const rows = [...byRule].map(([rule, ls]) => {
    // 줄 번호도 잘라야 한다 — console.log 300개짜리 파일이 1,700자를 한 번에 주입했다(리뷰 실측)
    const shownLines = ls.slice(0, MAX_LINES_SHOWN).map((l) => (l === null ? 'L?' : `L${l}`));
    if (ls.length > MAX_LINES_SHOWN) shownLines.push(`외 ${ls.length - MAX_LINES_SHOWN}곳`);
    const where = rule === 'file-too-long' ? '' : ` ${shownLines.join(', ')}`;
    return `- ${LABEL[rule]}${where}`;
  });
  const shown = rows.slice(0, MAX_ROWS);
  if (rows.length > MAX_ROWS) shown.push(`- …외 ${rows.length - MAX_ROWS}종`);
  const context = [
    `[devkit] 방금 편집한 ${path.basename(file)}에 규칙 위반 — 차단은 아니지만 지금 고친다:`,
    ...shown,
  ].join('\n');
  // 출력은 writeSync — stdout.write 직후 exit하면 macOS 파이프에서 JSON이 잘릴 수 있다(decision.js와 같은 이유)
  fs.writeSync(1, JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context } }));
}
process.exit(0);
