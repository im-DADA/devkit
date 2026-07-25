// 행동 eval (자동, 프롬프트 계약) — 에이전트/스킬 프롬프트가 핵심 지침을 유지하는지 회귀 검사.
// LLM을 돌리지 않고 프롬프트 텍스트를 검증하므로 빠르고 결정적. 실제 LLM 실행 채점은 evals/run.mjs(opt-in).
// 실행: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
// 문서끼리 대조하면 둘 다 틀린 채로 일치할 수 있다 — 코드 상수를 기준으로 삼는다(D14).
const { STAGES, STATUSES } = createRequire(import.meta.url)(
  path.join(root, 'hooks', 'lib', 'pdca-state.js'),
);

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

// ── B14: 산출물 쓰기 주체 통일 (D11) ────────────────────────────
// 하네스가 "서브에이전트는 파일이 아니라 텍스트를 반환하라"를 휴리스틱으로 차단한다 —
// 파일명에 따라 비결정적으로 걸리므로 지금 통해도 언제든 깨진다. 쓰기는 커맨드(메인)가 한다.
const frontmatter = (md) => (md.match(/^---\n([\s\S]*?)\n---/) || [, ''])[1];
const DOC_AGENTS = ['architect', 'report-writer', 'code-reviewer', 'gap-detector'];

test('B14: 문서 산출 에이전트의 tools에 Write 없음', () => {
  for (const a of DOC_AGENTS) {
    const toolsLine = (frontmatter(read(`agents/${a}.md`)).match(/^tools:.*$/m) || [''])[0];
    assert.ok(toolsLine, `${a}: tools 줄 없음`);
    assert.doesNotMatch(toolsLine, /\bWrite\b/, `${a}: tools에 Write가 남아 있다`);
  }
});

test('B14: 본문 출력 계약이 "반환"이다 (파일 쓰기는 커맨드 몫)', () => {
  const contracts = [
    ['architect', /DESIGN\.md 본문 텍스트를 반환/],
    ['report-writer', /REPORT\.md 본문 텍스트를 반환/],
    ['code-reviewer', /REVIEW\.md 본문 형식으로 반환/],
    ['gap-detector', /반환/],
  ];
  for (const [a, re] of contracts) {
    assert.match(read(`agents/${a}.md`), re, `${a}: 반환 계약 누락`);
  }
});

test('B14: frontmatter description이 Write를 주장하지 않는다', () => {
  for (const a of DOC_AGENTS) {
    assert.doesNotMatch(frontmatter(read(`agents/${a}.md`)), /\bWrite\b/, `${a}: description이 Write를 주장`);
  }
});

// ── B9: /review가 사이클 활성 시 REVIEW.md를 남긴다 ─────────────
// review 결과가 파일로 남지 않아 종합에서 조용히 빠진 사이클에 실제 버그 3건이 남아 있었다(D13).
test('B9: /review 사이클 활성 분기가 REVIEW.md·PROGRESS·상태를 갱신', () => {
  const src = read('commands/review.md');
  assert.match(frontmatter(src), /^\s*-\s*Write$/m, 'allowed-tools에 Write 없음 — 파일을 쓸 수 없다');
  const must = [
    [/REVIEW\.md/, '산출 파일명'],
    [/PROGRESS\.md/, 'PROGRESS append 지시'],
    [/그대로/, '반환 본문을 그대로 쓰라는 지시(요약·재작성 금지)'],
    [/반환/, '에이전트 반환텍스트 수령 지시'],
    [/stage:\s*"review"/, '상태 갱신'],
  ];
  for (const [re, why] of must) assert.match(src, re, `commands/review.md: ${why} 누락`);
});

// ── B10: 사이클이 없으면 REVIEW.md를 만들지 않는다 ──────────────
// /review는 사이클 밖에서도 쓰는 단독 도구다. 사이클 산출물 강제가 그 용법을 깨면 안 된다.
test('B10: /review 비활성 분기 — 사이클 없으면 출력만', () => {
  const src = read('commands/review.md');
  assert.match(src, /사이클[^\n]*(없|비활성)/, '사이클 없을 때의 분기 문구 없음');
  assert.match(src, /출력만|보고만|만들지 않는다/, '단독 리뷰 동작 명시 없음');
});

