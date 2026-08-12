// evidence.ref 파싱·실존 판정 — "실행 흔적이 가리키는 파일이 실제로 있는가".
//
// 파서를 추측으로 짜면 오탐이 그대로 게이트가 된다. 그래서 스캔 규칙은
// 아카이브 behaviors.json 2개의 ref 23건을 전수 관찰해서 정했다.
// 핵심: 슬래시 없는 토큰(`pdca-state.js:gatePrerequisite`)은 경로가 아니다 —
// 실제 파일은 hooks/lib/pdca-state.js라 경로로 취급하면 정직한 evidence가 막힌다.

const fs = require('node:fs');
const path = require('node:path');
const { warn } = require('./diag');

// 앞 경계. 토큰 바로 앞이 문자열 시작·공백·쉼표·여는 괄호·`·`가 **아니면** 경로가 아니다.
//
// 왜 화이트리스트인가: 1·2회차가 "URL만 지운다"(스킴 전용 규칙)로 두 번 처방했다가 두 번 다
// 미완으로 남았다. ref는 자유 텍스트라 "무엇이 경로가 아닌가"를 열거하는 건 끝나지 않는다.
// 규칙을 더 얹는 대신 인정 조건을 좁히면 `~/`·`git@host:`·`@scope/`·`https://`가 한 줄로 닫힌다.
// 애매하면 후보에서 빼는 쪽 = unparsed = fail-open이고, 이 사이클의 우선순위(오탐 > 미탐)와 같다.
const HEAD = '(?<![^\\s,(·])';

// 경로 후보: 슬래시를 1개 이상 포함하고 확장자로 끝나는 토큰 + 뒤따르는 :line[-endLine].
// 첫 글자를 `[\w.]`로 제한해 `@scope/pkg@1.0.0`이 자기 `@`를 삼키고 시작하는 것을 막는다.
const PATH_RE = new RegExp(`${HEAD}((?:\\.{0,2}\\/)?[\\w.][\\w.@+-]*(?:\\/[\\w.@+-]+)+\\.[A-Za-z0-9]+)(?::(\\d+)(?:-(\\d+))?)?`, 'g');

// 예외: ref 전체가 공백 없는 단일 토큰이면 그 자체를 경로로 인정한다.
// 이게 없으면 D11-b형 위조(`ref:"t.ts"`)가 후보 0개 → unparsed로 게이트를 빠져나간다.
// 콜론 뒤에 숫자가 아닌 식별자가 붙은 형태는 여기 걸리지 않는다(위 오탐 규칙 유지).
// 첫 글자 제한은 PATH_RE와 같은 이유 + 절대경로(`/etc/passwd`)를 위해 `/`만 더 연다.
const SINGLE_RE = /^([\w./][\w.@+\-/]*)(?::(\d+)(?:-(\d+))?)?$/;

function num(v) {
  return v === undefined ? null : Number(v);
}

/** ref 문자열에서 파일 경로 후보를 뽑는다. 후보 0개면 빈 배열 */
function parseRefPaths(ref) {
  if (typeof ref !== 'string' || ref.trim() === '') return [];
  const out = [];
  for (const m of ref.matchAll(PATH_RE)) {
    out.push({ raw: m[0], path: m[1], line: num(m[2]), endLine: num(m[3]) });
  }
  if (out.length > 0) return out;

  const single = SINGLE_RE.exec(ref.trim());
  if (!single) return [];
  const p = single[1];
  // DESIGN §5.1: 예외는 "확장자로 끝나는" 단일 토큰뿐이다. 슬래시만 있으면 인정하도록
  // 넓히면 `hooks/lib` 같은 실재하는 폴더가 "파일 없음"으로 차단된다(오탐 > 미탐 위반).
  //
  // 예외를 두는 이유는 루트 이탈 판정을 살리기 위해서다 — 빼면 `/etc/passwd`가 샌다(B4).
  // 2회차는 근거를 "절대경로·상위 이동은 식별자일 수 없다"고 적었는데 **틀렸다**: 이 레포의
  // 커맨드 식별자가 정확히 `/report`·`/gap`이다. 그래서 절대경로는 슬래시 2개 이상만 인정한다
  // — 루트 이탈은 최소 한 단계를 내려가므로 슬래시 1개짜리는 이탈 후보가 될 수 없다.
  const escaping = /(?:^|\/)\.\.(?:\/|$)/.test(p)
    || (p.startsWith('/') && p.split('/').length > 2);
  if (!escaping && !/\.[A-Za-z0-9]+$/.test(p)) return []; // 경로로 볼 근거가 없다
  return [{ raw: single[0], path: p, line: num(single[2]), endLine: num(single[3]) }];
}

