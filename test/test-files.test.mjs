// 테스트 파일 판정 — /iterate 회차 중 테스트가 수정되면 그 회차 점수를 무효화하기 위한 기반.
// 근거: 프롬프트로 "테스트 조작 금지"를 훈계해도 76% 비율로 악용되지만(ImpossibleBench),
// 접근/검출을 구조화하면 거의 0으로 떨어진다.
// 오탐 방향: 애매하면 테스트 파일로 본다(경고가 나올 뿐 차단이 아니므로 안전한 쪽).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { isTestFile, pickTestFiles, parsePorcelain } = require(
  path.join(dir, '..', 'hooks', 'lib', 'test-files.js'),
);

const TEST_PATHS = [
  'test/foo.mjs',
  'tests/foo.js',
  '__tests__/foo.tsx',
  'spec/foo.rb',
  'e2e/checkout.ts',
  'src/utils/discount.test.ts',
  'src/utils/discount.spec.tsx',
  'src/lib/x.test.mts',
  'packages/a/test/b.js',
  'src/features/cart/__tests__/cart.ts',
];

const NON_TEST_PATHS = [
  'src/utils/discount.ts',
  'src/app/page.tsx',
  'README.md',
  'package.json',
  'hooks/lib/behaviors.js',
  'src/latest/index.ts', // "test"가 부분 문자열로 들어간 함정
  'src/contest/index.ts',
  'docs/2026-07-24-x/PLAN.md',
];

test('isTestFile: 테스트 디렉토리·파일명 규칙을 잡는다', () => {
  for (const p of TEST_PATHS) {
    assert.equal(isTestFile(p), true, `테스트로 봐야 함: ${p}`);
  }
});

test('isTestFile: 일반 소스는 테스트로 보지 않는다', () => {
  for (const p of NON_TEST_PATHS) {
    assert.equal(isTestFile(p), false, `테스트가 아님: ${p}`);
  }
});

test('isTestFile: 잘못된 입력에 throw하지 않는다', () => {
  for (const bad of [null, undefined, '', 42, {}]) {
    assert.equal(isTestFile(bad), false);
  }
});

test('pickTestFiles: 변경 목록에서 테스트 파일만 걸러낸다', () => {
  const changed = ['src/a.ts', 'test/a.test.ts', 'README.md', 'src/b.spec.ts'];
  assert.deepEqual(pickTestFiles(changed), ['test/a.test.ts', 'src/b.spec.ts']);
});

test('pickTestFiles: 빈 입력·비배열도 안전', () => {
  assert.deepEqual(pickTestFiles([]), []);
  assert.deepEqual(pickTestFiles(null), []);
});

// git status --porcelain 파싱 — 미커밋 변경도 잡아야 조작을 놓치지 않는다
test('parsePorcelain: 상태코드를 떼고 경로만 뽑는다', () => {
  const out = [
    ' M src/utils/discount.ts',
    '?? test/new.test.ts',
    'A  src/b.ts',
    'MM test/a.test.ts',
  ].join('\n');
  assert.deepEqual(parsePorcelain(out), [
    'src/utils/discount.ts',
    'test/new.test.ts',
    'src/b.ts',
    'test/a.test.ts',
  ]);
});

test('parsePorcelain: 이름 변경(R)은 도착 경로를 쓴다', () => {
  const out = 'R  test/old.test.ts -> test/new.test.ts';
  assert.deepEqual(parsePorcelain(out), ['test/new.test.ts']);
});

test('parsePorcelain: 빈 출력은 빈 배열', () => {
  assert.deepEqual(parsePorcelain(''), []);
  assert.deepEqual(parsePorcelain('\n\n'), []);
});
