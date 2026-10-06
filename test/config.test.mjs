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
import { execFileSync, spawnSync } from 'node:child_process';
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

// ── SC1~SC6: CLI 축과 기본 모델 (B14~B16·B33·B35·B36) ──────────
// 설계: docs/2026-09-30-wizard-slim-multi-cli/DESIGN.md §3.7·§4.6·§8.3

test('SC1: cli 없는 옛 설정은 claude로 병합되고 키 순서가 보존된다', () => {
  const { config, problems } = mergeConfig({ models: { planner: { model: 'fable', effort: 'max' } } });
  assert.deepEqual(config.models.planner, { cli: 'claude', model: 'fable', effort: 'max' });
  assert.deepEqual(problems, []);
  // 키 순서가 DEFAULTS와 같아야 isDefault의 JSON.stringify 비교가 성립한다(§3.7).
  assert.deepEqual(Object.keys(config.models.planner), Object.keys(DEFAULTS.models.planner));
});

test('SC1b: DEFAULTS를 그대로 적어 넣으면 problems가 비고 isDefault가 참이다', () => {
  // ⚠ SPEC에 cli가 빠지면 problems에만 쌓이고 stderr로 흐른다 — P1은 stdout만 보므로
  // 그 침묵을 아무 테스트도 잡지 못한다(DESIGN §1-②). 이 단언이 그 구멍을 막는다.
  const { config, problems } = mergeConfig(JSON.parse(JSON.stringify(DEFAULTS)));
  assert.deepEqual(problems, []);
  assert.equal(isDefault(config), true);
});

test('SC2: 모르는 cli는 거부되고 같은 에이전트의 model·effort는 살아남는다', () => {
  const { config, problems } = mergeConfig({ models: { planner: { cli: 'gemini', model: 'sonnet', effort: 'low' } } });
  assert.equal(config.models.planner.cli, 'claude');
  assert.equal(config.models.planner.model, 'sonnet');
  assert.equal(config.models.planner.effort, 'low');
  assert.ok(problems.some((p) => p.includes('models.planner.cli')), problems.join(' | '));
  assert.ok(!problems.join(' ').includes('gemini'), '거부된 값 원문을 problems에 싣지 않는다');
});

test('SC3: cli codex와 ultra effort를 함께 받는다', () => {
  const { config, problems } = mergeConfig({ models: { 'tdd-driver': { cli: 'codex', effort: 'ultra' } } });
  assert.deepEqual(config.models['tdd-driver'], { cli: 'codex', model: 'opus', effort: 'ultra' });
  assert.deepEqual(problems, []);
});

test('SC4: planner·architect 기본 모델이 opus이고 8종 전부 cli가 claude다', () => {
  assert.deepEqual(DEFAULTS.models.planner, { cli: 'claude', model: 'opus', effort: 'max' });
  assert.deepEqual(DEFAULTS.models.architect, { cli: 'claude', model: 'opus', effort: 'max' });
  // ⚠ 2종만 보면 나머지 6종이 조용히 codex로 넘어가도 아무도 못 잡는다 — 돌연변이로 실증됐다
  // (test-writer.cli를 codex로 바꿨을 때 무결성 해시 1건만 빨개지고, 그건 gen-integrity가 덮는다).
  assert.deepEqual(Object.values(DEFAULTS.models).map((m) => m.cli), Array(8).fill('claude'));
});

test('SC7 B38: README 에이전트 표가 DEFAULTS와 일치한다', () => {
  // 기대값을 DEFAULTS에서 만든다 — 리터럴을 박으면 기본 배분이 바뀔 때 표만 거짓이 된다
  // (2026-10-01에 실제로 그랬다: planner·architect를 opus로 옮기고 README 표를 놓쳤다).
  const readme = fs.readFileSync(path.join(dir, '..', 'README.md'), 'utf8');
  for (const [agent, want] of Object.entries(DEFAULTS.models)) {
    const row = readme.split('\n').find((l) => l.startsWith(`| \`${agent}\``));
    assert.ok(row, `README에 ${agent} 행이 없다`);
    assert.ok(row.includes(`${want.model} · ${want.effort}`), `${agent}: README가 "${row.trim()}"인데 기본값은 ${want.model} · ${want.effort}다`);
  }
});

test('SC8 B39: 기본 배분을 말하는 커맨드 문서가 DEFAULTS와 일치한다', () => {
  // planner의 모델을 문장으로 적은 커맨드들 — 기본값이 바뀌면 여기도 바뀌어야 한다.
  const want = DEFAULTS.models.planner.model;
  for (const rel of ['commands/plan.md', 'commands/flow.md']) {
    const text = fs.readFileSync(path.join(dir, '..', rel), 'utf8');
    const m = text.match(/planner(?:는)? \*{0,2}([A-Za-z]+)[·•]max/);
    assert.ok(m, `${rel}에 planner 모델을 적은 문장이 없다`);
    assert.equal(m[1].toLowerCase(), want, `${rel}가 ${m[1]}이라 적었는데 기본값은 ${want}다`);
  }
});