// /report가 사이클을 docs/{date}-{slug}/ → docs/archive/{date}/{slug}/로 옮긴다
// (commands/report.md:24). 막는 쪽이 이 규칙을 모르면 아카이빙 순간 완료된 사이클의
// manual/visual evidence가 전부 unresolved가 된다 — 완료가 위조로 둔갑하는 구조적 오탐.
// 역방향(archive → 원본)은 하지 않는다. 아카이빙은 단방향이다.
const CYCLE_RE = /^docs\/(\d{4}-\d{2}-\d{2})-([^/]+)\/(.+)$/;

function archiveAlt(p) {
  const m = CYCLE_RE.exec(p);
  return m ? `docs/archive/${m[1]}/${m[2]}/${m[3]}` : null;
}

/** 'ok' | 'dir' | 'enoent' | 'error'. error는 stderr에 남기고 판정에서 제외한다(swallow 아님) */
function statFile(abs, label) {
  try {
    // 디렉터리는 "파일 없음"이 아니라 **판정 대상이 아니다**. 없는 것으로 세면 실재하는
    // 폴더가 "파일 없음 .devkit"으로 차단된다 — 사실과 다른 메시지라 고칠 방법이 없다.
    return fs.statSync(abs).isFile() ? 'ok' : 'dir';
  } catch (e) {
    if (e.code === 'ENOENT') return 'enoent';
    // E4 fail-open — 권한 문제(EACCES 등)가 차단 이유가 되면 안 된다
    warn(`evidence ref 확인 실패 (${label}): ${e.message}`);
    return 'error';
  }
}

/**
 * 라인 초과를 기록만 한다. 게이트가 아닌 이유: 파일이 줄어들면 정직한 ref에서도
 * 발생해 위조와 구분되지 않는다. 라인 정합은 receipt 인용(L3a-2)이 다른 축에서 본다.
 */
function noteDrift(r, p, abs) {
  const want = p.endLine ?? p.line;
  if (want === null) return;
  let total;
  try {
    // 끝의 개행 하나는 줄을 만들지 않는다 — 여기서 +1이 나면 정직한 마지막 줄 ref가 드리프트로 잡힌다
    total = fs.readFileSync(abs, 'utf8').replace(/\n$/, '').split('\n').length;
  } catch (e) {
    warn(`evidence 라인 확인 실패 (${p.path}): ${e.message}`);
    return;
  }
  if (want > total) r.lineDrift.push(`${p.path}:${p.line}${p.endLine ? `-${p.endLine}` : ''} (총 ${total}줄)`);
}

