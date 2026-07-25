#!/usr/bin/env node
// PreToolUse(Write|Edit): PDCA 산출물 선행조건 + 상태 스키마 강제. exit 2 → 거부.
// ⚠ 훅 자체의 오류(파싱 실패·예상 못한 입력)가 차단으로 이어지면 안 된다 — 판정할 수 없으면 통과시킨다.
// 판정 로직은 전부 lib/pdca-state.js의 순수함수에 있다. 여기엔 분기 판정을 두지 않는다.
const fs = require('node:fs');
const path = require('node:path');
const { record } = require('./lib/audit');
const {
  matchCycleArtifact, isStateFile, gatePrerequisite, validateStateWrite,
} = require('./lib/pdca-state');
const { readBehaviors } = require('./lib/behaviors');
const { gateEvidence } = require('./lib/evidence');
const { findProjectRoot } = require('./lib/project-root');

function deny(reason, file, tag) {
  record({ hook: 'pdca-gate', action: 'blocked', reason: tag, file });
  process.stderr.write(`[devkit] PDCA 게이트 차단 — ${reason}\n대상: ${file}\n`);
  process.exit(2);
}

function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8')); // 실패 → catch → exit 0
  const ti = input?.tool_input;
  const file = ti?.file_path;
  if (!file || typeof file !== 'string') return; // ① fail-open
  const isAbs = path.isAbsolute(file);
  const abs = isAbs ? file : path.resolve(input.cwd || process.cwd(), file);

  const hit = matchCycleArtifact(abs);
  if (hit) {
    const cycleDir = path.dirname(abs);
    // ② fail-open — 상대경로일 때만. cwd를 잘못 잡으면 폴더 부재가 오탐이 되지만,
    // Write 도구는 절대경로를 요구하므로 절대경로의 폴더 부재는 "선행 산출물 0개"일 뿐이다.
    // 절대경로까지 통과시키면 "폴더를 안 만들고 바로 REPORT.md를 쓴다"로 게이트가 무력화된다.
    if (!isAbs && !fs.existsSync(cycleDir)) return;
    const g = gatePrerequisite(cycleDir, hit.stage);
    if (!g.ok) deny(g.reason, file, `prereq:${hit.stage}:${g.missing.join(',')}`);

    // ⑤ fail-open — GAP.md는 "unresolved가 있다"를 보고하는 것이 정상 산출이라 게이트하지 않는다
    if (hit.stage !== 'report') return;
    const doc = readBehaviors(cycleDir);
    if (!doc) return; // ⑥ fail-open — 파일 없음·깨진 JSON = 판정 불가 = 통과
    const ev = gateEvidence(doc, findProjectRoot(cycleDir));
    if (!ev.ok) deny(`실행 흔적이 가리키는 파일이 없다\n${ev.reason}`, file, `evidence:${ev.unresolved.length}`);
    return;
  }

  if (isStateFile(abs)) {
    const raw = typeof ti.content === 'string' ? ti.content
      : typeof ti.new_string === 'string' ? ti.new_string : null;
    if (raw === null) return; // ③ fail-open
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      return; // ④ fail-open — Edit 조각·깨진 JSON은 판정 대상이 아니다
    }
    const v = validateStateWrite(obj);
    if (!v.ok) deny(v.reason, file, `state:${v.problems.length}`);
  }
}

try {
  main();
} catch (e) {
  // swallow 아님 — 기록하고 통과시킨다(차단이 훅 버그의 결과가 되면 안 된다)
  process.stderr.write(`[devkit] pdca-gate 오류: ${e.message}\n`);
}
process.exit(0);
