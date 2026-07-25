function applyDiscount(amount) {
  if (amount < 0) {
    amount = 0;
  }
  return Math.round(amount * 0.9);
}

module.exports = { applyDiscount };

// D12 시드 재현 — line 2의 `if (amount < 0)`는 호출부가 음수를 절대 넘기지 않아
// 도달 불가다. discount.fixture.test.mjs는 이 함수를 "검증한다"고 주장하지만
// 그 분기는 한 번도 타지 않는다.
// ⚠ 주석이 파일 아래에 있는 이유: target을 `discount.js:2`로 고정하려면
//   분기 조건이 반드시 2번째 줄이어야 한다(DESIGN §5.3).