// ── BF2: 활성 판정이 차단 조건과 대칭이다 (경로 기반) ────────────
// REPORT.md 차단은 경로 기반인데 REVIEW.md 생산이 상태 파일 cycleId에만 의존하면 데드락이 난다.
// `.devkit/`는 gitignore 대상이라 "사이클 폴더는 있는데 상태 파일이 없는" 상태가 정상 발생한다 —
// 그때 /review는 REVIEW.md를 만들지 않고, /report는 그게 없다며 영원히 막힌다.
test('BF2: /review 활성 판정이 경로 기반으로도 성립한다', () => {
  const src = read('commands/review.md');
  const branch = src.split('\n').find((l) => /cycleId/.test(l) && /활성/.test(l));
  assert.ok(branch, 'commands/review.md: 사이클 활성 판정 줄이 없다');
  assert.match(branch, /또는/, '판정이 상태 파일 단독 조건이다 — 경로 기반 대안이 없다');
  assert.match(
    branch,
    /docs\/\{YYYY-MM-DD\}-\{slug\}\//,
    '사이클 폴더 경로로 활성을 판정하는 조건 없음 — 상태 파일이 없으면 /report가 열리지 않는다',
  );
  assert.match(branch, /인자|컨텍스트/, '경로를 어디서 얻는지(인자·컨텍스트) 명시 없음');
});

// ── B12: /kit init의 settings.json에 permissions.allow (D10) ────
// 상태 파일은 단계마다 쓰는데 매번 승인 프롬프트가 떴다(D10 1순위 불편).
// 다만 마찰은 상태 파일 하나에서 나왔다 — `.devkit/**`로 넓히면 audit.jsonl(가드 차단 기록)까지
// 무프롬프트 덮어쓰기 대상이 되어 관측 기능을 스스로 약화시킨다(REVIEW 🟡3).
test('B12: /kit init settings.json에 permissions.allow', () => {
  const src = read('commands/kit.md');
  for (const re of [
    /permissions/,
    /allow/,
    /Write\(\.devkit\/pdca-state\.json\)/,
    /Edit\(\.devkit\/pdca-state\.json\)/,
  ]) {
    assert.match(src, re, `commands/kit.md: ${re} 누락`);
  }
  assert.match(src, /기존 키[^\n]*보존|보존[^\n]*병합/, '기존 키 보존 병합 지시 없음');
});

test('B12: permissions.allow가 audit.jsonl까지 열어주지 않는다', () => {
  const src = read('commands/kit.md');
  // permission 엔트리 형태(`Tool(경로)`)만 본다 — 도움말 산문의 `(.devkit/audit.jsonl)` 언급은 무관하다.
  for (const re of [
    /Write\(\.devkit\/\*\*\)/,
    /Edit\(\.devkit\/\*\*\)/,
    /(?:Write|Edit)\(\.devkit\/audit\.jsonl\)/,
  ]) {
    assert.doesNotMatch(src, re, `commands/kit.md: 감사 로그까지 무프롬프트 쓰기 대상이다 (${re})`);
  }
});

// ── BF6: /gap 다음 단계가 /review다 ─────────────────────────────
// gap 통과 직후를 /report로 안내하면 REVIEW.md가 없어 그 쓰기가 훅에 차단된다 — 문서가 AI를
// 차단되는 행동으로 유도하는 셈이다(review는 GAP과 REPORT 사이의 필수 단계).
test('BF6: /gap 통과 후 다음 단계는 /review다', () => {
  const src = read('commands/gap.md');
  // frontmatter description에도 같은 문구가 있다 — 다음 단계를 지시하는 건 본문의 절차 줄이다.
  const body = src.replace(/^---\n[\s\S]*?\n---\n/, '');
  const line = body.split('\n').find((l) => /통과 기준/.test(l) && /unproven/.test(l));
  assert.ok(line, 'commands/gap.md: 통과 기준 줄이 없다');
  assert.match(line, /\/review/, '다음 단계 안내가 /review가 아니다');
  assert.doesNotMatch(line, /\/report/, 'review를 건너뛰고 /report로 안내한다 — 훅이 그 쓰기를 차단한다');
});

