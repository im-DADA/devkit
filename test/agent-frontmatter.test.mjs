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
const { readModel, applyModel, validateEffort, validateModel, modelDriftMessage } =
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
  for (const bad of ['', '  ', 'two words', 'inherit', null, 3]) {
    assert.equal(validateModel(bad), false, `${JSON.stringify(bad)}가 통과했다`);
  }
});

// ── U18: 기본값이 실물과 일치 (B18) ────────────────────────────
test('U18: DEFAULTS.models 8개가 실제 agents 파일의 frontmatter와 같다', () => {
  assert.equal(AGENTS.length, 8);
  for (const name of AGENTS) {
    const got = readModel(agentMd(name));
    assert.ok(got, `${name}.md에서 model·effort를 못 읽었다`);
    assert.deepEqual(got, DEFAULTS.models[name], `${name}: 기본값이 실물과 어긋났다`);
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
  const r = applyModel(before, { model: 'opus', effort: 'high' });
  assert.equal(r.ok, true, r.reason);

  const a = before.split('\n');
  const b = r.text.split('\n');
  assert.equal(a.length, b.length, '줄 수가 바뀌었다 — 줄을 추가하거나 지웠다');
  const diff = a.map((l, i) => (l === b[i] ? null : i)).filter((i) => i !== null);
  assert.equal(diff.length, 2, `${diff.length}줄이 바뀌었다 — 정확히 2줄이어야 한다`);
  assert.deepEqual(readModel(r.text), { model: 'opus', effort: 'high' });
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