/** ref가 가리키는 파일이 실제로 있는가. status는 resolved|unresolved|unparsed 셋뿐 */
function classifyRef(ref, root) {
  const paths = parseRefPaths(ref);
  const r = {
    status: 'unparsed', paths, missing: [], escaped: [], lineDrift: [], via: {},
  };
  // E3 fail-open — 파서가 못 읽는 형식이 차단 이유가 되면 안 된다
  if (paths.length === 0) return r;

  // 디렉터리로 판명돼 후보에서 빠진 수. 전부 빠지면 판정할 게 없으므로 unparsed로 남는다
  // (여기서 resolved로 세면 "폴더를 적으면 통과"가 되고, unresolved로 세면 오탐이다).
  let dropped = 0;
  for (const p of paths) {
    const abs = path.resolve(root, p.path);
    // 루트 밖을 가리키는 ref는 실존 여부와 무관하게 거부한다 — /etc/passwd는 실제로
    // 존재하므로 stat만 보면 통과해버린다. 절대경로도 같은 검사 하나로 걸린다.
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      r.escaped.push(p.path);
      continue;
    }
    const hit = statFile(abs, p.path);
    // E5 fail-open — 디렉터리는 판정 대상이 아니다. missing으로 세면 `.devkit`·`hooks/lib`
    // 같은 실재 폴더가 "파일 없음"으로 REPORT를 막는다(폴더명 위조 검출은 포기한 대가).
    if (hit === 'dir') {
      dropped += 1;
      continue;
    }
    if (hit === 'ok') {
      r.via[p.path] = 'direct';
      noteDrift(r, p, abs);
      continue;
    }
    if (hit === 'error') continue;

    // 폴백도 직접 경로와 **같은 3분기**를 쓴다. `=== 'ok'` 하나로 누르면 디렉터리도 권한
    // 오류도 전부 missing이 되어, 같은 상황이 직접 경로에선 통과하고 아카이브에선 차단된다
    // (E4가 경로에 따라 갈린다). 아카이브는 완료된 사이클이 사는 곳이라 오탐이 특히 비싸다.
    const alt = archiveAlt(p.path);
    const altAbs = alt === null ? null : path.resolve(root, alt);
    const altHit = altAbs === null ? 'enoent' : statFile(altAbs, alt);
    if (altHit === 'dir') { // E5 fail-open (폴백 쪽)
      dropped += 1;
      continue;
    }
    if (altHit === 'ok') {
      r.via[p.path] = 'archive';
      noteDrift(r, p, altAbs);
      continue;
    }
    if (altHit === 'error') continue;
    r.missing.push(p.path); // 'enoent' — 여기서만 "파일 없음"이라고 단정할 수 있다
  }
  if (r.missing.length > 0 || r.escaped.length > 0) r.status = 'unresolved';
  else if (dropped < paths.length) r.status = 'resolved';
  return r;
}

/**
 * 게이트가 소비하는 유일한 판정. 막는 조건은 unresolved 하나뿐이다.
 * doc을 인자로 받는 이유: behaviors.js가 이 파일을 require하므로 반대 방향을
 * top-level에 두면 순환이 난다. isEvidenceValid만 호출 시점에 지연 require한다
 * (그 시점엔 behaviors.js의 module.exports가 완성돼 있다).
 */
function gateEvidence(doc, root) {
  // E1 fail-open — 호출자가 바뀌어도 lib가 스스로 방어한다
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.behaviors)) return { ok: true };
  const { isEvidenceValid } = require('./behaviors');

  const unresolved = [];
  for (const b of doc.behaviors) {
    // E2 fail-open — 작업 중 항목을 막지 않고, unproven이 잡는 것을 이중으로 막지 않는다
    if (!b || b.passes !== true || !isEvidenceValid(b.evidence)) continue;
    const r = classifyRef(b.evidence.ref, root);
    if (r.status !== 'unresolved') continue; // unparsed는 게이트 대상이 아니다(E3)
    unresolved.push({
      id: b.id, ref: b.evidence.ref, missing: r.missing, escaped: r.escaped,
    });
  }
  if (unresolved.length === 0) return { ok: true };

  // 어느 behavior의 어느 ref인지 지목해야 고칠 수 있다. "unresolved 1건"은 안내가 아니다.
  const describe = (u) => (u.escaped.length > 0
    ? `루트 밖 경로 ${u.escaped.join(', ')}`
    : `파일 없음 ${u.missing.join(', ')}`);
  const reason = unresolved.map((u) => `${u.id} — ref "${u.ref}": ${describe(u)}`).join('\n');
  return { ok: false, unresolved, reason };
}

module.exports = { parseRefPaths, classifyRef, gateEvidence, archiveAlt };
