// 설정에 따른 RULES 주입 렌더링 — 줄 제거(renderSummary·renderCodex) + 설정 노트.
//
// 설계: docs/2026-09-21-devkit-config/DESIGN.md §3.2·§6.4·§9
//
// 이 파일이 지키는 가장 중요한 것은 **항등식**이다: 설정이 기본값이면 렌더링 결과가 원문과
// 바이트 단위로 같다. 그게 "설정 안 한 사람은 지금과 100% 동일"의 기계 증명이고(B1·B2),
// 구현 전 스냅샷을 커밋해 두는 것보다 강하다 — 스냅샷은 고쳐 쓰면 그만이지만 항등식은
// 고칠 수 없다(rules-sync.js:10-13이 경계한 "따로 보관해 낡는 지문"도 피한다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const dir = path.dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { renderSummary, renderCodex, renderSettingsNote, SUMMARY_MAP, CODEX_MAP } =
  require_(path.join(dir, '..', 'hooks', 'lib', 'rules-render.js'));
const { DEFAULTS, mergeConfig } = require_(path.join(dir, '..', 'hooks', 'lib', 'config-schema.js'));

/** 실제 RULES.md의 블록 원문 — 가짜 블록으로 테스트하면 매핑이 실물과 맞는지 영영 검증되지 않는다 */
function block(name) {
  const md = fs.readFileSync(path.join(dir, '..', 'RULES.md'), 'utf8');
  const m = md.match(new RegExp(`<!-- ${name}:START -->\\n([\\s\\S]*?)\\n<!-- ${name}:END -->`));
  assert.ok(m, `RULES.md에 ${name} 마커가 없다`);
  return m[1].trim();
}
const SUMMARY = block('SUMMARY');
const CODEX = block('CODEX');
const cfg = (patch) => mergeConfig(patch).config;

// ── U9: 매핑 생존 — 이 파일의 첫 테스트여야 한다 ──────────────────
// ⚠ **이게 빨개지면 RULES.md의 문구가 바뀐 것이다.** 매핑 정규식은 문구에 붙어 있어서,
// 문구가 바뀌면 매치 0건 → 제거 0건 → **설정이 조용히 안 먹는다**(침묵 no-op).
// "1건 이상"이 아니라 "정확히 1건"을 요구하는 이유: 문구가 복제돼 2건이 되면 엉뚱한 줄이
// 같이 지워진다. 이 테스트를 지우면 렌더링 전체가 조용히 죽는다.
test('U9: SUMMARY 매핑이 전부 실물에서 정확히 1건 매치된다', () => {
  const lines = SUMMARY.split('\n');
  for (const e of SUMMARY_MAP) {
    const hits = lines.filter((l) => e.match.test(l));
    assert.equal(hits.length, 1, `SUMMARY_MAP[${e.key}]가 ${hits.length}건 매치 — RULES.md 문구가 바뀌었다`);
  }
});

test('U9: CODEX 매핑이 전부 실물에서 정확히 1건 매치된다', () => {
  const lines = CODEX.split('\n');
  for (const e of CODEX_MAP) {
    const hits = lines.filter((l) => e.match.test(l));
    assert.equal(hits.length, 1, `CODEX_MAP[${e.key}]가 ${hits.length}건 매치 — RULES.md 문구가 바뀌었다`);
  }
});

// ── U6·U7·U8: 항등식 (B1·B2) ───────────────────────────────────
test('U6: 기본값이면 SUMMARY 렌더링이 원문과 바이트 동일하다', () => {
  const out = renderSummary(SUMMARY, DEFAULTS);
  assert.equal(Buffer.compare(Buffer.from(out), Buffer.from(SUMMARY)), 0,
    '기본값인데 원문과 다르다 — 설정 안 한 사람의 동작이 바뀐다');
});

test('U7: 기본값이면 CODEX 렌더링이 원문과 바이트 동일하다', () => {
  assert.equal(Buffer.compare(Buffer.from(renderCodex(CODEX, DEFAULTS)), Buffer.from(CODEX)), 0);
});

