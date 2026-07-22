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
  { file: 'agents/gap-detector.md', must: [/Match Rate/, /SPEC\.md/, /DESIGN\.md/, /수정하지 않/] },
  { file: 'agents/report-writer.md', must: [/REPORT\.md/, /Match Rate/, /과장.*금지|미화/, /배운 것/] },
];

for (const c of CONTRACTS) {
  test(`프롬프트 계약: ${c.file}`, () => {
    const src = read(c.file);
    for (const re of c.must) assert.match(src, re, `${c.file}에 핵심 지침 누락: ${re}`);
  });
}
