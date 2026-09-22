// devkit 전역 설정 로더 — 순수 병합(mergeConfig)과 IO(loadConfig)의 계약.
//
// 설계: docs/2026-09-21-devkit-config/DESIGN.md §3.1·§4.3
// 이 사이클의 1급 제약은 "설정이 없으면 지금과 100% 동일"이고, 그 절반이 여기 있다 —
// 나머지 절반(주입 텍스트·훅 동작)은 rules-render.test.mjs와 no-config-parity.test.mjs다.
//
// ⚠ 무검증 층: 이 테스트가 넣는 입력 JSON은 **테스트가 직접 조립한다.** 실사용에서 그 JSON을
// 만드는 것은 `commands/kit.md`의 `/kit setup`이고, 커맨드는 마크다운이라 실행할 수 없다.
// 따라서 "마법사가 스키마에 맞는 JSON을 쓰는가"는 이 파일이 검증하지 못한다(RULES.md:414).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const dir = path.dirname(fileURLToPath(import.meta.url));
const libPath = path.join(dir, '..', 'hooks', 'lib', 'config.js');
// 순수 층은 따로 있다 — U5가 fs 봉인 환경에서 **이 경로를** 로드해 순수성을 동작으로 본다.
const purePath = path.join(dir, '..', 'hooks', 'lib', 'config-schema.js');
const require_ = createRequire(import.meta.url);
const { DEFAULTS, mergeConfig, isDefault } = require_(libPath);

const tmps = [];
process.on('exit', () => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

/** 설정 파일 하나를 담은 임시 홈. raw가 null이면 파일을 만들지 않는다. */
function homeWith(raw) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-cfg-'));
  tmps.push(home);
  if (raw !== null) {
    fs.mkdirSync(path.join(home, '.devkit'), { recursive: true });
    fs.writeFileSync(path.join(home, '.devkit', 'config.json'), raw);
  }
  return home;
}

// ── U1·U3: 병합 ────────────────────────────────────────────────
test('U1: 입력이 없으면 DEFAULTS 그대로', () => {
  assert.deepEqual(mergeConfig(undefined).config, DEFAULTS);
  assert.deepEqual(mergeConfig(undefined).problems, []);
});

test('U3: 부분 설정은 같은 객체의 나머지 키를 기본값으로 유지한다', () => {
  const { config, problems } = mergeConfig({ guards: { level: 'minimal' } });
  assert.equal(config.guards.level, 'minimal');
  assert.equal(config.guards.newDependency, 'ask', '객체를 통째로 교체했다');
  assert.equal(config.guards.protectedFiles.env, 'deny');
  assert.deepEqual(problems, [], '정상 입력인데 problems가 생겼다');
});

test('U3b: DEFAULTS는 병합으로 오염되지 않는다', () => {
  mergeConfig({ guards: { level: 'minimal' }, rules: { maxLines: 10 } });
  assert.equal(DEFAULTS.guards.level, 'default');
  assert.equal(DEFAULTS.rules.maxLines, 200);
});

// ── U2: 어떤 입력에도 degrade (B5) ──────────────────────────────
// 통과 기준이 두 개다: throw하지 않는다 + **왜 떨어졌는지 말한다**.
// 조용히 무시하면 오타가 영원히 안 보인다(bash-receipt.js:23-26과 같은 이유).
const BROKEN = [
  ['null', null],
  ['문자열', 'x'],
  ['배열', []],
  ['미래 버전', { version: 2, language: 'off' }],
  ['타입 불일치', { guards: 'x' }],
  ['음수 maxLines', { rules: { maxLines: -1 } }],
  ['배열이 아닌 kinds', { verify: { kinds: 'x' } }],
  ['모르는 에이전트', { models: { nope: { model: 'opus', effort: 'high' } } }],
  ['모르는 키', { language: 'ko' }],
];

for (const [label, raw] of BROKEN) {
  test(`U2: ${label} → throw 없이 기본값으로 떨어지고 사유가 남는다`, () => {
    const r = mergeConfig(raw);
    assert.ok(r.config, 'config가 없다');
    assert.equal(typeof r.config.version, 'number');
    assert.ok(r.problems.length >= 1, `problems가 비었다 — 조용히 무시했다: ${label}`);
  });
}

test('U2b: 미래 버전은 부분 해석하지 않고 통째로 기본값이다', () => {
  const { config } = mergeConfig({ version: 2, language: 'off', rules: { maxLines: 10 } });
  assert.equal(config.language, 'auto', 'version이 다른데 값을 받아들였다');
  assert.equal(config.rules.maxLines, 200);
});

test('U2c: 한 키가 틀려도 나머지 키는 살아남는다', () => {
  const { config } = mergeConfig({ rules: { maxLines: -1, noAny: false } });
  assert.equal(config.rules.maxLines, 200, '틀린 키만 떨어뜨려야 한다');
  assert.equal(config.rules.noAny, false, '멀쩡한 키까지 버렸다');
});

