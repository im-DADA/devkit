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

// ── 확신에 찬 부정 금지 ───────────────────────────────────────
// 실사용 보고: 몇 군데 훑고 "안 된다"고 단정 → 실제로는 instrumentation.ts에 있었고,
// 지적받고도 확인 없이 두 번째 추측을 얹었다. 기존 "추측 금지"가 이걸 못 잡는 이유는
// 모델이 **찾아는 봤으니 추측이 아니라고 믿기** 때문이다 — 그 탐색이 준 근거는
// 세상이 아니라 자기 탐색에 대한 것이다. 그래서 별도 규칙이고, 별도 테스트다.
test('A1: 도메인·주장 형태를 안 가린다 (좁게 쓰면 그 도메인에서만 지켜진다)', () => {
  const rules = read('RULES.md');
  assert.match(rules, /확신에 찬 부정 금지/, 'RULES.md: 규칙 없음');
  // ⚠ 이게 이 테스트의 핵심이다. 처음 쓸 때 사례가 마이그레이션이라 규칙까지
  // "부재(없다)" + "마이그레이션"으로 좁아졌다 — 사용자가 그 자리에서 잡았다.
  for (const form of ['안 된다', '불가능', '지원 안 한다']) {
    assert.match(rules, new RegExp(form), `RULES.md: 부정 형태 "${form}"가 대상에서 빠졌다`);
  }
  assert.match(rules, /도메인도 가리지 않는다|도메인 무관/, 'RULES.md: 도메인 일반성이 없다');
  assert.match(rules, /규칙은 마이그레이션 규칙이 아니다/, 'RULES.md: 사례가 규칙을 좁히는 것을 막는 문장이 없다');
});

// 목록은 외우는 순간 그 목록 밖에서 뚫린다. 도메인 무관한 판정법이 있어야 한다.
test('A2: 체크리스트가 아니라 판정법을 준다', () => {
  const rules = read('RULES.md');
  assert.match(rules, /틀리려면 무엇이 있어야 하나/, 'RULES.md: 도메인 무관 판정법이 없다');
  assert.match(rules, /찾아는 봤으니 추측이 아니다/, 'RULES.md: 이 규칙이 따로 필요한 이유가 없다');
  assert.match(rules, /숨는 자리는 도메인마다 다르므로/, 'RULES.md: 목록이 판정법 자리를 차지하고 있다');
});

test('A3: 보고 형식과 사용자 우위를 명시한다', () => {
  const rules = read('RULES.md');
  assert.match(rules, /어디까지 봤는데 안 나왔다/, 'RULES.md: 부정 보고 형식이 없다');
  assert.match(rules, /내 탐색 결과보다 강한 증거/, 'RULES.md: 사용자 진술이 우선한다는 문장이 없다');
  const summary = (rules.match(/<!-- SUMMARY:START -->([\s\S]*?)<!-- SUMMARY:END -->/) || [])[1];
  assert.ok(summary, 'SUMMARY 블록 없음');
  assert.match(summary, /확신에 찬 부정/, 'SUMMARY: 매 세션 보이는 자리에 없다');
  assert.match(summary, /안 된다/, 'SUMMARY: 부재로만 좁아졌다');
});

// gap-detector는 직업 자체가 부정 판정(❌ 누락)이라 이 실패의 진앙이다.
test('A4: gap-detector가 ❌ 누락을 주기 전에 탐색 범위를 되묻게 한다', () => {
  const src = read('agents/gap-detector.md');
  assert.match(src, /"없음"은 "못 찾음"보다 훨씬 비싼 주장/, 'gap-detector.md: 부정 경고 없음');
  assert.match(src, /어디를 봤는지/, 'gap-detector.md: 탐색 범위 자문 문장 없음');
});

