#!/usr/bin/env node
// devkit SessionStart hook — RULES.md의 요약 블록(SUMMARY:START~END)을 읽어 컨텍스트로 주입.
// RULES.md가 규칙의 단일 소스. 여기서 문구를 중복 정의하지 않는다.
// 훅은 세션 시작을 막으면 안 되므로, 읽기 실패 시 stderr에 경고를 남기고 최소 리마인드로 degrade한다(exit 0).

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findProjectRoot } = require('./lib/project-root');
const { readState, isActive } = require('./lib/pdca-state');
const { tail } = require('./lib/progress');
const { readBehaviors, summarize } = require('./lib/behaviors');
const { compareRules, importsAgentsMd } = require('./lib/rules-sync');

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

/**
 * 소비자 프로젝트의 AGENTS.md 사본이 정본과 다른지 알린다.
 *
 * `/kit init`이 SUMMARY 블록을 AGENTS.md에 인라인 복사하는데 재동기화 경로가 없어서,
 * devkit이 규칙을 바꿔도 이미 init한 프로젝트엔 도달하지 않는다. 에이전트는 AGENTS.md를
 * **우선** 읽으므로 낡은 사본이 정본을 이긴다(결함로그 D26 세 번째 갈래).
 *
 * ⚠ 설계 기준은 탐지 횟수가 아니라 **탐지가 행동으로 이어지는 비율**이다. 그래서
 * 정확히 2줄이고, stale이 아니면 완전히 침묵한다. 배너·이모지 나열은 무시 학습을 만든다.
 * 억제 타이머는 두지 않는다 — 타이머는 상태 파일이 필요하고 그 상태 파일이 또 낡는다.
 */
/** 프로젝트 루트의 파일을 읽되, 없으면 null. 세션 시작을 막는 이유가 될 수 없다. */
function readFromRoot(name) {
  try {
    return fs.readFileSync(path.join(findProjectRoot(process.cwd()), name), 'utf8');
  } catch {
    return null;
  }
}

/**
 * SUMMARY 주입을 생략해도 되는가 — 이미 컨텍스트에 있을 때만.
 *
 * `/kit init`이 SUMMARY를 AGENTS.md에 인라인하고, CLAUDE.md의 `@AGENTS.md` import가
 * 그걸 컨텍스트로 끌어온다(실측 확인). 그 경우 훅이 또 넣으면 **같은 1,407자가 두 번**
 * 들어간다 — Anthropic이 지목한 "같은 지시를 여러 곳에 복제" 안티패턴 그대로다.
 *
 * ⚠ 비대칭이 극단적이다. 미탐(중복 잔존)은 토큰 낭비지만, **오탐은 팀 규칙 전멸**이다.
 * 그래서 세 조건을 전부 만족할 때만 생략하고, 하나라도 확인 안 되면 주입한다.
 */
function summaryAlreadyInContext(summary, agentsMd) {
  if (typeof agentsMd !== 'string') return false;                 // ① AGENTS.md 없음
  if (compareRules(summary, agentsMd).state !== 'current') return false; // ② 사본이 정본과 다름
  return importsAgentsMd(readFromRoot('CLAUDE.md'));              // ③ 실제로 로드되는가
}

function driftBlock(summary, agentsMd) {
  if (typeof agentsMd !== 'string') return '';
  const r = compareRules(summary, agentsMd);
  // 마커 도입 이전에 만들어진 사본. 내용은 비교하지 않는다(어디까지가 사본인지 모른다) —
  // 대신 탐지를 켜는 방법을 알린다. 이 분기가 없으면 기존 사용자 전원이 탐지 밖에 남는다.
  if (r.state === 'unmarked') {
    return [
      '',
      '⚠ AGENTS.md의 공통 규칙에 devkit 마커가 없다 — 규칙이 낡아도 탐지되지 않는다.',
      '  탐지 켜기: `/kit sync` (마커 위치를 제안하고 승인을 받는다)  ·  관리 대상이 아니면 무시해도 된다.',
    ].join('\n');
  }
  if (r.state !== 'stale') return ''; // current·custom·unknown은 침묵
  return [
    '',
    `⚠ AGENTS.md의 공통 규칙이 플러그인 RULES와 ${r.diffLines}줄 다르다 (이 프로젝트 사본이 낡았을 수 있다).`,
    '  최신으로 맞추기: `/kit sync`  ·  의도한 커스터마이즈면 마커를 `mode=custom` 으로 바꾼다.',
  ].join('\n');
}

