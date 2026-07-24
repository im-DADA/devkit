#!/usr/bin/env node
// devkit SessionStart hook — RULES.md의 요약 블록(SUMMARY:START~END)을 읽어 컨텍스트로 주입.
// RULES.md가 규칙의 단일 소스. 여기서 문구를 중복 정의하지 않는다.
// 훅은 세션 시작을 막으면 안 되므로, 읽기 실패 시 stderr에 경고를 남기고 최소 리마인드로 degrade한다(exit 0).

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { findProjectRoot } = require('./lib/project-root');
const { readState, isActive } = require('./lib/pdca-state');
const { tail } = require('./lib/progress');
const { readBehaviors, summarize } = require('./lib/behaviors');

const FALLBACK = `## devkit 팀 규칙 리마인드
상세 규칙은 플러그인 RULES.md 참조 (/kit).`;

/** 최근 커밋 몇 줄 — 컴팩션 후 "무엇을 했나"를 git에서 복구 */
function recentCommits(root) {
  try {
    const out = execFileSync('git', ['log', '--oneline', '-8'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out ? out.split('\n') : [];
  } catch {
    return [];
  }
}

/**
 * 진행 중 사이클이 있으면 재개 안내(PROGRESS 끝 + 미완료 behavior + git log).
 * bkit 상태면 충돌 경고. 없으면 빈 문자열.
 * — 컴팩션에서 사이클 상태가 날아가므로 SessionStart(compact 포함)가 복구 담당.
 */
function resumeBlock() {
  let root;
  try {
    root = findProjectRoot(process.cwd());
  } catch {
    return '';
  }
  const state = readState(root);

  // D6: bkit 상태 파일 충돌 경고
  if (state && state.foreign) {
    return [
      '',
      '## ⚠ 상태 파일 충돌',
      `- \`.devkit/pdca-state.json\`이 다른 워크플로(${state.foreign}) 스키마다.`,
      '- devkit 규약은 `{version:1, cycleId, stage, status}`를 쓴다. 상태를 새로 쓸 때 이 형식을 지킬 것.',
    ].join('\n');
  }

  if (!isActive(state)) return '';

  const cycleDir = path.join(root, 'docs', state.cycleId);
  const lines = [
    '',
    '## 진행 중 PDCA 사이클',
    `- ${state.cycleId} — 단계 ${state.stage} (${state.status})`,
    `- 문서: docs/${state.cycleId}/`,
  ];
  if (state.status === 'awaiting-approval') {
    lines.push('- ⚠ 승인 대기 중 — 사용자 승인 전에 다음 단계로 넘어가지 말 것.');
  }

  // behaviors.json 미완료 항목 (진실의 원천)
  const doc = readBehaviors(cycleDir);
  if (doc) {
    const s = summarize(doc);
    lines.push(`- behaviors: ${s.passed}/${s.total} 통과${s.unproven ? ` (unproven ${s.unproven})` : ''}`);
  }

  // PROGRESS.md 끝부분
  const progressTail = tail(cycleDir, 10);
  if (progressTail.length) {
    lines.push('- 최근 진행(PROGRESS.md):');
    for (const l of progressTail) lines.push(`  ${l}`);
  }

  // git log — 대화 기억보다 신뢰
  const commits = recentCommits(root);
  if (commits.length) {
    lines.push('- 최근 커밋:');
    for (const c of commits.slice(0, 5)) lines.push(`  ${c}`);
  }

  return lines.join('\n');
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