// ── U4: 배열은 교체다 ──────────────────────────────────────────
test('U4: verify.kinds는 교체다 — 합집합이면 끄는 방법이 사라진다', () => {
  const { config } = mergeConfig({ verify: { kinds: ['typecheck'] } });
  assert.deepEqual(config.verify.kinds, ['typecheck']);
  const empty = mergeConfig({ verify: { kinds: [] } });
  assert.deepEqual(empty.config.verify.kinds, [], '빈 배열로 전부 끄지 못한다');
});

// ── isDefault ────────────────────────────────────────────────
test('isDefault: 기본값이면 true, 한 글자만 달라도 false', () => {
  assert.equal(isDefault(mergeConfig(undefined).config), true);
  assert.equal(isDefault(mergeConfig({ merge: { strategy: 'rebase' } }).config), false);
});

test('isDefault: 기본값을 그대로 적어 넣어도 true다', () => {
  const raw = JSON.parse(JSON.stringify(DEFAULTS));
  assert.equal(isDefault(mergeConfig(raw).config), true, '기본값 명시가 "설정함"으로 읽힌다');
});

// ── U5: 순수성 — 동작으로 단언한다(형태 관찰 금지, D24) ──────────
// fs를 만지면 터지는 환경에서 실제로 돌린다. mergeConfig가 파일을 읽기 시작하면 빨개진다.
test('U5: mergeConfig는 fs를 봉인한 프로세스에서도 판정한다', () => {
  const probe = `
    const Module = require('module');
    const orig = Module.prototype.require;
    Module.prototype.require = function (id) {
      if (id === 'fs' || id === 'node:fs' || id === 'node:fs/promises') throw new Error('FS_TOUCHED');
      return orig.apply(this, arguments);
    };
    const { mergeConfig } = require(${JSON.stringify(purePath)});
    process.stdout.write(String(mergeConfig({ rules: { maxLines: 7 } }).config.rules.maxLines));
  `;
  assert.equal(execFileSync('node', ['-e', probe], { encoding: 'utf8' }), '7');
});

// ── loadConfig: IO 경계 ───────────────────────────────────────
// 훅은 프로세스당 1회 실행이라 여기서는 자식 프로세스로 관측한다 — 모듈 캐시가 섞이지 않는다.
function readConfigIn(home, extraEnv = {}) {
  const probe = `
    const { loadConfig } = require(${JSON.stringify(libPath)});
    process.stdout.write(JSON.stringify(loadConfig()));
  `;
  const env = { ...process.env, HOME: home, ...extraEnv };
  delete env.DEVKIT_CONFIG;
  for (const [k, v] of Object.entries(extraEnv)) env[k] = v;
  const out = execFileSync('node', ['-e', probe], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out);
}

test('loadConfig: 파일이 없으면 DEFAULTS', () => {
  assert.deepEqual(readConfigIn(homeWith(null)), DEFAULTS);
});

test('loadConfig: 깨진 JSON이어도 DEFAULTS를 돌려주고 exit 0이다', () => {
  assert.deepEqual(readConfigIn(homeWith('{ not json')), DEFAULTS);
});

test('loadConfig: 읽은 값이 반영된다', () => {
  const cfg = readConfigIn(homeWith('{"version":1,"merge":{"strategy":"rebase"}}'));
  assert.equal(cfg.merge.strategy, 'rebase');
});

test('loadConfig: DEVKIT_CONFIG 빈 문자열이면 홈에 파일이 있어도 설정 없음이다', () => {
  const home = homeWith('{"version":1,"merge":{"strategy":"rebase"}}');
  assert.deepEqual(readConfigIn(home, { DEVKIT_CONFIG: '' }), DEFAULTS);
});

test('loadConfig: DEVKIT_CONFIG로 경로를 바꾼다', () => {
  const home = homeWith('{"version":1,"merge":{"strategy":"rebase"}}');
  const other = path.join(homeWith(null), 'elsewhere.json');
  fs.writeFileSync(other, '{"version":1,"tone":"neutral"}');
  const cfg = readConfigIn(home, { DEVKIT_CONFIG: other });
  assert.equal(cfg.tone, 'neutral');
  assert.equal(cfg.merge.strategy, 'squash', '홈의 파일을 읽었다 — 경로 치환이 안 됐다');
});

