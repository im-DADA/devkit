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
const { TIMEOUTS, SCRIPT_CANDIDATES, shouldNotify, clipDiagnostics } = require('./lib/verify-classify');
const { backstopMessage } = require('./lib/behaviors');
const { scopeFor } = require('./lib/verify-scope');
const { fingerprintOf, readBaseline, writeBaseline } = require('./lib/verify-baseline');
const { diffDiagnostics, formatDelta, attachHeaders } = require('./lib/verify-delta');

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

const backstop = backstopMessage(root);
if (backstop) problems.push(backstop);

// ── 검증 ──────────────────────────────────────────────────────────
const NOTICE = path.join(root, '.devkit', 'verify-notice.json');
const noticeKey = (input && input.session_id) || `day:${new Date().toISOString().slice(0, 10)}`;
let notice = null;
try { notice = JSON.parse(fs.readFileSync(NOTICE, 'utf8')); } catch { notice = null; }

const pending = [];

for (const kind of (isNodeProject ? kinds : [])) {
  // 층 3·2 — 볼 게 없으면 실행하지 않고, 볼 게 있으면 관심 집합을 받아둔다.
  // ⚠ 변경 목록이 비어도 run:true다(결정 12) — 깨진 커밋이 무검증으로 통과하면 안 된다.
  let scope;
  let r;
  try {
    scope = scopeFor(root, kind);
    if (!scope.run) continue; // 완전 침묵
    r = runVerification(root, { kind, timeoutMs: TIMEOUTS[kind] });
  } catch (e) {
    warn(`verify(${kind}) failed to run: ${e.message}`);
    continue;
  }
  const { status, diagnostics, items, meta } = r;
  if (status === 'skipped') continue;

  if (status === 'unavailable') {
    const decided = shouldNotify(notice, noticeKey, kind);
    notice = decided.nextState;
    if (decided.notify) {
      problems.push(
        meta.reason === 'runner-missing' || meta.reason === 'tool-missing'
          ? `### ${kind} 검증기를 실행할 수 없다 — 이 검증은 돌지 않는다\n`
            + `스크립트 \`${meta.script}\`는 있는데 실행에 실패했다(${meta.reason}). `
            + '의존성 설치(node_modules)나 PATH를 확인하라.\n'
            + '고칠 수 없으면 DEVKIT_VERIFY=off 로 끈다.'
          : `### ${kind} 스크립트를 찾지 못했다 — 이 검증은 돌지 않는다\n`
            + `package.json에서 찾는 이름: ${SCRIPT_CANDIDATES[kind].join(' · ')}\n`
            + '하나를 추가하거나, 이 검증이 필요 없으면 DEVKIT_VERIFY=off 로 끈다.',
      );
    }
  } else if (status === 'failed') {
    // 문구가 계약의 일부다 — 실행 실패를 "타입 에러"라고 절대 말하지 않는다.
    problems.push(
      `### 검증이 실행되지 못했다 — ${kind} (${meta.argv.join(' ')}, ${meta.reason})\n`
        + `${diagnostics}\n`
        + '※ 이건 코드의 결함이 아니다. 검증 환경/설정 문제이므로 에러 개수에 세지 마라.',
    );
  } else {
    // ok · found → delta. 기준선이 있으면 "새로 생긴 것"만, 없으면 blast radius로 좁힌다.
    const fp = fingerprintOf(root, meta, scope.branch);
    const prev = readBaseline(root, kind, fp);
    const decided = shouldNotify(prev && prev.notice, noticeKey, kind);
    const delta = diffDiagnostics(prev ? prev.keys : [], items, root, kind);

    let text = null;
    if (prev) {
      const raws = delta.newItems.map((i) => i.raw);
      const body = clipDiagnostics(
        kind === 'lint' ? attachHeaders(raws, items.map((i) => i.raw)) : raws,
      ).text;
      text = formatDelta(kind, delta, { firstTurn: decided.notify, body });
    } else if (items.length) {
      // 기준선 없음(세션 첫 턴·지형 변화 직후) → 그래프로 좁혀 보여준다.
      const inScope = scope.mode === 'all'
        ? items
        : items.filter((i) => !i.file || scope.files.has(String(i.file).replace(/\\/g, '/')));
      const shown = inScope.length ? inScope : items;
      text = `### ${kind} 진단 ${items.length}건\n${clipDiagnostics(shown.map((i) => i.raw)).text}`;
    }
    if (text) problems.push(text);

    // ⚠ ok·found에서만 기준선을 갱신한다(B21). failed 한 번에 기준선이 비워지면
    // 다음 턴에 전문이 쏟아진다. 쓰기는 stdout 뒤로 미룬다 — 훅이 죽으면 다시 말해야 한다.
    // ⚠ 공유 notice를 덮지 않는다. delta의 "세션 첫 턴" 판정은 **kind별로 baseline 안에**
    // 따로 산다 — 여기서 공유 상태에 쓰면 typecheck가 lint의 알림 이력을 지워
    // lint 알림이 매 턴 반복된다(실측으로 발견).
    pending.push({ kind, entry: { fp, at: new Date().toISOString(), notice: decided.nextState, keys: delta.curKeys, total: items.length } });
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
// 보고가 나간 **뒤에** 기준선을 갱신한다 — 순서가 뒤집히면 훅이 죽었을 때 그 진단이 영원히 침묵한다.
for (const p of pending) writeBaseline(root, p.kind, p.entry);
process.exit(0);