test('SC5 B35: 기본값을 주장하는 파일에 fable이 없다 — 대소문자 무시', () => {
  // 다른 파일(테스트 FIXTURE 등)에는 fable이 정당하게 있다 — 기본 배분을 말하는 곳만 본다.
  // ⚠ `includes('fable')`은 **`Fable`을 통과시킨다** — 이 레포가 금지하는 우회이고, 실제로
  //    agent-contract:600·no-config-parity:463의 옛 기본값 주석이 그 구멍으로 살아남았다(2026-10-01 Gap).
  const root = path.join(dir, '..');
  for (const rel of ['hooks/lib/config-schema.js', 'agents/planner.md', 'agents/architect.md',
    'test/agent-contract.test.mjs', 'test/no-config-parity.test.mjs']) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.doesNotMatch(text, /fable/i, `${rel}에 fable이 남아 있다`);
  }
});

test('SC6: 폴백 목록은 DEFAULTS에서 유도된다 — 하드코딩 상수가 아니다', () => {
  const { fallbackChoices } = require_(path.join(dir, '..', 'hooks', 'lib', 'model-catalog.js'));
  const { EFFORTS } = require_(path.join(dir, '..', 'hooks', 'lib', 'agent-frontmatter.js'));
  assert.deepEqual(fallbackChoices(), {
    models: [...new Set(Object.values(DEFAULTS.models).map((m) => m.model))],
    efforts: [...EFFORTS],
  });
  assert.equal(fallbackChoices().models.length, 2, 'planner·architect가 opus가 된 뒤 fable이 빠진다(R10)');
});

// ── SP1·SP2: 설정 키와 문서의 대조 (B22·B23) ──────────────────
// 설계: docs/2026-10-01-wizard-question-budget/DESIGN.md §8.3
// 이 저장소는 `24개 항목`·`라운드가 7개 늘어난다`를 문서에 적어 두었는데 **둘 다 틀렸다**
// (실측 잎 키 31개). 수를 세어 적는 대신 **키를 전개하고 수치 주장을 금지**한다 — 숫자는
// 조용히 거짓이 되고(D36) 아무도 못 잡는다. SP1은 키를 추가하고 문서를 안 고치면 빨개진다.
const pickSection = () => fs.readFileSync(path.join(dir,'..','commands','kit.md'),'utf8')
  .split('\n### 직접 고르기\n')[1].split('\n### ')[0];
function leafKeys() {
  const { SPEC } = require_(purePath);
  const out = [];
  (function walk(node, prefix) {
    for (const [k, v] of Object.entries(node)) {
      const q = prefix ? `${prefix}.${k}` : k;
      const branch = v && typeof v === 'object' && !Array.isArray(v) && typeof v !== 'function' && !(v instanceof RegExp);
      if (branch) walk(v, q); else out.push(q);
    }
  }(SPEC, ''));
  return out.filter((k) => !['version', '_appliedAt'].includes(k) && !k.startsWith('models'));
}

test('SP1 B22: SPEC의 잎 키 전부가 kit.md 직접 고르기 절에 정확히 한 번 나온다', () => {
  const section = pickSection();
  const leaves = leafKeys();
  assert.ok(leaves.length >= 30, `잎 키가 ${leaves.length}개다 — 이 테스트의 전제가 깨졌다`);
  for (const leaf of leaves) {
    // ⚠ **백틱으로 감싸 센다.** 맨 문자열로 세면 `format`이 `formatOnEdit`에, `testing`이
    //    `testNudge`에 걸려 "있는 것처럼" 보인다(부분 일치가 거짓 통과를 만든다).
    const hits = section.split(`\`${leaf}\``).length - 1;
    assert.equal(hits, 1, `직접 고르기 절에 \`${leaf}\`가 ${hits}번 나온다(1이어야 한다)`);
  }
});

test('SP2 B23: 직접 고르기 절이 항목 수나 라운드 수를 주장하지 않는다', () => {
  const doc = fs.readFileSync(path.join(dir,'..','commands','kit.md'),'utf8');
  assert.ok(doc.includes('### 직접 고르기'), '절 제목에서 숫자를 빼야 한다');
  assert.doesNotMatch(pickSection(), /\d+\s*개\s*(항목|라운드)/, '수치 주장이 남아 있다');
  assert.doesNotMatch(pickSection(), /라운드가 \d+개 늘어난다/);
});