// ── 의존성 규칙은 양면이어야 한다 ─────────────────────────────
// 실사용 보고: "패키지 추가는 승인이 필요하니 없는 방향으로 만들겠습니다"라며 설계를 조용히
// 좁혔다. 원인은 규칙이 **추가에만 비용을 매기는 한쪽 문장**이었다는 것 — 그러면 게이트를
// 안 건드리는 설계가 가장 싼 길이 된다. dep-guard 훅은 `pnpm add`를 실제로 시도해야
// 발동하므로, 이 실패 모드에서는 훅이 원리적으로 안 보인다. 문장으로만 막을 수 있다.
test('D1: 의존성 규칙이 "우회 금지"까지 말한다 (한쪽 면이면 우회가 최적해가 된다)', () => {
  const rules = read('RULES.md');
  const summary = (rules.match(/<!-- SUMMARY:START -->([\s\S]*?)<!-- SUMMARY:END -->/) || [])[1];
  assert.ok(summary, 'SUMMARY 블록 없음');
  for (const [src, where] of [[summary, 'RULES SUMMARY'], [rules, 'RULES.md']]) {
    assert.match(src, /우회|조용히/, `${where}: 의존성 우회를 금지하는 문장이 없다`);
  }
  assert.match(rules, /선택지가 있었다는/, 'RULES.md: 우회의 비용(사용자가 모른다)이 없다');
});

test('D2: architect가 승인 비용을 트레이드오프로 쓰지 못하게 한다', () => {
  const src = read('agents/architect.md');
  assert.match(src, /승인 비용은 트레이드오프가 아니다/, 'architect.md: 승인 비용 배제 문장 없음');
  assert.match(src, /대가/, 'architect.md: 의존성 없이 갈 때의 대가를 적으라는 문장 없음');
});

