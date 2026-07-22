# devkit evals

devkit의 품질 회귀를 두 층위로 잡는다.

## 1. 정적 eval (자동)

```
node --test
```

- `test/hooks.test.mjs` — 가드 훅이 위험 명령/의존성/보호파일을 실제로 차단하는지.
- `test/plugin.test.mjs` — 플러그인 무결성(frontmatter, 훅 참조, 마켓플레이스 경로, SUMMARY 마커).

CI(`templates/ci.yml`)에 `pnpm test`로 물려두면 회귀가 PR에서 막힌다.

## 2. 행동 eval (에이전트/스킬 — 수동·반자동)

프롬프트 품질은 정적 검사로 못 잡으므로, 아래 시나리오를 **새 세션이나 해당 에이전트에 주고 기대 충족 여부를 판정**한다. 회귀 발견 시 해당 `.md`를 고치고 재실행. (완전 자동 LLM 채점은 도입하지 않음 — 비용·환경 부담 대비 실익이 낮아 의도적으로 제외.)

| 대상 | 입력 | 기대(통과 기준) |
|---|---|---|
| `tdd-driver` | "cartTotal(items) TDD로 구현" | ① 테스트 먼저 ② RED 실행 확인 ③ 최소 구현 ④ GREEN 확인. 구현이 테스트보다 먼저면 **실패** |
| `code-reviewer` | `: any`·빈 `catch {}` 있는 diff | 🔴로 no-any·에러 swallow 지적 + `file:line`. 파일 수정 안 함(읽기전용) |
| `feature-builder` | "UserCard 컴포넌트 추가" | 로직을 `.tsx`에 안 넣고 훅(`.ts`)으로 분리. 파일명 kebab-case |
| `convention-check` | `IUser` + `.tsx`에 `useEffect` | I 접두·`.tsx` 사이드이펙트 위반 보고 |
| `/spec` | 모호한 기능 요청 | AskUserQuestion으로 엣지케이스 인터뷰 → SPEC.md 산출 |
| `/improve` | 마찰 있었던 세션 | 교훈 추출 → 한 번에 하나씩 승인제 제안 → LEARNINGS 기록 |

### 판정 기록
반복 실행 시 결과를 `evals/results/<날짜>.md`에 남겨 추이를 본다(pass/fail + 메모). 실패가 반복되면 규칙을 훅/lint로 승격하거나 프롬프트를 강화한다.