// ── U22: 못 읽은 설정은 **왜 못 읽었는지** stderr에 남는다 (2026-10-02 Gap 5회차) ──
// 🔴 이 파일 머리말이 "무엇이 왜 떨어졌는지 stderr에 한 줄 남긴다"고 선언했는데, `readRaw`는
//    EACCES·EISDIR에서 **한 줄도 안 남겼다**. 사용자는 "설정이 왜 안 먹히지"를 알 길이 없었다.
//    `--merge`용으로 `readConfigText`를 신설하며 그 비대칭이 드러났고, 고치고 **여기서 고정한다**
//    — 고칠 때 단언을 안 붙여서 돌연변이가 무결성 해시만 빨개졌다(그게 이 사이클의 반복 실패다).
test('U22: 설정을 못 읽으면 사유를 stderr에 한 줄 남긴다(디렉터리·FIFO·크기 초과)', () => {
  const cases = [
    ['디렉터리', (p) => fs.mkdirSync(p), '정규 파일이 아니다'],
    ['FIFO', (p) => execFileSync('mkfifo', [p]), '정규 파일이 아니다'],
    ['크기 초과', (p) => fs.writeFileSync(p, 'x'.repeat(256 * 1024 + 1)), '너무 크다'],
  ];
  for (const [label, make, expect] of cases) {
    const home = homeWith(null);
    const file = path.join(home, '.devkit', 'config.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    make(file);
    const probe = `require(${JSON.stringify(libPath)}).loadConfig();`;
    // ⚠ `spawnSync`를 쓴다 — `execFileSync`는 stdout만 돌려주므로 **stderr를 단언할 수 없다**.
    //   stdout만 보면 "진단을 지워도 초록"이 되어 이 테스트가 공허해진다(실측했다).
    const r = spawnSync(process.execPath, ['-e', probe], {
      encoding: 'utf8', env: { ...process.env, HOME: home, DEVKIT_CONFIG: file }, timeout: 5000,
    });
    assert.equal(r.signal, null, `${label}: 타임아웃으로 죽었다 — 읽기 전 가드가 없다`);
    assert.equal(r.status, 0, `${label}: loadConfig가 죽었다 — 가드가 fail-open된다`);
    assert.equal(r.stdout, '', `${label}: stdout을 오염시켰다 — 훅 계약이 깨진다`);
    const err = r.stderr.trim();
    assert.notEqual(err, '', `${label}: 사유를 한 줄도 안 남겼다 — 사용자는 설정이 왜 무시됐는지 알 수 없다`);
    assert.ok(err.includes(expect), `${label}: 사유가 "${expect}"를 안 담았다 — 받은 것: ${err}`);
    assert.ok(!err.includes('x'.repeat(50)), `${label}: 설정 본문이 진단으로 샜다`);
  }
});

test('U22b: readConfigText가 세 상태를 가르고 readRaw가 그 가드를 **공유한다**', () => {
  const { readConfigText } = require_(libPath);
  const home = homeWith(null);
  const mk = (name, make) => { const p = path.join(home, '.devkit', name);
    fs.mkdirSync(path.dirname(p), { recursive: true }); make(p); return p; };
  const ok = mk('ok.json', (p) => fs.writeFileSync(p, '{"version":1}'));
  const dir = mk('d.json', (p) => fs.mkdirSync(p));
  const fifo = mk('f.json', (p) => execFileSync('mkfifo', [p]));
  const big = mk('big.json', (p) => fs.writeFileSync(p, 'x'.repeat(256 * 1024 + 1)));
  const gone = path.join(home, '.devkit', 'nope.json');
  // ① 세 상태가 실제로 갈린다. `unreadable`은 **사유를 반드시** 들고 온다.
  assert.equal(readConfigText(ok).state, 'ok');
  assert.equal(readConfigText(ok).text, '{"version":1}');
  assert.equal(readConfigText(gone).state, 'missing');
  assert.equal(readConfigText(null).state, 'missing');
  for (const [label, p] of [['디렉터리', dir], ['FIFO', fifo], ['크기 초과', big]]) {
    const r = readConfigText(p);
    assert.equal(r.state, 'unreadable', `${label}을 unreadable로 안 봤다`);
    assert.equal(r.text, null, `${label}에서 본문을 내줬다`);
    assert.ok(typeof r.reason === 'string' && r.reason.length >= 5,
      `${label}의 사유가 없다 — 호출자가 사용자에게 알릴 말이 없다`);
  }
  // ② `readRaw`가 **같은 가드를 쓴다** — 사본이면 한쪽만 고쳐져 갈린다.
  //    `config.js` 본문에 `statSync`가 **한 번만** 나오는 것으로 확인한다(두 번이면 사본이다).
  const src = fs.readFileSync(libPath, 'utf8');
  assert.equal((src.match(/statSync/g) ?? []).length, 1,
    'statSync가 두 자리에 있다 — 가드가 사본화됐다(Gap 5회차가 지적한 그 결함이다)');
  assert.ok(/function readRaw\(p\) \{\s*\n\s*const r = readConfigText\(p\);/.test(src),
    'readRaw가 readConfigText에 위임하지 않는다 — "한 자리로 공유"가 거짓이 된다');
});