/**
 * RULES.md의 `<!-- {name}:START -->` ~ `<!-- {name}:END -->` 블록 원문.
 * @throws 마커가 없으면 — 호출자가 블록별로 degrade를 정한다(SUMMARY는 FALLBACK, CODEX는 침묵)
 */
function extractBlock(name) {
  const rulesPath = path.join(__dirname, '..', 'RULES.md');
  const md = fs.readFileSync(rulesPath, 'utf8');
  const m = md.match(new RegExp(`<!-- ${name}:START -->\\n([\\s\\S]*?)\\n<!-- ${name}:END -->`));
  if (!m) throw new Error(`${name} markers not found in RULES.md`);
  return m[1].trim();
}

/** 홈 기준 파일을 읽되, 없으면 null. `os.homedir()`는 POSIX에서 $HOME을 따른다(테스트 격리 근거) */
function readFromHome(rel) {
  try {
    return fs.readFileSync(path.join(os.homedir(), rel), 'utf8');
  } catch {
    return null;
  }
}

/**
 * 전역 Codex 규칙 사본(`~/.codex/AGENTS.md`)이 정본(RULES.md CODEX 블록)과 다른지 알린다.
 *
 * 전역 `~/.claude/CLAUDE.md`를 devkit으로 흡수하면서(2026-09-17) Codex가 받는 규칙은 이 파일의
 * 마커 구간 하나가 됐다. Codex에는 devkit 훅이 없어 거기서는 낡음을 알 길이 없으므로,
 * 원본을 고치는 자리인 Claude 세션 시작에서 본다.
 *
 * ⚠ **stale일 때만** 말한다. 파일 없음·마커 없음·custom은 전부 침묵 — 프로젝트 AGENTS.md와 달리
 * 여기엔 마커 이식 안내(unmarked)도 없다. 사용자 전역 파일에 참견하지 않는다.
 */
function codexDriftBlock(canonical, codexMd) {
  if (typeof canonical !== 'string' || typeof codexMd !== 'string') return '';
  const r = compareRules(canonical, codexMd);
  if (r.state !== 'stale') return '';
  return [
    '',
    `⚠ ~/.codex/AGENTS.md의 devkit 규칙이 플러그인 RULES와 ${r.diffLines}줄 다르다 (Codex가 낡은 규칙을 읽고 있다).`,
    '  최신으로 맞추기: `/kit sync`  ·  의도한 커스터마이즈면 마커를 `mode=custom` 으로 바꾼다.',
  ].join('\n');
}

let summary;
let summaryIsCanonical = true;
try {
  summary = extractBlock('SUMMARY');
} catch (e) {
  process.stderr.write(`[devkit] session-start: RULES.md 요약 로드 실패 — ${e.message}\n`);
  summary = FALLBACK;
  // ⚠ FALLBACK은 정본이 아니다. 이걸로 사본을 비교하면 멀쩡한 AGENTS.md가 전부 stale로
  // 뜬다 — 정본을 못 읽은 우리 잘못을 사용자 파일 탓으로 보고하는 꼴이다.
  summaryIsCanonical = false;
}

// 훅이 세션 시작을 막으면 안 된다 — 판정이 터져도 리마인드는 나가야 한다.
// 그래서 실패 시 skip=false(=주입)로 degrade한다: 규칙을 잃지 않는 쪽.
let drift = '';
let skipSummary = false;
if (summaryIsCanonical) {
  try {
    const agentsMd = readFromRoot('AGENTS.md');
    drift = driftBlock(summary, agentsMd);
    skipSummary = summaryAlreadyInContext(summary, agentsMd);
  } catch (e) {
    process.stderr.write(`[devkit] session-start: 규칙 동기화 검사 실패 — ${e.message}\n`);
  }
}

// Codex 정본을 못 읽으면(블록 없음) 침묵한다 — 정본을 못 읽은 우리 잘못을 사용자 파일이 낡았다고
// 보고하면 안 된다(위 FALLBACK과 같은 이유). 판정이 터져도 리마인드는 나가야 한다.
let codexDrift = '';
try {
  let codexCanon = null;
  try {
    codexCanon = extractBlock('CODEX');
  } catch {
    codexCanon = null;
  }
  codexDrift = codexDriftBlock(codexCanon, readFromHome(path.join('.codex', 'AGENTS.md')));
} catch (e) {
  process.stderr.write(`[devkit] session-start: Codex 규칙 동기화 검사 실패 — ${e.message}\n`);
}

// 재개 블록은 생략 대상이 아니다 — 그 정보는 AGENTS.md에 없다.
process.stdout.write((skipSummary ? '' : summary) + drift + codexDrift + resumeBlock() + '\n');
