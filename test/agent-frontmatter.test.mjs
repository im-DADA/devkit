// 에이전트 model·effort 교체 — `/kit setup`이 플러그인 `agents/*.md`를 고치는 경로(A).
//
// 설계: docs/2026-09-21-devkit-config/DESIGN.md §1-⑦⑧·§3.3
//
// 실측(CC 2.1.278): 플러그인 에이전트도 frontmatter의 `model`·`effort`는 **유효**하다.
// 무시되는 것은 `permissionMode`·`hooks`·`mcpServers` 셋뿐이고, `effort`의 허용값은
// `low|medium|high|xhigh|max` 또는 정수다. 사용자 디렉터리 사본은 오버라이드가 아니다 —
// 플러그인 에이전트는 `devkit:architect`처럼 이름이 갈리므로 별개 에이전트가 된다.
//
// 이 모듈이 지켜야 하는 것 하나: **본문을 건드리지 않는다.** frontmatter 파싱이 어긋나면
// 에이전트가 통째로 망가지므로, 바뀌는 줄이 정확히 둘임을 바이트로 고정한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dir, '..');
const require_ = createRequire(import.meta.url);
const { EFFORTS, readModel, applyModel, validateEffort, validateModel, modelDriftMessage } =
  require_(path.join(root, 'hooks', 'lib', 'agent-frontmatter.js'));
const { DEFAULTS, AGENTS, mergeConfig } = require_(path.join(root, 'hooks', 'lib', 'config-schema.js'));

const agentMd = (name) => fs.readFileSync(path.join(root, 'agents', `${name}.md`), 'utf8');

// ── U14: 허용값 (B22) ─────────────────────────────────────────
test('U14: effort 허용값은 문자열 5종과 양의 정수뿐이다', () => {
  for (const ok of ['low', 'medium', 'high', 'xhigh', 'max', 1, 7]) {
    assert.equal(validateEffort(ok), true, `${JSON.stringify(ok)}가 거부됐다`);
  }
  for (const bad of ['turbo', '', 'MAX', 0, -1, 1.5, null, undefined, {}, []]) {
    assert.equal(validateEffort(bad), false, `${JSON.stringify(bad)}가 통과했다`);
  }
});

test('U14b: model은 형태만 본다 — 이름을 열거하면 그 목록이 낡는다', () => {
  assert.equal(validateModel('opus'), true);
  assert.equal(validateModel('claude-opus-5'), true, '새 모델 이름이 막히면 목록이 낡은 것이다');
  // ⚠ `inherit`은 2026-10-02에 거부 → **허용**으로 뒤집었다. 이것은 **사용자 설정 축**의 허용이다.
  //    devkit이 출하하는 `agents/*.md`에는 여전히 금지이고 그 금지는 `agent-contract.test.mjs`의
  //    `M1`이 지킨다 — **두 층이 다르다.** 뒤집은 이유: `mergeConfig`는 이미 `inherit`을 받고
  //    있었는데(스키마의 `isName` 통과) 여기서만 거부해 그 에이전트가 **조용히 건너뛰어졌다**.
  //    ⚠ `cli:'codex'`에 `inherit`을 금지하는 단언은 **여기 둘 수 없다** — `validateModel`은
  //    문자열 하나만 받아 형제 키 `cli`를 구조적으로 볼 수 없다. 그 계약은 `setup-plan`의
  //    `acceptCodexModel`에 있고 단언은 `test/setup-plan.test.mjs`의 S24다.
  assert.equal(validateModel('inherit'), true, '설정 축의 inherit이 막히면 적용이 조용히 건너뛴다');
  for (const bad of ['', '  ', 'two words', null, 3]) {
    assert.equal(validateModel(bad), false, `${JSON.stringify(bad)}가 통과했다`);
  }
});

