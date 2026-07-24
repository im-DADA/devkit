// 행동 eval (자동, 프롬프트 계약) — 에이전트/스킬 프롬프트가 핵심 지침을 유지하는지 회귀 검사.
// LLM을 돌리지 않고 프롬프트 텍스트를 검증하므로 빠르고 결정적. 실제 LLM 실행 채점은 evals/run.mjs(opt-in).
// 실행: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const CONTRACTS = [
  { file: 'agents/tdd-driver.md', must: [/RED/, /GREEN/, /최소/, /먼저/, /실패하는 테스트/] },
  { file: 'agents/code-reviewer.md', must: [/file:line/, /수정하지 않는다|읽기전용/, /보안/, /시크릿|하드코딩/] },
  { file: 'agents/feature-builder.md', must: [/\.tsx/, /훅|hook/i] },
  { file: 'skills/convention-check/SKILL.md', must: [/any/, /kebab-case/, /console\.log/] },
  { file: 'agents/architect.md', must: [/DESIGN\.md/, /트레이드오프/, /TDD.*계약|계약/, /코드는.*짜지 않/] },
  // Phase 1(0.9.0): 테스트 실행 필수 + Match Rate를 게이트에서 신호로 강등
  {
    file: 'agents/gap-detector.md',
    must: [
      /DESIGN\.md/,
      /수정하지 않/,
      /실행/, // 테스트를 실제로 돌려야 ✅를 줄 수 있다
      /evidence/i,
      /게이트가 아니|신호/, // Match Rate 강등
      /unproven/,
    ],
  },
  { file: 'agents/report-writer.md', must: [/REPORT\.md/, /Match Rate/, /과장.*금지|미화/, /배운 것/] },
  // Phase 1: 커맨드가 신규칙을 담고 있는지 — 에이전트만 고치고 커맨드를 놓치면
  // 커맨드 본문이 에이전트 판정을 덮어써서 구 규칙으로 되돌아간다(실제로 겪은 갭).
  {
    file: 'commands/gap.md',
    must: [/unproven/, /behaviors\.json/, /게이트가 아니/, /실행/],
  },
  {
    file: 'commands/iterate.md',
    must: [/테스트 파일/, /무효/, /git diff/, /unproven/, /evidence/],
  },
  {
    file: 'commands/plan.md',
    must: [/behaviors\.json/, /passes.*false|false.*passes/, /영문/],
  },
];

for (const c of CONTRACTS) {
  test(`프롬프트 계약: ${c.file}`, () => {
    const src = read(c.file);
    for (const re of c.must) assert.match(src, re, `${c.file}에 핵심 지침 누락: ${re}`);
  });
}
