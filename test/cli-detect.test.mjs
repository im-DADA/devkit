// CLI 감지 — `PATH` 조각과 홈 디렉터리만 본다. 셸을 spawn하지 않는다.
//
// 설계: docs/2026-09-30-wizard-slim-multi-cli/DESIGN.md §4.3·§8.2
//
// ⚠ 이 파일은 `cli-detect.js`를 **top-level에서 require하지 않는다**(§8.7-1). 각 테스트가
// 자식 프로세스나 지연 require로 모듈을 열어야, 구현 0줄 상태의 RED가 "무엇이 빨간가"를
// 테스트 단위로 보여준다(모듈 부재 하나로 파일 전체가 죽지 않는다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const root = path.resolve(new URL('..', import.meta.url).pathname);
const modulePath = path.join(root, 'hooks', 'lib', 'cli-detect.js');
const load = () => require_(modulePath);

const temporary = [];
process.on('exit', () => { for (const dir of temporary) fs.rmSync(dir, { recursive: true, force: true }); });
function temp() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-cli-')); temporary.push(dir); return dir; }

/** 임시 디렉터리에 더미 실행 파일을 심고 그 디렉터리를 돌려준다. `{name: mode}` */
function binHome(names) {
  const dir = temp();
  for (const [name, mode] of Object.entries(names)) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(file, mode);
  }
  return dir;
}
/** `{'.codex': 'DIR'|'FILE'}` */
function homeWith(entries = {}) {
  const home = temp();
  for (const [name, kind] of Object.entries(entries)) {
    if (kind === 'DIR') fs.mkdirSync(path.join(home, name));
    else fs.writeFileSync(path.join(home, name), 'x');
  }
  return home;
}
/** 자식 프로세스에서 모듈을 로드해 표현식 결과를 JSON으로 받는다. */
function probe(expression, seal = []) {
  const body = `${seal.length ? `const Module = require('module'); const original = Module.prototype.require;
    Module.prototype.require = function (id) { if (${JSON.stringify(seal)}.includes(id)) throw new Error('SEALED:' + id); return original.apply(this, arguments); };` : ''}
    const m = require(${JSON.stringify(modulePath)});
    process.stdout.write(JSON.stringify(${expression}));`;
  const out = spawnSync(process.execPath, ['-e', body], { encoding: 'utf8', timeout: 10000 });
  assert.equal(out.status, 0, out.stderr);
  return JSON.parse(out.stdout);
}

test('DT1 B9: PATH의 실행 가능한 codex와 홈이 함께 있으면 both이고 binPath가 절대경로다', () => {
  const bin = binHome({ codex: 0o755 });
  const home = homeWith({ '.codex': 'DIR' });
  const got = probe(`m.detectCli('codex', { pathEnv: ${JSON.stringify(bin)}, homedir: ${JSON.stringify(home)} })`);
  assert.equal(got.status, 'both');
  assert.equal(got.binPath, path.join(bin, 'codex'));
  assert.equal(got.home, path.join(home, '.codex'));
  // 실행 권한이 없으면 바이너리로 세지 않는다 — 읽을 수 있는 파일과 실행할 수 있는 파일은 다르다.
  const unreadable = binHome({ codex: 0o644 });
  const bare = probe(`m.detectCli('codex', { pathEnv: ${JSON.stringify(unreadable)}, homedir: ${JSON.stringify(homeWith())} })`);
  assert.equal(bare.status, 'absent');
  assert.equal(bare.binPath, null);
});

test('DT2 B10: 바이너리 없고 홈만 있으면 home이고, 홈이 파일이면 absent다', () => {
  const home = homeWith({ '.codex': 'DIR' });
  const onlyHome = probe(`m.detectCli('codex', { pathEnv: ${JSON.stringify(temp())}, homedir: ${JSON.stringify(home)} })`);
  assert.equal(onlyHome.status, 'home');
  assert.equal(onlyHome.binPath, null);
  const asFile = homeWith({ '.codex': 'FILE' });
  const got = probe(`m.detectCli('codex', { pathEnv: ${JSON.stringify(temp())}, homedir: ${JSON.stringify(asFile)} })`);
  assert.equal(got.status, 'absent');
  assert.equal(got.home, null);
});

test('DT3 B12: child_process를 봉인한 프로세스에서 detectClis가 both를 낸다', () => {
  // ⚠ `require` 후크는 `child_process`·`node:child_process` 경로만 막는다 — 완전한 증명이
  // 아니라 회귀 방어선이다. 양성 대조(both가 실제로 나온다)가 함께 있어야 "봉인 때문에 빈
  // 결과가 나온 것"과 구별된다.
  const bin = binHome({ codex: 0o755, claude: 0o755 });
  const home = homeWith({ '.codex': 'DIR', '.claude': 'DIR' });
  const got = probe(`m.detectClis({ pathEnv: ${JSON.stringify(bin)}, homedir: ${JSON.stringify(home)} })`,
    ['child_process', 'node:child_process']);
  assert.equal(got.codex.status, 'both');
  assert.equal(got.claude.status, 'both');
  assert.equal(got.codex.binPath, path.join(bin, 'codex'));
});