test('U8: 기본값이면 설정 노트가 빈 문자열이다', () => {
  assert.equal(renderSettingsNote(DEFAULTS), '', '설정 안 한 사람에게 0바이트여야 한다');
});

// ── U10~U12: 제거 (B7·B14) ────────────────────────────────────
test('U10: pdca.enabled false면 PDCA 줄만 빠지고 나머지는 그대로다', () => {
  const before = SUMMARY.split('\n');
  const after = renderSummary(SUMMARY, cfg({ pdca: { enabled: false } })).split('\n');
  assert.ok(!after.some((l) => /🔄 PDCA 사이클:/.test(l)), 'PDCA 줄이 남아 있다');
  assert.equal(after.length, before.length - 1, `${before.length - after.length}줄이 사라졌다 — 1줄이어야 한다`);
  const removed = before.filter((l) => !after.includes(l));
  assert.equal(removed.length, 1);
});

test('U11: structure가 features가 아니면 feature 구조 줄이 빠진다', () => {
  const after = renderSummary(SUMMARY, cfg({ structure: 'components' }));
  assert.ok(!/^- Feature 구조:/m.test(after), 'feature 구조 줄이 남아 있다');
  assert.ok(/커밋: Conventional Commits/.test(after), '무관한 줄까지 지웠다');
});

test('U12: CODEX의 절 제거가 다음 헤딩 앞에서 멈춘다', () => {
  const after = renderCodex(CODEX, cfg({ pdca: { enabled: false } }));
  assert.ok(!/^## PDCA 사이클 — 구현자로서 할 일$/m.test(after), 'PDCA 절이 남아 있다');
  assert.ok(/^## 파일을 지키는 규칙/m.test(after), '다음 절까지 먹었다 — until이 안 멈췄다');
  assert.ok(/^## 공통$/m.test(after), '앞 절이 사라졌다');
});

test('U13: 어떤 설정에도 throw하지 않고 문자열을 돌려준다', () => {
  for (const patch of [{}, { pdca: { enabled: false } }, { structure: 'none' }, { testing: 'off' },
    { rules: { tsxLogic: false, naming: false } }, { commit: { convention: 'free', coAuthoredBy: 'allow' } }]) {
    const c = cfg(patch);
    assert.equal(typeof renderSummary(SUMMARY, c), 'string');
    assert.equal(typeof renderCodex(CODEX, c), 'string');
    assert.equal(typeof renderSettingsNote(c), 'string');
  }
});

// ── 설정 노트 (B15·B24) ───────────────────────────────────────
test('B15: 머지 전략이 기본이 아니면 노트에 값 한 줄이 뜬다', () => {
  const note = renderSettingsNote(cfg({ merge: { strategy: 'rebase' } }));
  assert.match(note, /머지 전략: rebase/);
  assert.ok(!/스쿼시/.test(note), '노트가 규칙을 설명하고 있다 — 값만 적어야 한다');
});

test('B24: SG2 — pdca.docs가 lite면 매 세션 보이는 고지가 생긴다', () => {
  assert.match(renderSettingsNote(cfg({ pdca: { docs: 'lite' } })), /검증 문서 게이트: lite/);
  assert.equal(/검증 문서 게이트/.test(renderSettingsNote(DEFAULTS)), false,
    '기본값에서 고지가 뜨면 노이즈다');
});

test('설정 노트는 기본값과 다른 항목만 담는다', () => {
  const note = renderSettingsNote(cfg({ merge: { strategy: 'merge' } }));
  assert.equal(note.split('\n').filter((l) => l.trim()).length, 1,
    '바꾸지 않은 항목까지 나열했다');
});

// ── 순수성 ───────────────────────────────────────────────────
test('renderSummary는 입력 문자열을 변형하지 않는다', () => {
  const copy = String(SUMMARY);
  renderSummary(SUMMARY, cfg({ pdca: { enabled: false } }));
  assert.equal(SUMMARY, copy);
});