test('D3: dep-guard 차단 메시지가 우회를 막는다', () => {
  const src = read('hooks/dep-guard.js');
  assert.match(src, /라이브러리 없는 설계로 돌아가지/, 'dep-guard.js: 우회 금지 문장 없음');
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

// ── B8: node 런타임 의존성이 명시된다 ────────────────────────────
// 훅도 검증 스크립트도 전부 node다. Python·Go 전용 프로젝트에도 필요한데(테스트는 그 러너로,
// evidence 검증 층은 node) 어디에도 안 적혀 있었다 — 안 깔린 환경에선 층 전체가 안 돈다.
test('B8: README가 Node 런타임 요구를 명시한다', () => {
  const src = read('README.md');
  assert.match(src, /##\s*요구사항/, 'README에 요구사항 절이 없다');
  const need = src.slice(src.indexOf('## 요구사항'), src.indexOf('##', src.indexOf('## 요구사항') + 3));
  assert.match(need, /Node\s*20\+?/i, '요구사항 절에 Node 버전이 없다');
  assert.match(need, /러너|python|go|pytest/i, '비-Node 프로젝트에도 필요하다는 사실이 없다');
  assert.match(src, /scripts\/verify-evidence\.mjs/, '구성 표에 verify-evidence.mjs가 빠져 있다');
});

test('B8: /kit 도움말이 Node 런타임 요구를 명시한다', () => {
  const help = read('commands/kit.md');
  const body = help.slice(help.indexOf('## 인자 없음'));
  assert.match(body, /Node\s*20\+?/i, '/kit 도움말에 Node 버전 요구가 없다');
});

// ── B7: 러너별 lcov 표 (두 벌 + 드리프트 방지) ──────────────────
// 두 벌인 이유: gap.md는 사용자가, gap-detector.md는 **명령을 고르는 주체**가 읽는다.
// 한쪽에만 두면 다른 쪽이 못 쓴다(D8). 구조로 한 벌 만드는 방법(커맨드가 Task 프롬프트에
// 명령을 실어 넘기기)은 /gap의 위임 구조를 손대는 변경이라 별도 사이클로 미뤘다 — 그동안의
// 드리프트를 이 테스트가 막는다.
// 전제: 이 두 문서에서 `| **`로 시작하는 표 행은 러너 표뿐이다(다른 표가 생기면 여기서 깨진다).
// 들여쓰기는 무시한다 — 두 문서에서 표가 들어가는 목록 깊이가 다를 수 있고, 계약은 행의 내용이다.
const runnerRows = (src) => src.split('\n').filter((l) => /^\s*\|\s*\*\*/.test(l)).map((l) => l.trim());

test('B7: 러너별 lcov 표가 /gap과 gap-detector에서 같은 행 집합이다', () => {
  const cmd = runnerRows(read('commands/gap.md'));
  const agent = runnerRows(read('agents/gap-detector.md'));

  assert.ok(cmd.length >= 4, `러너 표 행이 ${cmd.length}건이다 — 표가 없거나 비었다`);
  assert.deepEqual(cmd, agent, '두 문서의 러너 표가 갈렸다 — 한쪽만 고치면 다른 쪽이 못 쓴다');
  for (const row of cmd) {
    assert.match(row, /\.devkit\/lcov\.info/, `행이 공통 계약(산출 경로)을 안 밝힌다:\n  ${row}`);
  }
});

// ⚠ 실측 안 한 명령을 리터럴로 박지 않는다 — 틀린 명령을 박는 건 안 적는 것보다 나쁘다.
// 실측한 것만 명령 전문이고, 나머지는 도구 이름과 산출 경로까지만 적고 그 사실을 표시한다.
test('B7: 실측하지 않은 러너 행은 미실측임을 밝힌다', () => {
  const rows = runnerRows(read('commands/gap.md'));
  const measured = rows.filter((r) => !/미실측/.test(r));
  assert.ok(measured.length >= 1, '실측한 러너가 한 건도 없다');
  for (const r of measured) {
    // 러너 무관 조건이다. node:test의 플래그를 '명령 전문'의 정의로 박으면, 다음 사람이 vitest를
    // **실측해서 참인 명령을 적는 순간** RED가 난다 — 정직한 행동이 벌받고 남는 선택지가
    // '미실측 영구 유지' 아니면 '가짜 node 플래그 삽입'뿐이 된다(REVIEW 2회차 🟡3, 실측 확인).
    assert.match(r, /`[^`]*\.devkit\/lcov\.info[^`]*`/, `실측 행인데 명령 전문이 없다:\n  ${r}`);
  }
});

// ── Q3: 플러그인 경로 RULES.md Read 지시 제거 (D10 권한 마찰) ────
// 근거 셋 중 둘은 죽었다: `${CLAUDE_PLUGIN_ROOT}` 확장은 공식 문서(plugins-reference)와 라이브
// 실측으로 **된다**고 확인됐고, "절대경로라 팀 배포 불가"는 변수를 쓰면 해소된다. 남은 둘이
// 결론을 그대로 지탱한다 — **D10**(프로젝트 밖 파일 Read마다 승인 프롬프트가 뜬다)과
// **D8**("참조하라"는 지시는 실행되지 않는다. 리터럴로 박아야 한다).
// 그래서 Bash 실행(치환되고 권한 마찰 없음)은 플러그인 경로로 통일하고, 파일 Read는 반대로
// 본문 리터럴 1차 + 프로젝트 AGENTS.md 2차로 통일한다. 같은 변수인데 방향이 반대인 이유다.
// 근거가 죽었는데 결론만 남은 주석은 다음 사람을 잘못된 전제로 이끈다 — 그 자체가 회귀 위험이라
// 주석도 계약으로 본다. 주석은 실행되지 않아 보통은 RED를 못 내므로, 소스를 읽어서 단언한다.
test('Q3: 근거 주석이 살아 있는 근거만 든다', () => {
  const src = read('test/agent-contract.test.mjs');
  const start = src.indexOf('// ── Q3:');
  assert.ok(start > 0, 'Q3 근거 주석 블록이 없다');
  const block = src.slice(start, src.indexOf('test(', start));

  for (const re of [/D10/, /D8/]) {
    assert.match(block, re, `Q3 근거 주석에 살아 있는 근거 ${re}가 없다`);
  }
  assert.doesNotMatch(
    block,
    /확장은? ?미확인|미확인이고/,
    'Q3 근거 주석이 죽은 근거를 든다 — ${CLAUDE_PLUGIN_ROOT} 확장은 공식 문서와 라이브 실측으로 확인됐다',
  );
});

// 전수다. 4개만 검사하는 동안 나머지 3개(tdd-driver·test-writer·feature-builder)가
// 플러그인 경로를 그대로 쓰고 있었다 — 같은 근거가 7개 전부에 적용되는데 분모가 좁았다.
const ALL_AGENTS = fs.readdirSync(path.join(root, 'agents'))
  .filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));

test('Q3: 에이전트가 플러그인 경로 RULES.md를 Read하지 않는다 (agents/ 전수)', () => {
  assert.ok(ALL_AGENTS.length >= 7, `agents/ 스캔이 비었다: ${ALL_AGENTS.length}개`);
  for (const a of ALL_AGENTS) {
    assert.doesNotMatch(
      read(`agents/${a}.md`),
      /CLAUDE_PLUGIN_ROOT\}?\/RULES\.md/,
      `${a}: 플러그인 경로 RULES.md Read 지시가 남아 있다(권한 마찰)`,
    );
  }
});