// ── B13: /report 게이트·아카이빙·상태값이 코드와 일치 (D14) ──────
// 실전에서 REVIEW를 건너뛰고, 아카이브 경로를 창작하고, status를 "complete"로 쓴 사고가 있었다.
test('B13: /report 하드 게이트에 REVIEW.md + 아카이빙 경로·수령 지시', () => {
  const src = read('commands/report.md');
  const must = [
    [/REVIEW\.md/, '하드 게이트의 REVIEW.md'],
    [/docs\/archive\/\{YYYY-MM-DD\}\/\{slug\}/, '아카이빙 경로'],
    [/그대로/, '반환 본문을 그대로 쓰라는 지시'],
    [/반환/, 'report-writer 반환텍스트 수령 지시'],
    [/🔴[^\n]*남은 갭|남은 갭[^\n]*🔴/, '🔴 미해결을 남은 갭에 적으라는 지시(리뷰 인플레 완화)'],
  ];
  for (const [re, why] of must) assert.match(src, re, `commands/report.md: ${why} 누락`);
});

// 문서에 박힌 상태값이 코드 enum 밖으로 흘러나가면 훅이 정상 작업을 차단한다.
test('B13: 문서의 stage·status 리터럴이 코드 enum 안에 있다', () => {
  const docs = ['RULES.md', ...fs.readdirSync(path.join(root, 'commands')).map((f) => `commands/${f}`)];
  for (const d of docs) {
    const src = read(d);
    for (const [, v] of src.matchAll(/\bstage["']?\s*:\s*["']([a-z-]+)["']/g)) {
      assert.ok(STAGES.includes(v), `${d}: 코드에 없는 stage "${v}" (허용: ${STAGES.join('|')})`);
    }
    for (const [, v] of src.matchAll(/\bstatus["']?\s*:\s*["']([a-z-]+)["']/g)) {
      assert.ok(STATUSES.includes(v), `${d}: 코드에 없는 status "${v}" (허용: ${STATUSES.join('|')})`);
    }
    assert.doesNotMatch(src, /status[^\n]*["']complete["']/, `${d}: status "complete"는 오류 — "done"이 정본(D14)`);
  }
});

// ── 워크플로 정합: review가 정식 단계로 문서에 있다 ─────────────
// 훅이 REVIEW.md를 요구하는데 워크플로 문서에 그 단계가 없으면, AI는 없는 산출물을 요구받고 멈춘다.
test('워크플로 문서(RULES·flow)에 review 단계가 반영돼 있다', () => {
  const rules = read('RULES.md');
  assert.match(rules, /REVIEW\.md/, 'RULES.md 폴더 규약에 REVIEW.md 없음');
  const summary = (rules.match(/<!-- SUMMARY:START -->([\s\S]*?)<!-- SUMMARY:END -->/) || [])[1];
  assert.ok(summary, 'SUMMARY 블록 없음');
  assert.match(summary, /REVIEW/, 'SUMMARY 리마인드에 REVIEW 단계 없음');

  const stageEnum = rules.match(/^- `stage`: `([^`]+)`/m);
  assert.ok(stageEnum, 'RULES.md에 stage enum 줄 없음');
  assert.deepEqual(stageEnum[1].split('|'), STAGES, 'stage enum이 코드 상수와 다르다');
  const statusEnum = rules.match(/`status`: `([^`]+)`/);
  assert.deepEqual(statusEnum[1].split('|'), STATUSES, 'status enum이 코드 상수와 다르다');

  const flow = read('commands/flow.md');
  assert.match(flow, /REVIEW\.md/, 'flow.md 5) Review에 REVIEW.md 산출 없음');
  assert.match(flow, /stage:\s*"review"/, 'flow.md에 stage:"review" 없음');
});

// ── BF1: /flow 경로가 pdca-gate 게이트와 정합한다 ────────────────
// /flow 1) Plan이 behaviors.json을 만들지 않으면 4) Gap의 GAP.md 쓰기가 훅에 차단된다
// (STAGE_REQUIREMENTS.gap = ['behaviors.json']). 문서만 따라서는 차단 이유도 알 수 없었다.
test('BF1: /flow Plan 단계가 behaviors.json을 만든다', () => {
  const src = read('commands/flow.md');
  const plan = src.slice(src.indexOf('## 1) Plan'), src.indexOf('## 2) Design'));
  assert.match(plan, /behaviors\.json/, 'flow 1) Plan에 behaviors.json 생성 지시 없음 — 4) Gap이 훅에 차단된다');
  assert.match(plan, /passes/, 'behaviors.json을 전부 passes:false로 만들라는 분모 고정 지시 없음');
});

test('BF1: /flow Report 게이트 목록에 behaviors.json이 있다', () => {
  const src = read('commands/flow.md');
  const report = src.slice(src.indexOf('## 6) Report'), src.indexOf('## 7)'));
  const gate = report.split('\n').find((l) => /GAP\.md/.test(l) && /REVIEW\.md/.test(l));
  assert.ok(gate, 'flow 6)에 하드 게이트 목록 줄이 없다');
  assert.match(gate, /behaviors\.json/, '게이트 목록에 behaviors.json 누락 — 차단 이유를 스스로 진단할 수 없다');
});

test('BF1: /flow Gap 통과 기준이 unproven == 0이다', () => {
  const src = read('commands/flow.md');
  assert.match(src, /unproven\s*==\s*0/, 'flow.md에 unproven == 0 기준 없음');
  assert.doesNotMatch(src, /90%\s*미만/, 'Match Rate 90% 기준이 남아 있다 — 게이트는 unproven == 0이다');
});

// 4필드 밖 키를 지시하는 문서가 남아 있으면, 그 지시를 따른 쓰기를 pdca-gate가 거부한다.
// 문서가 AI를 차단되는 행동으로 유도하는 셈 — 게이트를 켠 이상 문서도 같이 좁혀야 한다.
test('커맨드 문서가 4필드 밖 상태 키를 지시하지 않는다', () => {
  const docs = fs.readdirSync(path.join(root, 'commands')).map((f) => `commands/${f}`);
  for (const d of [...docs, 'RULES.md']) {
    const src = read(d);
    for (const line of src.split('\n')) {
      // 폐기·금지를 "설명하는" 줄은 예외 (지시가 아니라 경고다)
      if (/더 쓰지 않는다|제거|쓰지 말|bkit|거부한다/.test(line)) continue;
      for (const dead of ['nextAction', 'matchRates', 'docs:', 'gates', 'phase']) {
        assert.ok(
          !line.includes(`\`${dead}\``) && !line.includes(`${dead}\`에`),
          `${d}: 폐기된 상태 키 "${dead}" 지시가 남아 있다 — 게이트가 그 쓰기를 거부한다\n  ${line.trim()}`,
        );
      }
    }
  }
});

// /kit 도움말은 사용자가 보는 유일한 커맨드·훅 지도다. 강제 장치가 생겼는데 여기가 그대로면
// "왜 차단됐는지" 찾을 곳이 없다.
test('/kit 도움말이 review 필수화와 PDCA 게이트를 담는다', () => {
  const src = read('commands/kit.md');
  const help = src.slice(src.indexOf('## 인자 없음'));
  assert.match(help, /\/review[^\n]*REVIEW\.md|\/review[^\n]*필수/, '도움말의 /review 설명이 옛 역할');
  assert.match(help, /PreToolUse[\s\S]{0,200}PDCA 게이트/, '훅 목록에 PDCA 게이트 없음');
});

// ── Q3: 플러그인 경로 RULES.md Read 지시 제거 (D10 권한 마찰) ────
// permissions.allow에서 ${CLAUDE_PLUGIN_ROOT} 확장은 미확인이고, 절대경로는 사용자마다 달라
// 팀 배포가 불가능하다. "읽어라"는 지시는 실행되지 않는다(D8) — 안 읽게 만들고 요약을 본문에 박는다.
test('Q3: 에이전트가 플러그인 경로 RULES.md를 Read하지 않는다', () => {
  for (const a of DOC_AGENTS) {
    assert.doesNotMatch(
      read(`agents/${a}.md`),
      /CLAUDE_PLUGIN_ROOT\}?\/RULES\.md/,
      `${a}: 플러그인 경로 RULES.md Read 지시가 남아 있다(권한 마찰)`,
    );
  }
});

test('Q3: 규칙이 필요한 에이전트는 AGENTS.md 대체 경로를 갖는다', () => {
  for (const a of ['architect', 'code-reviewer', 'gap-detector']) {
    assert.match(read(`agents/${a}.md`), /AGENTS\.md/, `${a}: AGENTS.md 대체 경로 없음`);
  }
});

// 드리프트 대비: 본문에 박은 요약이 지워지면 여기서 깨진다(DESIGN §8 완화 (b)).
test('Q3: 본문 리터럴 요약이 유지된다', () => {
  const architect = read('agents/architect.md');
  for (const re of [/features\//, /shared\//, /\.tsx/, /200줄/]) {
    assert.match(architect, re, `architect: 구조 요약 누락 ${re}`);
  }
  const reviewer = read('agents/code-reviewer.md');
  for (const re of [/네이밍/, /any/, /swallow/]) {
    assert.match(reviewer, re, `code-reviewer: 규칙 요약 누락 ${re}`);
  }
});
