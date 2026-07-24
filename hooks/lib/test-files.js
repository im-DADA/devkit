// 테스트 파일 판정 + git 변경 목록 파싱.
//
// 용도: /iterate 회차 중에 테스트 파일이 수정되면 그 회차의 점수를 무효화한다.
// 근거: 프롬프트로 "테스트 조작 금지"라고 훈계해도 상당 비율로 악용되지만,
// 검출을 구조화하면 사실상 사라진다. 규칙보다 검사가 강하다.
//
// 오탐 방향: 애매하면 테스트 파일로 본다. 결과가 "경고 + 사람 확인"이지 차단이 아니므로
// 놓치는 것(미탐)이 잘못 잡는 것(오탐)보다 비싸다.

// 디렉토리 경계가 정확히 test/tests/__tests__/spec/e2e 인 경우만.
// 'src/latest/'나 'src/contest/'가 걸리지 않도록 경계를 못박는다.
const TEST_DIR_RE = /(^|\/)(test|tests|__tests__|spec|e2e)\//;
// 파일명이 *.test.* 또는 *.spec.* 인 경우 (js/ts/jsx/tsx/mjs/cjs/mts/cts)
const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;

function isTestFile(p) {
  if (typeof p !== 'string' || p.length === 0) return false;
  const normalized = p.replace(/\\/g, '/');
  return TEST_DIR_RE.test(normalized) || TEST_FILE_RE.test(normalized);
}

/** 변경 파일 목록에서 테스트 파일만 추린다 */
function pickTestFiles(paths) {
  if (!Array.isArray(paths)) return [];
  return paths.filter(isTestFile);
}

/**
 * `git status --porcelain` 출력에서 경로만 뽑는다.
 * 미커밋 변경까지 봐야 조작을 놓치지 않는다(커밋 diff만 보면 working tree 수정이 빠짐).
 * 이름 변경(`R old -> new`)은 도착 경로를 쓴다.
 */
function parsePorcelain(out) {
  if (typeof out !== 'string') return [];
  return out
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const rest = line.slice(3); // 앞 2칸은 상태코드, 1칸은 공백
      const arrow = rest.indexOf(' -> ');
      return arrow === -1 ? rest : rest.slice(arrow + 4);
    })
    .filter((p) => p.length > 0);
}

module.exports = { isTestFile, pickTestFiles, parsePorcelain, TEST_DIR_RE, TEST_FILE_RE };
