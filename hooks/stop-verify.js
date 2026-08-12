#!/usr/bin/env node
// Stop: 턴 종료 시 프로젝트 검증(typecheck·lint)을 1회 돌리고 결과를 컨텍스트로 표면화.
//
// ⚠ Stop 훅은 stdout이 그냥 디버그 로그로 간다 — 컨텍스트에 들어가는 건 UserPromptSubmit·
// UserPromptExpansion·SessionStart 세 이벤트뿐이다. 따라서 hookSpecificOutput JSON으로 내보낸다.
//
// 차단(decision:"block")은 쓰지 않는다: WIP 상태에서 턴이 막히면 사용자가 훅 자체를 꺼버려
// 효과가 0이 된다. 항상 켜져 있는 경고가 껐다 켜는 차단보다 실효가 크다.
//
// 실행·판정은 전부 lib/verify-runner.js 계약이 한다. 이 파일은 status별로 **무엇을 말할지**만
// 정한다 — 판정을 여기 다시 쓰면 tsc-on-edit과 조용히 갈라진다(B15).
// 설계: docs/2026-08-12-verification-runtime/DESIGN.md
const fs = require('node:fs');
const path = require('node:path');
const { record } = require('./lib/audit');
const { warn } = require('./lib/diag');
const { runVerification } = require('./lib/verify-runner');
const { TIMEOUTS, SCRIPT_CANDIDATES, shouldNotify } = require('./lib/verify-classify');

const KINDS = ['typecheck', 'lint'];
const ON = ['', 'on', '1', 'true', 'yes'];
const OFF = ['off', '0', 'false', 'no'];

/**
 * 상위 스위치 해석. **모르는 값은 켠다 + 경고** — 검증기의 실패는 "검증을 안 하는 것"이고
 * 그게 이 사이클이 죽이려는 침묵 no-op이다. (시크릿 유출이 걸린 bash-receipt는 반대로
 * 닫는 게 맞다. 각자 더 비싼 쪽을 피하는 방향으로 연다.)
 */
function enabledKinds(raw) {
  if (raw === undefined || raw === null) return { kinds: KINDS, unknown: null };
  const v = String(raw).trim().toLowerCase();
  if (ON.includes(v)) return { kinds: KINDS, unknown: null };
  if (OFF.includes(v)) return { kinds: [], unknown: null };
  const parts = v.split(',').map((s) => s.trim()).filter(Boolean);
  const picked = parts.filter((p) => KINDS.includes(p));
  if (picked.length && picked.length === parts.length) return { kinds: picked, unknown: null };
  return { kinds: KINDS, unknown: raw };
}

let input = null;
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  // stdin이 없거나 깨져도 검증 자체는 진행한다(훅이 대화를 막으면 안 됨)
}
// Stop 훅이 연속 차단하면 CC가 훅을 무시한다. 지금은 비차단이라 루프가 안 나지만,
// 재진입 시 검증을 반복할 이유가 없으므로 조기 종료한다.
if (input && input.stop_hook_active) process.exit(0);

const { kinds, unknown } = enabledKinds(process.env.DEVKIT_VERIFY);
if (unknown !== null) {
  warn(`DEVKIT_VERIFY="${unknown}" is not a recognized value — verification stays ON (off: 0|false|off|no)`);
}

