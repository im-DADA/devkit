// "applyDiscount를 검증한다"고 주장하는 테스트. 양수만 넘긴다 —
// discount.js line 2의 방어 분기를 단 한 번도 타지 않는다. 정확히 D12가 잡아야 하는 상황.
// test/fixtures/ 하위라 `node --test test/*.test.mjs` glob에 걸리지 않는다(명시 실행 전용).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const dir = path.dirname(fileURLToPath(import.meta.url));
const { applyDiscount } = require(path.join(dir, 'discount.js'));

test('applyDiscount: 10% 할인이 적용된다', () => {
  assert.equal(applyDiscount(1000), 900);
  assert.equal(applyDiscount(250), 225);
});