// problems가 있으면 진단이 나가야 한다. 조용한 degrade는 "설정했는데 안 먹는" 상태를 만든다.
test('loadConfig: 문제가 있으면 stderr에 한 줄 남긴다', () => {
  const home = homeWith('{"version":1,"unknownKey":1}');
  const probe = `require(${JSON.stringify(libPath)}).loadConfig();`;
  const r = execFileSync('node', ['-e', probe], {
    encoding: 'utf8', env: { ...process.env, HOME: home, DEVKIT_CONFIG: path.join(home, '.devkit', 'config.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(r, '', 'stdout을 오염시켰다 — 훅 계약이 깨진다');
});

// ── 🔴 리뷰 1회차: 프로토타입 체인 (2026-09-21) ────────────────────
// `spec[key]`가 프로토타입 체인을 타면 두 가지가 동시에 터진다:
//   ① `hasOwnProperty` 같은 키 → rule이 Object.prototype의 **함수**가 되고 accepts가 this 없이
//      호출해 throw → loadConfig가 안 감싸면 **훅 프로세스가 죽고 가드가 fail-open**된다.
//      실측: `{"hasOwnProperty":1}` 설정 하나로 bash-guard가 exit 1(차단 실패)이었다.
//   ② `__proto__` → out['__proto__']에 쓰면서 **전역 Object.prototype을 오염**시킨다.
// 둘 다 "설정 파일 한 줄로 devkit의 모든 가드가 꺼진다"로 이어진다. 가드는 fail-open이면 안 된다.
const PROTO_KEYS = [
  ['hasOwnProperty', { hasOwnProperty: 1 }],
  ['중첩 hasOwnProperty', { rules: { hasOwnProperty: true } }],
  ['toString', { toString: 1 }],
  ['constructor', { constructor: 1 }],
  ['valueOf', { valueOf: 1 }],
];

for (const [label, raw] of PROTO_KEYS) {
  test(`🔴 ${label}: 프로토타입 키는 throw 없이 "모르는 키"로 거부된다`, () => {
    let r;
    assert.doesNotThrow(() => { r = mergeConfig(raw); }, `${label}에서 throw했다 — 훅이 죽고 가드가 fail-open된다`);
    assert.ok(r.problems.length >= 1, '조용히 통과했다');
    assert.deepEqual(r.config, DEFAULTS, '프로토타입 키가 설정을 바꿨다');
  });
}

test('🔴 __proto__로 Object.prototype을 오염시킬 수 없다', () => {
  const raw = JSON.parse('{"__proto__":{"toString":"PWNED"}}');
  const r = mergeConfig(raw);
  assert.notEqual(({}).toString, 'PWNED', '전역 Object.prototype이 오염됐다');
  assert.ok(r.problems.length >= 1, '오염 시도가 조용히 통과했다');
  // 오염이 실제로 일어나는지 다음 병합에서도 확인한다(한 번 더러워지면 전역이라 계속 남는다)
  assert.equal(typeof ({}).toString, 'function');
});

test('🔴 프로토타입 키가 섞인 설정에서도 훅은 exit 0이고 기본 판정을 한다', () => {
  // 관측점을 프로세스 경계로 올린다 — mergeConfig만 보면 "훅이 죽는다"는 결과가 안 보인다.
  const home = homeWith('{"version":1,"hasOwnProperty":1}');
  const probe = `
    const { loadConfig } = require(${JSON.stringify(libPath)});
    process.stdout.write(JSON.stringify(loadConfig().guards.level));
  `;
  const out = execFileSync('node', ['-e', probe], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, DEVKIT_CONFIG: path.join(home, '.devkit', 'config.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(out, '"default"', 'loadConfig가 기본값으로 degrade하지 못했다');
});

// ── 🔴 리뷰 1회차: 설정 내용이 stderr로 샌다 ───────────────────────
// JSON.parse의 에러 메시지는 본문 앞부분을 담는다. 설정 자리에 .env를 잘못 두면 그 값이
// 진단으로 찍히고, 허용값 밖 값도 원문 echo된다 — secret-guard가 막는 노출이 설정 경로로 샌다.
test('🔴 깨진 설정의 본문이 stderr에 실리지 않는다', () => {
  const home = homeWith('AWS_SECRET_ACCESS_KEY=abcd1234efgh5678ijkl');
  const probe = `require(${JSON.stringify(libPath)}).loadConfig();`;
  const r = execFileSync('node', ['-e', probe], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, DEVKIT_CONFIG: path.join(home, '.devkit', 'config.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(r, '');
});

test('🔴 허용값 밖 값의 원문이 problems에 실리지 않는다', () => {
  const { problems } = mergeConfig({ version: 1, tone: 'sk-ant-api03-SECRETVALUE' });
  assert.ok(problems.length >= 1);
  assert.equal(problems.join(' ').includes('SECRETVALUE'), false,
    '거부한 값을 그대로 echo했다 — 시크릿을 적어 넣은 사용자에게 유출 경로가 된다');
  assert.match(problems.join(' '), /tone/, '어느 키가 문제인지는 말해야 한다');
});