test('DT4 B10 B11: offerableClis는 항상 둘을 내고 absent는 offered=false다', () => {
  const { offerableClis } = load();
  const offers = offerableClis({ claude: { status: 'both' }, codex: { status: 'absent' } });
  assert.equal(offers.length, 2);
  assert.equal(offers[0].cli, 'claude');
  assert.equal(offers[1].cli, 'codex');
  assert.equal(offers[0].offered, true);
  assert.equal(offers[0].hint, null);
  assert.equal(offers[1].offered, false);
  assert.equal(offers[1].hint, null);
  const home = offerableClis({ claude: { status: 'binary' }, codex: { status: 'home' } })[1];
  assert.equal(home.offered, true);
  assert.ok(home.hint.includes('설치 흔적만'), home.hint);
  // 입력이 비어도 둘을 내고 throw하지 않는다 — "왜 Codex가 안 보이나"를 말할 수 있어야 한다.
  for (const bad of [undefined, null, {}, 'x', 3, []]) {
    const fallback = offerableClis(bad);
    assert.equal(fallback.length, 2);
    assert.equal(fallback[0].cli, 'claude');
    assert.ok(fallback.every((o) => o.offered === false && o.status === 'absent'));
  }
});

test('DT5 B13: force는 감지 결과와 무관하게 노출하고 forced를 표시한다', () => {
  const { offerableClis } = load();
  const offer = offerableClis({ codex: { status: 'absent' } }, { force: ['codex'] })[1];
  assert.equal(offer.offered, true);
  assert.equal(offer.forced, true);
  assert.ok(offer.hint.includes('--cli'), offer.hint);
  // 감지된 CLI를 강제해도 hint가 생기지 않는다(말할 것이 없다).
  const detected = offerableClis({ codex: { status: 'both' } }, { force: ['codex'] })[1];
  assert.equal(detected.forced, true);
  assert.equal(detected.hint, null);
  for (const bad of [undefined, null, 'codex', { force: 'codex' }, { force: [3] }]) {
    assert.equal(offerableClis({ codex: { status: 'absent' } }, bad)[1].offered, false);
  }
});

test('DT6: findOnPath는 어떤 입력에도 throw하지 않고 못 찾으면 null이다', () => {
  const { findOnPath, MAX_PATH_SEGMENTS } = load();
  assert.equal(findOnPath('codex', ''), null);
  assert.equal(findOnPath('codex', undefined), null);
  assert.equal(findOnPath('codex', null), null);
  for (const bad of ['', null, undefined, 3, {}]) assert.equal(findOnPath(bad, '/usr/bin'), null);
  // 상한을 넘는 PATH는 훅 예산을 지키기 위해 포기한다 — throw가 아니라 null이다.
  assert.equal(typeof MAX_PATH_SEGMENTS, 'number');
  const bin = binHome({ codex: 0o755 });
  const crowded = [...Array(MAX_PATH_SEGMENTS + 1).fill('/nonexistent-devkit'), bin].join(path.delimiter);
  assert.equal(findOnPath('codex', crowded), null);
  // 상한 안이면 같은 더미를 찾는다(상한이 기능을 통째로 끄지 않는다는 양성 대조).
  assert.equal(findOnPath('codex', ['/nonexistent-devkit', bin].join(path.delimiter)), path.join(bin, 'codex'));
});

// ── DT7: PATH 상한 초과도 이유를 말한다 (2026-10-01 리뷰 확인②) ───
test('DT7: PATH 조각이 상한을 넘으면 absent여도 hint로 이유를 말한다', () => {
  const { detectCli, offerableClis, isPathTruncated, MAX_PATH_SEGMENTS } = load();
  const many = Array(MAX_PATH_SEGMENTS + 1).fill('/nope').join(path.delimiter);
  assert.equal(isPathTruncated(many), true);
  assert.equal(isPathTruncated('/usr/bin'), false);
  assert.equal(isPathTruncated(''), false);
  const detected = { claude: detectCli('claude',{pathEnv:many,homedir:'/definitely/not/here'}),
    codex: detectCli('codex',{pathEnv:many,homedir:'/definitely/not/here'}) };
  assert.equal(detected.codex.status,'absent');
  assert.equal(detected.codex.pathTruncated,true);
  const codex = offerableClis(detected).find((o) => o.cli === 'codex');
  // 침묵하면 사용자는 "왜 Codex가 안 보이나"를 알 수 없다 — 모듈 주석의 약속이다.
  assert.ok(codex.hint && codex.hint.includes('PATH'), `hint가 비었다: ${codex.hint}`);
  assert.ok(codex.hint.includes('--cli'), '탈출구를 함께 말해야 한다');
  // forced와 겹쳐도 PATH 사유가 우선이다 — 사용자가 알아야 하는 것은 "왜 못 찾았나"다.
  const forcedCodex = offerableClis(detected,{force:['codex']}).find((o) => o.cli === 'codex');
  assert.ok(forcedCodex.hint.includes('PATH'), `forced가 PATH 사유를 가렸다: ${forcedCodex.hint}`);
});
