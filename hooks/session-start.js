#!/usr/bin/env node
// devkit SessionStart hook — RULES.md의 요약 블록(SUMMARY:START~END)을 읽어 컨텍스트로 주입.
// RULES.md가 규칙의 단일 소스. 여기서 문구를 중복 정의하지 않는다.
// 훅은 세션 시작을 막으면 안 되므로, 읽기 실패 시 stderr에 경고를 남기고 최소 리마인드로 degrade한다(exit 0).

const fs = require('node:fs');
const path = require('node:path');
const { findProjectRoot } = require('./lib/project-root');
const { readState, isActive } = require('./lib/pdca-state');

const FALLBACK = `## devkit 팀 규칙 리마인드
상세 규칙은 플러그인 RULES.md 참조 (/kit).`;

/** 진행 중 사이클이 있으면 재개 안내를 만든다. 없으면 빈 문자열 */
function resumeBlock() {
  try {
    const state = readState(findProjectRoot(process.cwd()));
    if (!isActive(state)) return '';
    const lines = [
      '',
      '## 진행 중 PDCA 사이클',
      `- ${state.cycleId} — 단계 ${state.stage} (${state.status})`,
      `- 다음 액션: ${state.nextAction}`,
      `- 문서: docs/${state.cycleId}/`,
    ];
    if (state.status === 'awaiting-approval') {
      lines.push('- ⚠ 승인 대기 중 — 사용자 승인 전에 다음 단계로 넘어가지 말 것.');
    }
    return lines.join('\n');
  } catch (e) {
    process.stderr.write(`[devkit] session-start: 사이클 상태 로드 실패 — ${e.message}\n`);
    return '';
  }
}

function extractSummary() {
  const rulesPath = path.join(__dirname, '..', 'RULES.md');
  const md = fs.readFileSync(rulesPath, 'utf8');
  const m = md.match(/<!-- SUMMARY:START -->\n([\s\S]*?)\n<!-- SUMMARY:END -->/);
  if (!m) throw new Error('SUMMARY markers not found in RULES.md');
  return m[1].trim();
}

let summary;
try {
  summary = extractSummary();
} catch (e) {
  process.stderr.write(`[devkit] session-start: RULES.md 요약 로드 실패 — ${e.message}\n`);
  summary = FALLBACK;
}

process.stdout.write(summary + resumeBlock() + '\n');
