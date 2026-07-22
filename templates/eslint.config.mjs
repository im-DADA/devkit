// devkit ESLint 룰셋 — 팀 규칙(RULES.md)을 lint로 강제.
//
// 점진 채택(기존 레포 안 깨짐): 스타일 규칙은 기본 'warn'이라 CI(error만 fail)를 통과한다.
//   → 신규/성숙 프로젝트는 아래 'warn'들을 'error'로 올려 강하게 건다.
// 진짜 버그성(빈 catch=에러 swallow)만 처음부터 'error'.
//
// 설치(각 프로젝트 1회): pnpm add -D eslint typescript-eslint @eslint/js
// `/kit init`이 이 템플릿을 복사한다.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'build/**', '.next/**', 'node_modules/**', 'coverage/**'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-empty': ['error', { allowEmptyCatch: false }], // 에러 swallow = 버그
      '@typescript-eslint/no-explicit-any': 'warn', // 기존 레포 배려. 신규는 'error' 권장
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'max-lines': ['warn', { max: 200, skipBlankLines: true, skipComments: true }],
      '@typescript-eslint/naming-convention': [
        'warn',
        { selector: 'default', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'variable', format: ['camelCase', 'UPPER_CASE', 'PascalCase'] },
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'function', format: ['camelCase', 'PascalCase'] },
        { selector: 'typeLike', format: ['PascalCase'] },
        // interface에 I 접두 금지 (IUser ❌ → User)
        { selector: 'interface', format: ['PascalCase'], custom: { regex: '^I[A-Z]', match: false } },
        { selector: 'enumMember', format: ['UPPER_CASE', 'PascalCase'] },
        // boolean is/has/can 접두 규칙은 type-aware linting이 있어야 동작한다.
        // 켜려면: 위 recommended → tseslint.configs.recommendedTypeChecked 로 바꾸고
        //   languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } }
        // 추가한 뒤, 아래 selector를 naming-convention에 넣는다:
        //   { selector: 'variable', types: ['boolean'], format: ['PascalCase'], prefix: ['is','has','can','should'] }
      ],
    },
  },
  {
    // 🔒 .tsx 로직 분리 — 사이드이펙트/페칭만 lint로 강제한다.
    // 로컬 UI 상태(useState) 한 줄까지 막으면 노이즈가 커서 기본에선 제외.
    // 완전 뷰-전용(useState도 훅으로)을 원하면 selector에 'State'를 추가.
    files: ['**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'warn',
        {
          selector: "CallExpression[callee.name=/^use(Effect|LayoutEffect|Reducer)$/]",
          message: '.tsx에 사이드이펙트/복잡 상태 금지 — 커스텀 훅(.ts)으로 분리 (devkit RULES.md)',
        },
        {
          selector: "CallExpression[callee.name='fetch']",
          message: '.tsx에서 데이터 페칭 금지 — api(.ts)/훅으로 분리 (devkit RULES.md)',
        },
      ],
    },
  },
);
