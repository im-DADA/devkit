// 같은 패키지의 같은 kind가 동시에 두 번 돌지 않게 한다(B9·B10).
// 겹치면 안 되는 단위는 정확히 "같은 패키지의 같은 kind"다 — 모노레포에서 패키지 A·B의
// typecheck는 독립 실행이 정상이고, typecheck와 lint도 서로를 막을 이유가 없다.
//
// ⚠ 락은 **최적화이지 게이트가 아니다.** 락을 못 잡는 상황(권한·경로 없음)에서 검증을
// 건너뛰면 "검증이 안 도는데 조용한" 상태가 된다 — 이 사이클이 죽이려는 침묵 no-op이다.
// 그래서 실패 시 degraded로 통과시킨다.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HEADROOM_MS = 90000; // kind 실행 상한 + 여유. 폴백 재실행(최악 2회 실행)까지 덮는다

function lockPath(root, kind) {
  return path.join(root, '.devkit', `verify-${kind}.lock`);
}

function defaultIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true; // 살아 있음
  } catch (e) {
    return e.code === 'EPERM'; // 남의 소유지만 살아 있다. ESRCH만 죽음이다
  }
}

/**
 * 락이 버려진 것인가. **두 신호를 OR로** 본다 — 어느 하나만으로는 못 막는 실패가 있다.
 *  - PID만: PID는 재사용된다. SIGKILL 후 그 번호를 남이 차지하면 락이 영원히 살아 보인다.
 *  - mtime만: 죽은 락을 TTL만큼 기다린다. 그 사이 매 턴이 skipped(침묵)라 사용자는
 *    검증이 도는 줄 안다.
 * host가 다르면 PID 검사를 건너뛴다 — 남의 PID 공간을 우리 것처럼 읽지 않는다.
 */
function isStale(payload, now, { ttlMs, hostname, mtimeMs, isAlive = defaultIsAlive }) {
  const valid = payload && typeof payload === 'object' && Number.isInteger(payload.pid);
  if (!valid) return true; // 읽을 수 없는 락에 영원히 막히지 않는다
  if (now - mtimeMs > ttlMs) return true;
  if (payload.host !== hostname) return false; // 나이만 봤고 아직 신선하다
  return !isAlive(payload.pid);
}

/**
 * @returns {{ok:boolean, reason?:string, path:string, degraded?:boolean, pid:number}}
 */
function acquire(root, kind, opts = {}) {
  const p = lockPath(root, kind);
  const ttlMs = (opts.ttlMs || 0) + HEADROOM_MS;
  const payload = JSON.stringify({
    pid: process.pid, host: os.hostname(), kind, startedAt: new Date().toISOString(),
  });

  const write = () => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, payload, { flag: 'wx' }); // 존재하면 실패하는 원자적 생성
  };

  try {
    write();
    return { ok: true, path: p, pid: process.pid };
  } catch (e) {
    if (e.code !== 'EEXIST') return { ok: true, path: p, pid: process.pid, degraded: true };
  }

  // 이미 있다 — 버려진 락인지 본다
  let held = null;
  let mtimeMs = 0;
  try {
    held = JSON.parse(fs.readFileSync(p, 'utf8'));
    mtimeMs = fs.statSync(p).mtimeMs;
  } catch {
    mtimeMs = 0; // 못 읽으면 isStale이 stale로 판정한다
  }
  if (!isStale(held, Date.now(), { ttlMs, hostname: os.hostname(), mtimeMs, isAlive: opts.isAlive })) {
    return { ok: false, reason: 'lock-held', path: p, pid: process.pid };
  }

  // 탈취는 1회만 시도한다. 훅에서 대기·재시도 루프는 곧 대화 지연이다.
  // ⚠ rm → write 2단계로 하면 안 된다: A·B가 동시에 stale로 판정하면
  // A.rm → A.write(성공) → B.rm(A의 새 락을 지움) → B.write(성공)로 **둘 다** 락을 쥔다.
  // 임시 파일에 쓰고 rename으로 갈아끼우면 교체가 한 번에 일어난다.
  try {
    const tmp = `${p}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, payload);
    fs.renameSync(tmp, p);
    return { ok: true, path: p, pid: process.pid };
  } catch {
    return { ok: false, reason: 'lock-held', path: p, pid: process.pid };
  }
}

/** 내 락일 때만 지운다 — 탈취당한 뒤 남의 락을 지우면 그 프로세스가 무방비가 된다 */
function release(handle) {
  if (!handle || !handle.path || handle.degraded) return;
  try {
    const held = JSON.parse(fs.readFileSync(handle.path, 'utf8'));
    if (held.pid === handle.pid) fs.rmSync(handle.path, { force: true });
  } catch {
    // 이미 없거나 못 읽는다 — 해제할 게 없다
  }
}

module.exports = { acquire, release, isStale, lockPath };
