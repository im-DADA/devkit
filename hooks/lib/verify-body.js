// status별로 **무엇을 본문에 실을지**. verify-classify.js에서 분리했다(200줄 규칙).
// verify-classify가 재수출하므로 기존 import 경로도 그대로 산다.
//
// 여기서 나오는 `items`가 사이클 B(delta)의 입력이다 — **절단되지 않은 전체**여야 한다.
// 절단이 delta보다 앞서면 41번째가 잘린 채 기준선에 들어가 다음 턴에 거짓 new가 난다.
// ⚠ 지연 require다. verify-classify가 이 모듈을 재수출하므로 최상위에서 부르면 순환이 되고,
// 그 시점엔 verify-classify의 module.exports가 아직 비어 있어 전부 undefined가 된다.

/** status별로 무엇을 본문에 실을지. found는 진단만, failed는 원인 원문 그대로 */
function bodyFor(kind, status, res) {
  const { stripAnsi, parseTscDiagnostics, clipDiagnostics } = require('./verify-classify');
  if (status === 'ok' || status === 'skipped' || status === 'unavailable') {
    return { text: '', total: 0, truncated: false, items: [], context: [] };
  }
  const out = `${stripAnsi(res.stdout)}\n${stripAnsi(res.stderr)}`;
  if (kind === 'typecheck') {
    const { source, compiler } = parseTscDiagnostics(out);
    const picked = status === 'found' ? source : compiler;
    if (picked.length) {
      const c = clipDiagnostics(picked.map((d) => d.raw));
      return { text: c.text, total: c.total, truncated: c.truncated, items: picked, context: [] };
    }
  }
  const c = clipDiagnostics(out.split('\n').filter((l) => l.trim()));
  return { text: c.text, total: c.total, truncated: c.truncated, items: diagLines(out), context: lines(out).map((i) => i.raw) };
}

/**
 * lint는 형식 파서가 없다 — 줄 자체가 진단 단위다(사이클 B 결정 5).
 * ⚠ 단 **위치 토큰이 있는 줄만** 진단으로 센다. eslint stylish의 꼬리(`✖ 2 problems …`)는
 * 개수가 바뀔 때마다 새 키가 되어 "새 진단 1건"이라는 거짓 신호를 매번 만든다 —
 * 에러를 고칠 때마다 경고가 뜨면 그게 이 사이클이 없애려던 무시 학습이다.
 * 위치 없는 줄(파일명 헤더 등)은 context로 남겨 attachHeaders가 쓴다.
 */
const HAS_POSITION = /\d+:\d+/;
const lines = (out) => out.split('\n').filter((l) => l.trim()).map((raw) => ({ raw }));
const diagLines = (out) => lines(out).filter((i) => HAS_POSITION.test(i.raw));

module.exports = { bodyFor };