// ── U21: inherit의 적용 계약 (B13) ─────────────────────────────
test('U21 B13: applyModel이 inherit을 쓰면 model 줄만 바뀌고 나머지는 바이트 그대로다', () => {
  const src = ['---', 'name: planner', 'description: 설명 한 줄', 'model: opus', 'effort: max',
    'tools: Read, Grep, Glob', '---', '', '본문 첫 줄', '본문 둘째 줄', ''].join('\n');
  // ⚠ 범위를 이름에 밝힌다: **effort 줄에 같은 값을 쓸 때** 바이트가 동일하다는 뜻이다.
  //    effort를 바꿔 넘기면 그 줄도 바뀌는 것이 정상이다(아래 양성 대조).
  const out = applyModel(src, { model: 'inherit', effort: 'max' });
  assert.equal(out.ok, true, out.reason);
  assert.equal(out.text.split('\n').length, src.split('\n').length, '줄 수가 바뀌었다');
  const before = src.split('\n'); const after = out.text.split('\n');
  for (let i = 0; i < before.length; i += 1) {
    if (i === 3) { assert.equal(after[i], 'model: inherit'); continue; }
    assert.equal(after[i], before[i], `${i}행이 바뀌었다 — model 줄만 바뀌어야 한다`);
  }
  // 양성 대조 — effort를 다르게 주면 그 줄도 바뀐다(위 단언이 공허하지 않다는 증거).
  const moved = applyModel(src, { model: 'inherit', effort: 'low' });
  assert.equal(moved.ok, true);
  assert.match(moved.text, /^effort: low$/m);
});

// ── U18: 기본값이 실물과 일치 (B18) ────────────────────────────
test('U18: DEFAULTS.models 8개가 실제 agents 파일의 frontmatter와 같다', () => {
  assert.equal(AGENTS.length, 8);
  for (const name of AGENTS) {
    const got = readModel(agentMd(name));
    assert.ok(got, `${name}.md에서 model·effort를 못 읽었다`);
    // ⚠ `cli`는 **frontmatter로 표현되지 않는 축**이다(Claude Code 전용 키가 아니다).
    // 그래서 실물 대조는 model·effort만 본다 — 이 비대칭은 의도된 것이다.
    const { model, effort } = DEFAULTS.models[name];
    assert.deepEqual(got, { model, effort }, `${name}: 기본값이 실물과 어긋났다`);
  }
});

