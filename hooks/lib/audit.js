// devkit 관측성 — 가드 훅의 차단/이벤트를 프로젝트 `.devkit/audit.jsonl`에 append(JSONL).
// 관측성 기록이 훅 자체를 죽이면 안 되므로, 실패 시 stderr에 남기고 계속한다(swallow 아님, degrade).
const fs = require('node:fs');
const path = require('node:path');
const { findProjectRoot } = require('./project-root');
const { maskSecrets } = require('./receipt');
const { warn } = require('./diag');

/**
 * 이벤트의 **모든 문자열 값**을 마스킹한 사본을 돌려준다.
 *
 * 필드 이름으로 고르지 않는 이유: 어느 훅이 어떤 필드에 시크릿을 담을지 모른다.
 * 실측 — bash-guard가 `.env` 쓰기를 차단하면서 그 명령의 Anthropic 키를 `command`에
 * 평문으로 남겼다. 차단은 성공했는데 유출 경로가 새로 생긴 셈이었다.
 *
 * @returns 같은 모양의 새 객체(원본은 건드리지 않는다)
 */
function maskDeep(v) {
  if (typeof v === 'string') return maskSecrets(v);
  if (Array.isArray(v)) return v.map(maskDeep);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, maskDeep(val)]));
  }
  return v;
}

function record(event) {
  try {
    const root = findProjectRoot(process.cwd());
    const dir = path.join(root, '.devkit');
    fs.mkdirSync(dir, { recursive: true });
    // ts는 마스킹 대상이 아니므로 바깥에 둔다(패턴이 타임스탬프를 건드릴 일은 없지만 명시).
    const line = JSON.stringify({ ts: new Date().toISOString(), ...maskDeep(event) }) + '\n';
    fs.appendFileSync(path.join(dir, 'audit.jsonl'), line);
  } catch (e) {
    warn(`audit 기록 실패: ${e.message}`);
  }
}

module.exports = { record };
