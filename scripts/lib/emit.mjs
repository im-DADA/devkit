// 검증 보고서의 **출력 형태 방벽**. 포매팅(report-format.mjs)과 분리한 이유: 이건 무엇을 어떻게
// 보여줄지가 아니라 "이 stdout이 자기입증 채널이 되지 않는다"는 **인용 대조 계약**이다.
// 계약이 포매팅에 섞여 있으면 템플릿을 손대는 사람이 방벽을 손대는 줄 모른다.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 대조 규칙의 정본에서 가져온다. 두 벌로 두면 citation.js가 SEP·MIN_QUOTE를 바꿀 때
// 아래 형태 규칙이 조용히 무력해진다.
const require = createRequire(import.meta.url);
export const { normalize, MIN_QUOTE, SEP } = require(path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'hooks', 'lib', 'citation.js',
));

// ★ 불변식(이 프로세스의 stdout 전체): 어떤 줄도 인용 대조 후보가 될 수 없다.
// 이 stdout은 bash-receipt가 봉인한다. 그래서 보고서가 자기입증 채널이 되는 조건은
// 정확히 하나 — 이 출력에 "대조 후보가 되는 형태"의 줄이 생기는 것이다.
//
// ⚠ 반전(RULES §"뒤집힌 판단은 원래 기록 자리에"). 여기 있던 처방은 `detick`이었고
//   근거는 "대조는 ✔로 시작하는 줄에서만 일어난다"(citation.js tickLines)였다.
//   **그 근거가 소멸했다**: 대조가 마커 무관 전체 일치로 바뀌면서 ✔ 없는 보고서 줄도
//   후보가 된다. e2e로 재현됐다 — decoy behavior의 id·ref만으로 unresolved 행 한 줄이
//   조립되고, 다른 behavior가 그 줄을 인용하자 1회 봉인 후 2회차에 uncited → cited.
//   `detick`은 그 벡터를 하나도 못 막는다. 그래서 제거했다.
//
// 새 처방은 규칙을 더 얹지 않고 **기존 불변식을 재사용**한다: 인용 조각은 normalize 후
// SEP로 잘려 나오므로 **SEP를 품은 줄은 어떤 인용 조각과도 같아질 수 없다.** 길이 하한도
// 같은 자리에서 쓴다. 열거가 아니라 형태라서 상수 줄·항목 행·조기 종료 출구·--json을
// 한꺼번에 덮고, 새 섹션이 생겨도 안 깨진다.
// 포기한 것: 이 도구는 앞으로 "짧고 SEP 없는 줄"을 **정상적으로도** 낼 수 없다.
//   낼 이유도 없다 — 이 출력은 테스트 러너가 아니다.
export const citable = (line) => {
  const s = normalize(line);
  return s.length >= MIN_QUOTE && !s.includes(SEP);
};

// 접두 하나로는 부족하다: normalize의 소요시간 제거가 **접두 SEP의 뒤 공백을 먹어** 교정 후에도
// citable이 남는다(`  (1234ms)abc · (1234ms)abc`, 리뷰 1회차 🟡1). 접미는 그럴 수 없다 —
// SEP 뒤가 항상 `devkit`이라 소요시간 패턴이 될 수 없기 때문이다. 그래서 접두가 먹힌 경우에만
// 접미로 확정한다(반복 불필요 — 한 번으로 끝난다).
const harden = (line) => {
  const p = `devkit${SEP}${line}`;
  return citable(p) ? `${p}${SEP}devkit` : p;
};

/**
 * 이 프로세스의 **유일한 stdout 출구**. 줄 단위로 형태를 검사하고 위반 줄은 자동 교정한다.
 * 자동 교정은 백스톱이다 — 사람이 템플릿마다 세지 않게 하려는 것이지, 정상 템플릿이
 * 여기 기대라는 뜻이 아니다(정상 보고서에 접두가 붙으면 읽기 나빠진다).
 */
export function emit(text) {
  process.stdout.write(text.split('\n')
    .map((line) => (citable(line) ? harden(line) : line))
    .join('\n'));
}
