#!/usr/bin/env node
// PostToolUse(Write|Edit): .ts/.tsx 편집 직후 타입체크 (비차단, 진단만 표면화).
// 기본 OFF — 매 편집마다 tsc는 느릴 수 있어 opt-in. 켜려면: export DEVKIT_TSC_ON_EDIT=1
//
// 실행·판정은 lib/verify-runner.js 계약이 한다. 예전엔 이 파일이 직접 tsc를 돌리고
// 출력 앞 15줄을 그냥 찍었는데, 그러면 (a) 설정 오류를 타입 에러로 보고하고
// (b) stop-verify와 판정이 갈라진다. 지금은 같은 계약을 쓴다(B15).
const fs = require('node:fs');
const path = require('node:path');
const { warn } = require('./lib/diag');
const { runVerification } = require('./lib/verify-runner');

const OFF = ['off', '0', 'false', 'no'];
// 상위 스위치가 꺼져 있으면 하위도 꺼진다 — "다 껐는데 하나가 계속 돈다"가 없어야 한다
const verifyOff = OFF.includes(String(process.env.DEVKIT_VERIFY ?? '').trim().toLowerCase());
if (verifyOff || process.env.DEVKIT_TSC_ON_EDIT !== '1') process.exit(0);

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return null; }
}

function findUp(startDir, name) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, name))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const file = readInput()?.tool_input?.file_path;
if (!file || !/\.(ts|tsx)$/.test(file)) process.exit(0);

const root = findUp(path.dirname(file), 'package.json');
if (!root) process.exit(0);

try {
  const { status, diagnostics, meta } = runVerification(root, { kind: 'typecheck', timeoutMs: 25000 });
  if (status === 'found') {
    process.stdout.write(`[devkit] 타입 진단 ${meta.totalDiagnostics}건:\n${diagnostics}\n`);
  } else if (status === 'unavailable') {
    // 구버전은 스크립트 없이도 tsc를 직접 돌렸다. 지금은 계약이 스크립트를 요구하므로
    // 그 조건에서 침묵하면 훅을 켠 사용자에게 아무 신호 없이 죽는 회귀가 된다.
    warn(`typecheck skipped (${meta.reason}) — add a typecheck script or unset DEVKIT_TSC_ON_EDIT`);
  } else if (status === 'failed') {
    // 편집 훅에서 실행 실패를 진단처럼 찍으면 사용자가 자기 코드를 고치려 든다.
    // 컨텍스트가 아니라 stderr로 보낸다 — 원인은 남기되 진단으로 오인되지 않게.
    warn(`typecheck could not run (${meta.reason}): ${diagnostics.split('\n')[0] || ''}`);
  }
} catch (e) {
  warn(`tsc-on-edit failed: ${e.message}`);
}
process.exit(0);
