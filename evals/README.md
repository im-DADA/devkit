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
| **첫 실행 온보딩** (session-start) | 설정 파일을 잠시 치우고(`mv ~/.devkit/config.json ~/.devkit/config.json.bak` — 애초에 없으면 그대로) **새 세션**을 열어 아무 요청이나 한 줄 준다. 끝나면 되돌린다.<br>⚠ `HOME`을 임시 디렉터리로 바꾸지 마라 — 플러그인과 로그인이 둘 다 `~/.claude` 아래라 훅 자체가 안 돌고 검증이 성립하지 않는다(2026-09-22 실측 전 잘못 적었던 방법이다) | 첫 요청을 처리하기 **전에** AskUserQuestion으로 3택(지금 설정 / 기본값으로 쓰고 다시 안 묻기 / 나중에)을 묻는다. "기본값으로"를 고르면 `~/.devkit/config.json`에 `{"version":1}`을 쓰고(보호 파일 확인 창이 뜬다), **세션을 다시 열면 묻지 않는다.** ⚠ 모델이 실제로 묻는지는 기계로 검증할 수 없다 — `test/onboarding.test.mjs`는 "안내가 언제 나오고 안 나오는가"까지만 고정하므로 **이 행이 그 무검증 층을 메우는 유일한 수단**이다. |
| **모델 단계** (`/kit setup`) | `/kit setup`을 끝까지 돌린다 — 한 번은 그대로, 한 번은 `mv ~/.claude/cache/model-catalog ~/.claude/cache/model-catalog.bak`로 카탈로그를 치운 뒤(끝나면 되돌린다), 한 번은 `PATH`에서 `codex`를 가린 셸로. 이어서 `/kit setup models tdd-driver`와 `/kit setup 구현은 Codex로`도 한 번씩. ⚠ `HOME`을 바꾸지 마라(온보딩 행과 같은 이유) | **총 1라운드에 문항 2개**(`설정 범위`·`구현 CLI`)로 끝나고 `기본값 그대로`+`Claude로 전부`면 파일은 `{"version":1}` 한 줄이다. `list-models.mjs`를 `--plan`으로 **한 번만** 부르고 캐시 파일을 Read하지 않는다. 각 선택지에 설명이 붙고 **effort는 어디서도 묻지 않는다**. 카탈로그를 치우거나 `codex`를 가리면 **구현 CLI 질문이 아예 뜨지 않고** 사유 1줄이 경고 톤 없이 뜬다. `setup models`는 2라운드 이내이고 `planner`·`architect`·`code-reviewer`·`gap-detector`·`report-writer`에는 Codex 선택지가 없다. 자연어 경로는 **diff를 보여주고 승인 전에는 쓰지 않는다**. ⚠ 마법사는 마크다운이라 기계 검증이 없다 — 문항 수·상한은 `setup-plan.test.mjs`가 보지만 "모델이 실제로 그 문항만 묻는가"는 이 행이 유일한 수단이다 |
| **Codex 단계 실행** | `tdd-driver`만 Codex로 바꾼 뒤 `/tdd`를 돌린다. 그다음 `codex`를 `PATH`에서 가리고 다시 돌린다 | Bash로 `codex exec … -o docs/<사이클>/.codex-tdd-driver.txt -`를 부르고 **stdout을 파싱하지 않는다**(사용자 Codex 훅 출력이 섞인다). `-s workspace-write`가 붙는다. 가린 뒤에는 **Claude 폴백 + 한 줄 보고**가 나오고 `--dangerously-*`는 쓰이지 않는다. ⚠ 실행층의 유일한 검증 수단이다 |

### 판정 기록
반복 실행 시 결과를 `evals/results/<날짜>.md`에 남겨 추이를 본다(pass/fail + 메모). 실패가 반복되면 규칙을 훅/lint로 승격하거나 프롬프트를 강화한다.