// 금지(위)는 7개 전수이지만 대체 경로는 6개다 — report-writer는 규칙 접근이 애초에 없다
// (REPORT 작성에 팀 코드 규칙이 필요 없다는 판단). 분모를 다르게 두는 이유를 여기 남긴다.
const RULE_AGENTS = ALL_AGENTS.filter((a) => a !== 'report-writer');

test('Q3: 규칙이 필요한 에이전트는 AGENTS.md 대체 경로를 갖는다', () => {
  assert.equal(RULE_AGENTS.length, ALL_AGENTS.length - 1, 'report-writer 제외 분모가 어긋났다');
  for (const a of RULE_AGENTS) {
    assert.match(read(`agents/${a}.md`), /AGENTS\.md/, `${a}: AGENTS.md 대체 경로 없음`);
  }
});

// 1차 방어는 AGENTS.md가 아니라 **본문 리터럴**이다. "참조하라"는 지시는 실행되지 않고(D8),
// /kit init을 안 돌린 프로젝트엔 AGENTS.md 자체가 없다 — 그때 남는 건 이 요약뿐이다.
// 이 테스트가 §1.4의 "1차 = 본문 리터럴"을 지키는 유일한 장치다.
test('Q3: 본문 리터럴 요약이 유지된다', () => {
  const architect = read('agents/architect.md');
  for (const re of [/features\//, /shared\//, /\.tsx/, /200줄/]) {
    assert.match(architect, re, `architect: 구조 요약 누락 ${re}`);
  }
  const reviewer = read('agents/code-reviewer.md');
  for (const re of [/네이밍/, /any/, /swallow/]) {
    assert.match(reviewer, re, `code-reviewer: 규칙 요약 누락 ${re}`);
  }
  // tdd-driver·test-writer는 이미 갖고 있었다(계약 카탈로그 / 대상×방식 표) — 회귀만 막는다.
  const tdd = read('agents/tdd-driver.md');
  for (const re of [/멱등성/, /경계값/, /UI[·\s]*(마크업)?.*TDD 대상이 아니/]) {
    assert.match(tdd, re, `tdd-driver: 계약 카탈로그 요약 누락 ${re}`);
  }
  assert.match(read('agents/test-writer.md'), /유닛 X|유닛 테스트가 없는 게 정상|시각 검증/, 'test-writer: 대상별 방식 표 누락');
  // feature-builder만 비어 있었다 — 정본은 RULES.md라며 구조·네이밍을 명시적으로 안 적었다.
  const builder = read('agents/feature-builder.md');
  for (const re of [/features\//, /shared\//, /hooks\//, /kebab-case/, /use[A-Z]|`use` ?접두/, /200줄/]) {
    assert.match(builder, re, `feature-builder: 구조·네이밍 리터럴 누락 ${re}`);
  }
});

// ── 테스트를 쓰는 에이전트는 evidence 층을 깨는 규칙을 본문에 갖는다 (REVIEW 1회차 🔴) ──
// 플러그인 RULES.md Read를 뺀 대가로 두 규칙이 도달 불가가 됐다: AGENTS.md의 "## 공통 규칙"은
// RULES의 SUMMARY 블록 그대로인데 둘 다 거기 없고, devkit 레포 자신엔 AGENTS.md가 아예 없다.
// 앞의 규칙은 어기면 그 테스트 줄이 evidence 인용으로 못 쓰여 uncited가 된다 — 직전 사이클의 결함이다.
test('B4: 테스트를 쓰는 에이전트는 인용 가능성·관측점 규칙을 본문에 갖는다', () => {
  for (const a of ['tdd-driver', 'test-writer']) {
    const src = read(`agents/${a}.md`);
    assert.match(src, /양옆을 공백으로 띄우지 마라/, `${a}: 테스트 이름 인용 가능성 규칙 누락`);
    assert.match(src, /바깥 관측점/, `${a}: 관측점 규칙 누락`);
  }
});
