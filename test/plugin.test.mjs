// devkit 정적 eval — 플러그인 무결성 회귀 방지.
// 파일 추가하다 frontmatter 누락, 훅 참조 깨짐, SUMMARY 마커 삭제 같은 것을 잡는다.
// 실행: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const ls = (d) => (fs.existsSync(path.join(root, d)) ? fs.readdirSync(path.join(root, d)) : []);
const frontmatter = (md) => (md.match(/^---\n([\s\S]*?)\n---/) || [, ''])[1];

function assertFrontmatterFields(rel) {
  const fm = frontmatter(read(rel));
  assert.match(fm, /name:/, `${rel}: name 없음`);
  assert.match(fm, /description:/, `${rel}: description 없음`);
}

test('plugin.json 필수 필드', () => {
  const p = JSON.parse(read('.claude-plugin/plugin.json'));
  for (const k of ['name', 'version', 'description']) assert.ok(p[k], `plugin.json: ${k} 없음`);
});

test('marketplace.json 플러그인 source 경로 유효', () => {
  const m = JSON.parse(read('.claude-plugin/marketplace.json'));
  assert.ok(Array.isArray(m.plugins) && m.plugins.length, 'plugins 비어있음');
  for (const pl of m.plugins) {
    assert.ok(fs.existsSync(path.join(root, pl.source)), `source 경로 없음: ${pl.source}`);
  }
});

test('모든 agents/*.md에 name·description', () => {
  const files = ls('agents').filter((f) => f.endsWith('.md'));
  assert.ok(files.length, 'agents 없음');
  for (const f of files) assertFrontmatterFields(`agents/${f}`);
});

test('모든 commands/*.md에 name·description', () => {
  const files = ls('commands').filter((f) => f.endsWith('.md'));
  assert.ok(files.length, 'commands 없음');
  for (const f of files) assertFrontmatterFields(`commands/${f}`);
});

test('모든 skills/*/SKILL.md 존재 + name·description', () => {
  const dirs = ls('skills').filter((d) => fs.statSync(path.join(root, 'skills', d)).isDirectory());
  assert.ok(dirs.length, 'skills 없음');
  for (const d of dirs) {
    const rel = `skills/${d}/SKILL.md`;
    assert.ok(fs.existsSync(path.join(root, rel)), `${rel} 없음`);
    assertFrontmatterFields(rel);
  }
});

test('hooks.json이 참조하는 스크립트가 모두 존재', () => {
  const refs = [...read('hooks/hooks.json').matchAll(/hooks\/([\w./-]+\.js)/g)].map((m) => m[1]);
  assert.ok(refs.length, '훅 참조 없음');
  for (const r of new Set(refs)) {
    assert.ok(fs.existsSync(path.join(root, 'hooks', r)), `참조된 훅 파일 없음: ${r}`);
  }
});

test('RULES.md SUMMARY 마커 존재(session-start.js 의존)', () => {
  const md = read('RULES.md');
  assert.match(md, /<!-- SUMMARY:START -->/, 'SUMMARY:START 없음');
  assert.match(md, /<!-- SUMMARY:END -->/, 'SUMMARY:END 없음');
});

// B3 회귀 방지: marketplace 엔트리 버전이 plugin.json보다 뒤처지면 사용자가 갱신을 못 받는다.
// 설치 시엔 plugin.json이 이기므로 조용히 어긋난 채로 방치되기 쉽다 — 사람 기억이 아니라 테스트로 고정한다.
test('marketplace.json 플러그인 엔트리 버전 == plugin.json 버전', () => {
  const pluginVersion = JSON.parse(read('.claude-plugin/plugin.json')).version;
  const entry = JSON.parse(read('.claude-plugin/marketplace.json')).plugins.find(
    (p) => p.name === 'devkit',
  );
  assert.ok(entry, 'marketplace.json에 devkit 엔트리 없음');
  assert.equal(
    entry.version,
    pluginVersion,
    `버전 불일치: marketplace=${entry.version} vs plugin.json=${pluginVersion}`,
  );
});

// 기능 추가(review 필수화 + PDCA 게이트)는 minor bump. 안 올리면 사용자가 갱신을 못 받는다.
test('plugin.json 버전이 0.11.0 이상', () => {
  const [major, minor] = JSON.parse(read('.claude-plugin/plugin.json'))
    .version.split('.')
    .map(Number);
  assert.ok(major > 0 || minor >= 11, 'review 게이트 기능이 들어갔는데 버전이 그대로다');
});

test('hooks.json에 UserPromptSubmit 등록(PDCA 자동 발동)', () => {
  const hooks = JSON.parse(read('hooks/hooks.json')).hooks;
  assert.ok(hooks.UserPromptSubmit, 'UserPromptSubmit 이벤트 없음');
  assert.match(JSON.stringify(hooks.UserPromptSubmit), /pdca-detect\.js/);
});

test('RULES.md에 PDCA 사이클 절 존재(규약 단일 소스)', () => {
  assert.match(read('RULES.md'), /^## PDCA 사이클$/m, 'PDCA 사이클 절 없음');
});
