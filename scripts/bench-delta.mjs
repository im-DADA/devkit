#!/usr/bin/env node
// B9 실측 도구 — delta가 실제로 주입량을 줄이는가를 **바이트**로 잰다.
// (docs/2026-08-12-scoped-verification/ B9)
//
// 측정 단위가 시간이 아니라 주입량인 이유: 사이클 A의 REPORT가 남긴 숫자(found 실측
// 16,353바이트)와 직접 비교 가능해야 한다.
//
//   node scripts/bench-delta.mjs --project /abs/path/to/project [--inject]
//
// 측정 도구는 devkit에, 측정 대상은 밖에서 주입한다(A의 bench-verify.mjs와 같은 원칙).
// --inject는 고의 타입 에러 파일을 만들었다가 finally에서 지운다 — 남의 레포에 안 남긴다.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(here, '..', 'hooks', 'stop-verify.js');

const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const project = get('--project');
const inject = args.includes('--inject');
if (!project) {
  process.stderr.write('usage: node scripts/bench-delta.mjs --project <path> [--inject]\n');
  process.exit(1);
}

const root = path.resolve(project);
const baseline = path.join(root, '.devkit', 'verify-baseline.json');

/** stop-verify를 실제로 spawn해 stdout 바이트 수를 잰다 */
function turn(sid = 'bench') {
  const t0 = Date.now();
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({ session_id: sid }),
    cwd: root,
    encoding: 'utf8',
    timeout: 600000,
    env: { ...process.env, DEVKIT_VERIFY: get('--kinds') || 'typecheck' },
  });
  const out = r.stdout || '';
  return { bytes: Buffer.byteLength(out, 'utf8'), ms: Date.now() - t0, out };
}

let t1; let t2; let t3 = null;
// ⚠ probe를 레포 루트에 두면 안 된다 — tsconfig include가 대개 src/** 라서 대상 밖이고,
// 그러면 '에러를 넣었는데 조용하다'가 성공처럼 보인다(실측으로 발견).
// 실재하는 소스 파일 옆에 둔다.
function probeDir(base) {
  const stack = [base];
  const skip = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.devkit']);
  while (stack.length) {
    const cur = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory()) { if (!skip.has(e.name)) stack.push(path.join(cur, e.name)); continue; }
      if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) return cur;
    }
  }
  return base;
}
const dirForProbe = probeDir(root);
const probeA = path.join(dirForProbe, 'devkit-bench-probe-a.ts');
const probeB = path.join(dirForProbe, 'devkit-bench-probe-b.ts');
const ERR = (n) => `export const probe${n}: number = 'devkit-bench-${n}';\n`;

// finally는 SIGINT에 안 돈다 — 남의 레포에 고의 타입에러 파일을 남기면 안 된다.
const cleanup = () => { for (const f of [probeA, probeB]) fs.rmSync(f, { force: true }); };
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(130); });

// ⚠ 에러를 **턴1 전에** 심어야 세 신호가 다 나온다. 깨끗한 프로젝트에서 나중에 심으면
// 턴1이 0바이트라 '감소'를 잴 수 없고, 그게 성공처럼 보인다(실측으로 발견).
try {
  if (inject) fs.writeFileSync(probeA, ERR('A'));
  fs.rmSync(baseline, { force: true }); // cold — 기준선 없음
  t1 = turn();
  t2 = turn();
  if (inject) {
    fs.writeFileSync(probeB, ERR('B'));
    t3 = turn();
  }
} finally {
  cleanup();
}

// ⚠ 턴1이 진단이었는지 '스크립트 없음' 알림이었는지 구분한다. 구분 안 하면 검증이
// 아예 안 도는 프로젝트에서 '100% 감소'라는 무의미한 숫자가 나온다(실제로 그랬다).
let status = 'unknown';
let total = 0;
try {
  const ctx = JSON.parse(t1.out).hookSpecificOutput.additionalContext;
  if (/찾지 못했다|실행할 수 없다/.test(ctx)) status = 'unavailable';
  else if (/실행되지 못했다/.test(ctx)) status = 'failed';
  else {
    status = 'found';
    const m = /진단 (\d+)건/.exec(ctx);
    if (m) total = Number(m[1]);
  }
} catch {
  status = t1.bytes === 0 ? 'clean' : 'other';
}
if (status !== 'found') {
  process.stderr.write(`[bench] 턴1이 '${status}'다 — 이 프로젝트에서는 delta를 측정할 수 없다.\n`);
}

process.stdout.write(
  `project: ${path.basename(root)}\n`
    + `턴1(기준선 없음): ${t1.bytes}바이트 · ${t1.ms}ms\n`
    + `턴2(무변경):      ${t2.bytes}바이트 · ${t2.ms}ms\n`
    + (t3 ? `턴3(에러 1건 주입): ${t3.bytes}바이트 · ${t3.ms}ms\n` : '')
    + `감소: ${t1.bytes ? `${Math.round((1 - t2.bytes / t1.bytes) * 100)}%` : 'n/a'}\n`,
);

// 그래프 통계 — 열린 질문 Q3(alias 비중)·Q6(스캔 예산)을 닫는 데 쓴다
let graph = null;
let scanMs = null;
try {
  const { scopeFor } = await import(new URL('../hooks/lib/verify-scope.js', import.meta.url));
  const s0 = Date.now();
  const s = scopeFor(root, 'typecheck');
  scanMs = Date.now() - s0;
  graph = s.graph || null;
} catch { /* 통계 실패가 측정을 막지 않는다 */ }

// 마지막 한 줄은 항상 파싱 가능한 JSON. 절대경로는 basename만(사설 경로 유출 방지).
process.stdout.write(
  `${JSON.stringify({
    schema: 'devkit-delta-bench/1',
    project: path.basename(root),
    turn1Bytes: t1.bytes,
    turn2Bytes: t2.bytes,
    turn3Bytes: t3 ? t3.bytes : null,
    turn1Status: status,
    totalDiagnostics: total,
    turnMs: [t1.ms, t2.ms, t3 ? t3.ms : null],
    // 결정 10이 "실측 가능하게 남긴다"고 한 값 — alias 비중(Q3)과 스캔 예산(Q6)을 여기서 잰다
    graph,
    scanMs,
    node: process.version,
    os: `${process.platform} ${process.arch}`,
    // 판정 기준: turn2 < turn1 (필수). --inject 시 turn3 > 0 (필수 —
    // "조용해진 것"과 "고장난 것"을 가르는 유일한 지표다).
    quieter: t2.bytes < t1.bytes,
    stillReportsNew: t3 ? t3.bytes > 0 : null,
    // 새 것만 나오고 기존 것은 안 나오는가 — "조용해진 것"과 "고장난 것"을 가르는 지표
    onlyNewShown: t3 ? (/probe-b|probeB/.test(t3.out) && !/probe-a|probeA/.test(t3.out)) : null,
  })}\n`,
);