test('U19: INTEGRITY.sha256은 agents/를 덮지 않는다', () => {
  // 이 사실 위에 "gen-integrity를 돌리지 않는다"는 결정이 서 있다(DESIGN Q1).
  // TARGET_DIRS에 agents가 추가되면 이 테스트가 빨개져 그 결정을 다시 보게 된다.
  const manifest = fs.readFileSync(path.join(root, 'INTEGRITY.sha256'), 'utf8');
  const lines = manifest.trim().split('\n').filter(Boolean);
  assert.ok(lines.length > 10, '매니페스트가 비었다 — 이 테스트의 전제가 깨졌다');
  assert.equal(lines.filter((l) => /\sagents\//.test(l)).length, 0);
});

// ── U15~U17: 교체 (B19·B22) ───────────────────────────────────
test('U15: 적용하면 model·effort 두 줄만 다르다 — 본문은 그대로다', () => {
  const before = agentMd('planner');
  // ⚠ 두 값이 **현재 값과 둘 다 달라야** "2줄 변경"이 성립한다. 리터럴을 박으면
  // 기본 배분이 바뀔 때 이 테스트가 1줄로 깨진다(2026-10-01 planner fable→opus에서 실제로 깨졌다).
  const now = readModel(before);
  const target = { model: now.model === 'opus' ? 'sonnet' : 'opus',
    effort: now.effort === 'high' ? 'low' : 'high' };
  const r = applyModel(before, target);
  assert.equal(r.ok, true, r.reason);

  const a = before.split('\n');
  const b = r.text.split('\n');
  assert.equal(a.length, b.length, '줄 수가 바뀌었다 — 줄을 추가하거나 지웠다');
  const diff = a.map((l, i) => (l === b[i] ? null : i)).filter((i) => i !== null);
  assert.equal(diff.length, 2, `${diff.length}줄이 바뀌었다 — 정확히 2줄이어야 한다`);
  assert.deepEqual(readModel(r.text), target);
  // 본문(frontmatter 밖)이 한 글자도 안 바뀌었는지 바이트로 본다
  const body = (s) => s.slice(s.indexOf('\n---', 3));
  assert.equal(Buffer.compare(Buffer.from(body(before)), Buffer.from(body(r.text))), 0);
});

test('U15b: 기본값을 그대로 적용해도 원문과 바이트 동일하다 (B18)', () => {
  const before = agentMd('planner');
  const r = applyModel(before, DEFAULTS.models.planner);
  assert.equal(r.ok, true);
  assert.equal(Buffer.compare(Buffer.from(before), Buffer.from(r.text)), 0,
    '같은 값을 써도 파일이 달라진다 — 되돌리기가 원상복구되지 않는다');
});

test('U16: 허용값 밖이면 텍스트를 아예 돌려주지 않는다 (B22)', () => {
  const r = applyModel(agentMd('planner'), { model: 'opus', effort: 'turbo' });
  assert.equal(r.ok, false);
  assert.equal('text' in r, false, '호출자가 쓸 수 있는 텍스트를 줬다 — 잘못된 값이 파일에 들어간다');
  assert.match(r.reason, /effort/);
});

test('U17: model 줄이 없으면 추가하지 않고 거부한다', () => {
  const noModel = '---\nname: x\ndescription: y\ntools: Read\n---\n\n# X\n';
  const r = applyModel(noModel, { model: 'opus', effort: 'high' });
  assert.equal(r.ok, false, '형태가 다른 파일에 줄을 추가했다 — 파싱을 못 믿는다는 뜻이다');
  assert.equal(readModel(noModel), null);
});

test('U17b: frontmatter 밖의 model: 문자열은 건드리지 않는다', () => {
  const md = agentMd('planner');
  const r = applyModel(md, { model: 'opus', effort: 'high' });
  // 본문에 "model:"이 나오는 줄이 있어도 frontmatter 안만 바뀐다(U15가 두 줄로 고정한다)
  assert.equal(r.ok, true);
  assert.equal(r.text.indexOf('---', 3) > 0, true);
});

// ── U20: 드리프트 안내 (B21) ──────────────────────────────────
test('U20: 설정과 실물이 같으면 침묵하고, 다르면 재적용을 안내한다', () => {
  const current = Object.fromEntries(AGENTS.map((n) => [n, readModel(agentMd(n))]));
  assert.equal(modelDriftMessage(DEFAULTS, current), '', '일치하는데 경고가 떴다 — 매 세션 노이즈다');

  const cfg = mergeConfig({ version: 1, models: { planner: { model: 'opus', effort: 'high' } } }).config;
  const msg = modelDriftMessage(cfg, current);
  assert.match(msg, /planner/, '어느 에이전트가 풀렸는지 말해야 한다');
  assert.match(msg, /--reapply/, '고치는 방법이 없으면 교착이다');
});

test('U20b: 읽지 못한 에이전트는 드리프트로 보고하지 않는다', () => {
  // 파일을 못 읽는 것과 값이 다른 것은 다르다. 못 읽은 것을 "풀렸다"고 하면
  // 설치 경로가 다른 환경에서 매 세션 거짓 경고가 뜬다.
  const cfg = mergeConfig({ version: 1, models: { planner: { model: 'opus', effort: 'high' } } }).config;
  assert.equal(modelDriftMessage(cfg, { planner: null }), '');
});

// ── 🔴 리뷰 1회차: 치환 문자열의 특수 패턴 ────────────────────────
// `String.replace`의 **치환 문자열**에서 `$&`·`` $` ``·`$1`은 특수 패턴이다. model 값은
// 사용자가 설정 파일에 적으므로 그대로 넣으면 frontmatter가 부서진다. 실측(리뷰 1회차):
//   model='$&'  → "model: model: fable"
//   model='$`'  → "model: ---"        ← frontmatter 파손
// 이 모듈의 존재 이유가 "파싱이 어긋나면 에이전트가 통째로 망가진다"인데 스스로 깨던 자리다.
test('🔴 치환 특수 패턴이 값으로 들어와도 frontmatter가 부서지지 않는다', () => {
  const md = fs.readFileSync(path.join(root, 'agents', 'planner.md'), 'utf8');
  for (const evil of ['$&', '$`', "$'", '$1', '$$']) {
    const r = applyModel(md, { model: evil, effort: 'high' });
    if (!r.ok) continue; // 거부도 정답이다 — 부서진 텍스트를 돌려주지만 않으면 된다
    const got = readModel(r.text);
    assert.deepEqual(got, { model: evil, effort: 'high' },
      `model=${JSON.stringify(evil)}가 치환 패턴으로 해석됐다: ${JSON.stringify(got)}`);
    assert.equal(r.text.split('\n').length, md.split('\n').length, '줄 수가 바뀌었다');
  }
});

// ── FM1~FM4: CLI 축이 생긴 뒤의 비대칭 (§8.4) ──────────────────
// `cli`는 **frontmatter로 표현되지 않는 축**이다. 그래서 두 목록이 갈린다:
// 설정 파일이 받는 effort(`config-schema.js`의 `isEffort`)에는 `ultra`가 있고,
// Claude Code frontmatter가 받는 값(`EFFORTS`)에는 **없다**. 갈린 것이 의도다.
const { SPEC } = require_(path.join(root, 'hooks', 'lib', 'config-schema.js'));

test('FM1 B17: EFFORTS에 ultra가 없고 설정 스키마에는 있다 — 두 목록이 갈린 것이 의도다', () => {
  assert.equal(EFFORTS.includes('ultra'), false,
    'ultra가 CC frontmatter 허용값에 들어갔다 — Codex effort가 applyModel을 타고 새면 에이전트가 망가진다');
  assert.deepEqual(EFFORTS, ['low', 'medium', 'high', 'xhigh', 'max']);
  // 양성 대조: 같은 값이 **설정 파일**에서는 유효하다(Codex 단계에 적을 수 있어야 한다).
  assert.equal(SPEC.models.planner.effort('ultra'), true);
  assert.equal(SPEC.models.planner.effort('turbo'), false);
});

test('FM2 B18: applyModel이 ultra를 거부하고 텍스트를 돌려주지 않는다', () => {
  const r = applyModel(agentMd('planner'), { model: 'gpt-6-astra', effort: 'ultra' });
  assert.equal(r.ok, false, 'Codex effort가 Claude frontmatter에 박혔다');
  assert.equal('text' in r, false);
  for (const allowed of EFFORTS) assert.ok(r.reason.includes(allowed), allowed);
});

test('FM3 B20: cli가 codex인 항목은 드리프트로 보고하지 않는다', () => {
  const cfg = { models: { planner: { cli: 'codex', model: 'gpt-6-astra', effort: 'ultra' } } };
  assert.equal(modelDriftMessage(cfg, { planner: { model: 'opus', effort: 'max' } }), '',
    'Codex 단계마다 매 세션 거짓 경고가 뜬다 — 그게 이 함수의 존재 이유를 스스로 깬다');
});

test('FM4 B21: cli가 claude거나 없으면 현행대로 보고한다 (양성 대조)', () => {
  const current = { planner: { model: 'opus', effort: 'max' } };
  const claude = modelDriftMessage({ models: { planner: { cli: 'claude', model: 'gpt-6-astra', effort: 'ultra' } } }, current);
  assert.match(claude, /planner/);
  // `cli` 키가 **없는** 옛 형태(마이그레이션 전 설정)도 그대로 보고한다.
  const legacy = modelDriftMessage({ models: { planner: { model: 'fable', effort: 'max' } } }, current);
  assert.match(legacy, /planner/);
  assert.match(legacy, /--reapply/);
  // 값이 같으면 cli가 claude여도 침묵한다(경고가 cli 때문에 켜지는 게 아니다).
  assert.equal(modelDriftMessage({ models: { planner: { cli: 'claude', model: 'opus', effort: 'max' } } }, current), '');
});

// ── FM5: inherit 적용 후 드리프트가 침묵한다 (B15) ─────────────
// DESIGN §3.2의 "effort 줄도 그대로 쓴다" 결정을 못박는다 — 안 쓰면 설정과 frontmatter가
// 영구히 갈려 `modelDriftMessage`가 **매 세션 거짓 경고**를 낸다(그 함수의 존재 이유를 깬다).
test('FM5 B15: inherit을 적용한 뒤 설정과 frontmatter가 일치해 드리프트가 침묵한다', () => {
  const src = ['---','name: planner','model: opus','effort: max','---','본문'].join('\n');
  const want = { cli: 'claude', model: 'inherit', effort: DEFAULTS.models.planner.effort };
  const out = applyModel(src, { model: want.model, effort: want.effort });
  assert.equal(out.ok, true, out.reason);
  const now = readModel(out.text);
  assert.equal(modelDriftMessage({ models: { planner: want } }, { planner: now }), '',
    'inherit을 적용했는데 드리프트 경고가 난다');
  // 양성 대조 — effort가 어긋나면 경고가 **있다**(위 단언이 "항상 침묵"으로 통과하지 않는다).
  assert.notEqual(modelDriftMessage({ models: { planner: { ...want, effort: 'low' } } }, { planner: now }), '');
});

test('FM6 B17: 한 에이전트가 거부돼도 나머지는 적용되고 그 파일은 바이트 그대로다', () => {
  // 🔴 "건너뛰고 나머지는 적용"이 문서 단어 존재뿐이었다(2026-10-02 Gap 1·2회차).
  //    커맨드가 도는 루프의 **원시 계약**을 여기서 실행으로 고정한다.
  const good = (name) => ['---', `name: ${name}`, 'model: opus', 'effort: max', '---', '본문'].join('\n');
  // ⚠ 거부 **한 종류**만 돌리면 나머지 경로는 무검증이다(2026-10-02 Gap 3회차: `validateModel`
  //    게이트를 지우면 공백이 든 이름이 frontmatter에 그대로 써지는데 행동 테스트가 0건이었다).
  //    `applyModel`이 거부해야 하는 네 가지를 전부 돈다.
  const REJECT = [
    { why: 'model 줄이 없다', src: ['---', 'name: n', 'effort: max', '---', '본문'].join('\n'), want: { model: 'inherit', effort: 'max' } },
    { why: 'frontmatter가 없다', src: '본문만 있다', want: { model: 'opus', effort: 'max' } },
    { why: 'model에 공백이 있다', src: good('n'), want: { model: 'two words', effort: 'max' } },
    { why: 'effort가 허용값 밖이다', src: good('n'), want: { model: 'opus', effort: 'nope' } },
  ];
  for (const { why, src, want } of REJECT) {
    const before = src;
    const r = applyModel(src, want);
    assert.equal(r.ok, false, `거부돼야 하는데 통과했다: ${why}`);
    assert.equal('text' in r, false, `실패한 에이전트의 텍스트를 돌려줬다 — 그 파일이 바뀐다: ${why}`);
    // ⚠ `assert.ok(r.reason)`은 **존재만** 본다 — 모든 사유를 'x'로 바꿔도 통과했다
    //    (2026-10-02 Gap 4회차). 사람이 읽고 고칠 수 있는 길이를 요구한다.
    assert.equal(typeof r.reason, 'string');
    assert.ok(r.reason.length >= 5, `사유가 너무 짧아 쓸모가 없다: ${JSON.stringify(r.reason)}`);
    // ⚠ `assert.equal(src, before)`는 **동어반복이었다**(JS 문자열은 불변이라 실패할 수 없다).
    //    "그 파일이 안 바뀐다"를 지키는 것은 **`text`를 안 돌려주는 것**이고 위에서 단언했다.
    void before;
  }
  // 그리고 **하나가 막아도 나머지는 적용된다** — 커맨드가 도는 루프의 원시 계약이다.
  const sources = { a: good('a'), b: REJECT[0].src, c: good('c') };
  const results = {};
  for (const [k, src] of Object.entries(sources)) results[k] = applyModel(src, { model: 'inherit', effort: 'max' });
  assert.equal(results.b.ok, false);
  for (const k of ['a', 'c']) {
    assert.equal(results[k].ok, true, `${k}가 함께 실패했다 — 하나가 막으면 안 된다`);
    assert.match(results[k].text, /^model: inherit$/m);
  }
});

