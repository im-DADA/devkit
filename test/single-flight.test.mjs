// single-flight.js — 같은 패키지의 같은 kind가 동시에 두 번 돌지 않게 한다.
// (docs/2026-08-12-verification-runtime/ B9·B10)
//
// stale 판정이 이 파일의 핵심이다. 두 신호(PID 생존 · mtime 나이)를 OR로 쓰는데,
// 어느 하나만으로는 안 되는 이유가 각각 있고 P16·P17이 그걸 고정한다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.join(dir, '..', 'hooks', 'lib', 'single-flight.js');
const { acquire, release, isStale } = createRequire(import.meta.url)(modPath);

const tmpDirs = [];
function makeRoot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-lock-'));
  tmpDirs.push(d);
  return d;
}
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

const HOST = os.hostname();

// ── P16·P17 stale 판정 (순수) ─────────────────────────────────────
test('P16: 같은 host면 PID 생존을 본다', () => {
  const base = { pid: 4242, host: HOST, kind: 'typecheck' };
  const opts = { ttlMs: 60000, hostname: HOST, mtimeMs: Date.now() };
  assert.equal(isStale(base, Date.now(), { ...opts, isAlive: () => false }), true, '죽은 PID = stale');
  assert.equal(isStale(base, Date.now(), { ...opts, isAlive: () => true }), false, '산 PID = stale 아님');
});

test('P16b: host가 다르면 PID를 아예 안 본다 (남의 PID 공간)', () => {
  const foreign = { pid: 4242, host: 'someone-else', kind: 'typecheck' };
  const now = Date.now();
  // isAlive가 호출되면 그 자체가 결함이다 — 다른 머신의 PID를 우리 PID처럼 읽는 것
  let called = false;
  const r = isStale(foreign, now, {
    ttlMs: 60000, hostname: HOST, mtimeMs: now, isAlive: () => { called = true; return false; },
  });
  assert.equal(called, false, '다른 host의 PID를 조회하면 안 됨');
  assert.equal(r, false, 'mtime이 신선하면 stale 아님');
});

test('P17: mtime이 TTL을 넘으면 산 PID여도 stale (OR 관계)', () => {
  // mtime만 쓰면 죽은 락을 TTL만큼 기다린다 — 그 사이 매 턴이 skipped(침묵)라
  // 사용자는 검증이 도는 줄 안다. PID만 쓰면 재사용된 PID 때문에 락이 영원히 살아 보인다.
  const now = Date.now();
  const payload = { pid: process.pid, host: HOST, kind: 'typecheck' };
  const stale = isStale(payload, now, {
    ttlMs: 1000, hostname: HOST, mtimeMs: now - 5000, isAlive: () => true,
  });
  assert.equal(stale, true);
});

test('P17b: 깨진 payload는 stale로 본다 (락이 영원히 남지 않는다)', () => {
  const now = Date.now();
  for (const bad of [null, undefined, 'nope', {}, { pid: 'x' }]) {
    const r = isStale(bad, now, { ttlMs: 60000, hostname: HOST, mtimeMs: now, isAlive: () => true });
    assert.equal(r, true, `깨진 payload는 stale: ${JSON.stringify(bad)}`);
  }
});

// ── 획득/해제 (IO) ────────────────────────────────────────────────
test('L1: 락을 잡으면 파일이 생기고, 두 번째 획득은 실패한다', () => {
  const root = makeRoot();
  const first = acquire(root, 'typecheck');
  assert.equal(first.ok, true);
  assert.ok(fs.existsSync(first.path), '락 파일이 생겨야 함');
  const second = acquire(root, 'typecheck');
  assert.equal(second.ok, false, '살아 있는 락은 못 뺏는다');
  assert.equal(second.reason, 'lock-held');
  release(first);
});

test('L2: kind가 다르면 서로 막지 않는다', () => {
  const root = makeRoot();
  const t = acquire(root, 'typecheck');
  const l = acquire(root, 'lint');
  assert.equal(t.ok, true);
  assert.equal(l.ok, true, 'typecheck와 lint는 독립이다');
  release(t); release(l);
});

test('L3: 죽은 PID + 오래된 mtime 락은 탈취된다 (B10)', () => {
  const root = makeRoot();
  const lockPath = path.join(root, '.devkit', 'verify-typecheck.lock');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999, host: HOST, kind: 'typecheck' }));
  const old = Date.now() - 10 * 60 * 1000;
  fs.utimesSync(lockPath, old / 1000, old / 1000);

  const r = acquire(root, 'typecheck');
  assert.equal(r.ok, true, '죽은 락에 영원히 막히면 안 된다');
  const payload = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert.equal(payload.pid, process.pid, '락이 내 것으로 교체돼야 함');
  release(r);
});

test('L4: 해제는 내 락일 때만 — 탈취당한 남의 락을 지우지 않는다', () => {
  const root = makeRoot();
  const mine = acquire(root, 'typecheck');
  // 다른 프로세스가 탈취해 간 상황을 재현
  fs.writeFileSync(mine.path, JSON.stringify({ pid: 12345, host: HOST, kind: 'typecheck' }));
  release(mine);
  assert.ok(fs.existsSync(mine.path), '남의 락을 지우면 그 프로세스가 무방비가 된다');
  fs.rmSync(mine.path, { force: true });
});

test('L5: 해제 후 락 파일이 남지 않는다', () => {
  const root = makeRoot();
  const r = acquire(root, 'lint');
  release(r);
  assert.equal(fs.existsSync(r.path), false);
});

test('L6: 쓸 수 없는 위치여도 throw하지 않고 진행을 허용한다 (fail-open)', () => {
  // 락을 못 잡는다고 검증을 건너뛰면, 검증이 안 도는데 조용한 상태가 된다 —
  // 이 사이클이 죽이려는 침묵 no-op이다. 락은 최적화이지 게이트가 아니다.
  const r = acquire('/proc/nonexistent-devkit-root', 'typecheck');
  assert.equal(r.ok, true);
  assert.equal(r.degraded, true, '락 없이 도는 중임을 밝혀야 함');
  assert.doesNotThrow(() => release(r));
});