function findPkg(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const pkgRoot = findPkg(process.cwd());
const root = pkgRoot || process.cwd();
const isNodeProject = pkgRoot !== null;
const problems = [];

// ── B9 백스톱: 구현 단계인데 behaviors.json이 없으면 경고 ──────────────
// D5 대응. behaviors.json은 /gap의 소비 입력이라 /gap·/report가 하드 게이트로 막지만,
// 그보다 이른 시점에 놓쳤음을 알려 되돌릴 여지를 준다. (강제 생성이 아니라 결핍 경고)
//
// ⚠ 백스톱은 침묵할 줄 알아야 산다. 실사용에서 두 번 헛짖었다 —
//   (1) status:done인 완료 사이클, (2) docs/archive/로 옮겨진 사이클.
// 완료한 작업에 "미완이다"를 띄우면 다음부터 이 경고 전체가 무시된다(무시 학습).
try {
  const { readState } = require('./lib/pdca-state');
  const { archiveAlt } = require('./lib/evidence');
  const state = readState(root);
  const pending = state && state.status !== 'done';
  if (pending && !state.foreign && ['do', 'gap', 'report'].includes(state.stage)) {
    const rel = `docs/${state.cycleId}/behaviors.json`;
    const alt = archiveAlt(rel); // /report가 옮긴 자리도 본다
    const found = [rel, alt].some((p) => p && fs.existsSync(path.join(root, p)));
    if (!found) {
      problems.push(
        `### behaviors.json 누락 (stage: ${state.stage})\n` +
          `구현 단계인데 \`docs/${state.cycleId}/behaviors.json\`이 없다. ` +
          `/plan의 behavior 목록 단계를 완료해 분모를 고정하라 — 없으면 /gap이 진행되지 않는다.`,
      );
    }
  }
} catch {
  // 상태 로드 실패는 무시(백스톱이 대화를 막지 않는다)
}

// ── 검증 ──────────────────────────────────────────────────────────
const NOTICE = path.join(root, '.devkit', 'verify-notice.json');
const noticeKey = (input && input.session_id) || `day:${new Date().toISOString().slice(0, 10)}`;
let notice = null;
try { notice = JSON.parse(fs.readFileSync(NOTICE, 'utf8')); } catch { notice = null; }

for (const kind of (isNodeProject ? kinds : [])) {
  let r;
  try {
    r = runVerification(root, { kind, timeoutMs: TIMEOUTS[kind] });
  } catch (e) {
    warn(`verify(${kind}) failed to run: ${e.message}`);
    continue;
  }
  const { status, diagnostics, meta } = r;
  if (status === 'ok' || status === 'skipped') continue; // 완전 침묵

  if (status === 'found') {
    problems.push(`### ${kind} 진단 ${meta.totalDiagnostics}건\n${diagnostics}`);
  } else if (status === 'failed') {
    // 문구가 계약의 일부다 — 실행 실패를 "타입 에러"라고 절대 말하지 않는다.
    problems.push(
      `### 검증이 실행되지 못했다 — ${kind} (${meta.argv.join(' ')}, ${meta.reason})\n` +
        `${diagnostics}\n` +
        '※ 이건 코드의 결함이 아니다. 검증 환경/설정 문제이므로 에러 개수에 세지 마라.',
    );
  } else if (status === 'unavailable') {
    // 침묵 no-op을 없애되 매 턴 반복하지 않는다 — 반복은 그 자체로 무시 학습이다.
    const decided = shouldNotify(notice, noticeKey, kind);
    notice = decided.nextState;
    if (decided.notify) {
      problems.push(
        meta.reason === 'runner-missing' || meta.reason === 'tool-missing'
          ? `### ${kind} 검증기를 실행할 수 없다 — 이 검증은 돌지 않는다\n` +
            `스크립트 \`${meta.script}\`는 있는데 실행에 실패했다(${meta.reason}). ` +
            '의존성 설치(node_modules)나 PATH를 확인하라.\n' +
            '고칠 수 없으면 DEVKIT_VERIFY=off 로 끈다.'
          : `### ${kind} 스크립트를 찾지 못했다 — 이 검증은 돌지 않는다\n` +
            `package.json에서 찾는 이름: ${SCRIPT_CANDIDATES[kind].join(' · ')}\n` +
            '하나를 추가하거나, 이 검증이 필요 없으면 DEVKIT_VERIFY=off 로 끈다.',
      );
    }
  }
  record({ hook: 'stop-verify', action: `verify-${status}`, kind, reason: meta.reason });
}

if (isNodeProject && kinds.length) try {
  fs.mkdirSync(path.dirname(NOTICE), { recursive: true });
  fs.writeFileSync(NOTICE, JSON.stringify(notice || { key: noticeKey, kinds: [] }));
} catch {
  // 알림 상태를 못 남기면 다음 턴에 한 번 더 말할 뿐이다 — 실행을 막을 이유가 아니다
}

if (problems.length) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'Stop',
        additionalContext: `[devkit] 종료 전 검증:\n\n${problems.join('\n\n')}`,
      },
    }),
  );
}
process.exit(0);
