#!/usr/bin/env node
// B5 실측 도구 — `--incremental` 재실행이 실제로 빠른가를 벽시계로 잰다.
// (docs/2026-08-12-verification-runtime/ B5)
//
// devkit엔 root package.json도 TypeScript도 없고 의존성 0 원칙이 있다. 그래서
// **측정 도구는 여기에, 측정 대상은 밖에서 주입**한다. 대상 프로젝트의 node_modules/typescript를 쓴다.
//
//   node scripts/bench-verify.mjs --project /abs/path/to/ts-project [--runs 3]
//
// ⚠ tsBuildInfo를 대상 프로젝트가 아니라 임시 디렉터리에 쓴다. 남의 레포에 파일을 남기지
// 않기 위해서다(buildinfo 위치는 속도에 영향이 없다). 실제 훅은 <root>/.devkit/tsbuildinfo를 쓴다.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const project = get('--project');
const runs = Number(get('--runs') || 3);
if (!project) {
  process.stderr.write('usage: node scripts/bench-verify.mjs --project <path> [--runs 3]\n');
  process.exit(1);
}

const root = path.resolve(project);
const tsc = path.join(root, 'node_modules', '.bin', 'tsc');
if (!fs.existsSync(tsc)) {
  process.stderr.write(`no tsc in ${root}/node_modules/.bin\n`);
  process.exit(1);
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-bench-'));
const buildInfo = path.join(scratch, 'tsbuildinfo');
const argv = ['--noEmit', '--pretty', 'false', '--incremental', '--tsBuildInfoFile', buildInfo];

function once() {
  const t0 = Date.now();
  const r = spawnSync(tsc, argv, { cwd: root, encoding: 'utf8', timeout: 600000 });
  return {
    ms: Date.now() - t0,
    status: r.status,
    out: `${r.stdout || ''}${r.stderr || ''}`,
  };
}

function tsVersion() {
  const r = spawnSync(tsc, ['--version'], { cwd: root, encoding: 'utf8' });
  return (r.stdout || '').trim().replace(/^Version\s+/, '') || 'unknown';
}

// 우리가 붙인 플래그를 이 TS 버전이 거부하는가(Q1) — 거부하면 측정 자체가 무의미하다
const cold = once();
const rejected = /error TS5\d+[^\n]*(incremental|tsBuildInfoFile|noEmit)/i.test(cold.out);
const warm = [];
if (!rejected) for (let i = 0; i < runs; i++) warm.push(once().ms);

fs.rmSync(scratch, { recursive: true, force: true });

const sorted = [...warm].sort((a, b) => a - b);
const warmMedian = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;

process.stdout.write(
  `project: ${path.basename(root)}  ts: ${tsVersion()}\n` +
    `cold: ${cold.ms}ms\n` +
    `warm: ${warm.map((m) => `${m}ms`).join(' · ') || '(미측정)'}\n` +
    (rejected ? 'incremental 조합을 이 TS 버전이 거부함\n' : '') +
    (warmMedian ? `warmMedian/cold = ${(warmMedian / cold.ms).toFixed(3)}\n` : ''),
);

// 마지막 한 줄은 항상 파싱 가능한 JSON. 프로젝트 절대경로는 basename만 남긴다(사설 경로 유출 방지).
process.stdout.write(
  `${JSON.stringify({
    schema: 'devkit-bench/1',
    mode: 'direct-tsc',
    project: path.basename(root),
    tsVersion: tsVersion(),
    node: process.version,
    os: `${process.platform} ${process.arch}`,
    incrementalRejected: rejected,
    cold: cold.ms,
    warm,
    warmMedian,
    ratio: warmMedian ? Number((warmMedian / cold.ms).toFixed(3)) : null,
    allWarmFasterThanCold: warm.length > 0 && warm.every((m) => m < cold.ms),
  })}\n`,
);
