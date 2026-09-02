# devkit

Claude Code 플러그인. **규칙을 문서로 두지 않고 훅으로 강제하고, "다 됐습니다"를 실행 흔적 없이는 인정하지 않는다.**

개인 개발 워크플로우와 팀 컨벤션을 커맨드 13개 · 에이전트 7개 · 스킬 3개 · 훅 12개로 묶었다.

## 왜 만들었나

규칙을 문서에 적는 것으로는 안 지켜진다. 두 가지가 계속 반복됐다.

**① 규칙을 읽고도 어긴다.** `CLAUDE.md`에 "any 쓰지 마라", "에러 swallow 금지"를 아무리 적어도, 컨텍스트가 길어지면 조용히 사라진다. 규칙이 있는 것과 규칙이 그 순간에 **닿는 것**은 다르다.

**② "테스트 통과했습니다"가 테스트를 안 돌리고 나온다.** 구현이 끝났다는 보고와 실제로 동작하는 것 사이에 검증이 없다. 스스로 세운 계획을 스스로 채점하면 언제나 만점이 나온다.

그래서 규칙은 훅이 차단하고, 완료 주장은 실행 흔적으로만 인정한다.

## 빠른 시작

```
/plugin marketplace add <이-레포-git-url>
/plugin install devkit@devkit-marketplace
```

세션을 다시 시작한 뒤 `/kit`으로 확인한다. (훅·커맨드 변경은 **세션 재시작 후** 반영된다.)

바로 써볼 것:

```
/plan 장바구니에 할인 쿠폰 적용 기능
```

→ `docs/2026-07-29-cart-coupon/`에 `PLAN.md` + `behaviors.json`을 만들고 **승인을 기다린다.** 승인 전엔 구현으로 넘어가지 않는다.

## 어떻게 작동하나

규칙이 지켜지는 층을 셋으로 나눈다. 위로 갈수록 약하고, 아래로 갈수록 우회가 어렵다.

| 층 | 수단 | 성격 |
|---|---|---|
| 1. 리마인드 | `SessionStart` 훅이 `RULES.md`의 요약 블록을 매 세션 주입 | 안내 — 잊는 것을 막는다 |
| 2. 하드 차단 | `PreToolUse` 훅이 위험 명령·새 의존성·보호 파일·시크릿·사이클 규약 위반을 **거부**(exit 2) | 강제 — 어길 수 없다 |
| 3. CI 게이트 | ESLint + GitHub Actions가 PR에서 막음 | 최종 방어 — 세션 밖도 잡는다 |

**"이 경고가 그 상황에 실제로 뜨는가"를 물어야 하는 규칙은 1층에 두지 않는다.** 안내 채널은 저마다 발동 조건이 있고, 그게 규칙이 필요한 상황과 배타적일 수 있다 — 실제로 그래서 새어나간 적이 있다.

## 기능 하나 만들 때 실제 흐름

```
/plan  →  PLAN.md + behaviors.json  →  [승인 대기]  →  (DESIGN.md)  →  구현  →  /gap  →  /review  →  /report
```

- **`docs/{날짜}-{slug}/`** 폴더 하나에 판단의 기록이 전부 남는다. 완료되면 `docs/archive/`로 옮긴다.
- **트랙**: `PLAN.md` 첫머리 `- **track**: Quick|Full` 한 줄로 정한다. **Quick은 `DESIGN.md`와 두 번째 승인만 생략**하고, `behaviors.json`·`/gap`·`/review`·`REPORT.md`는 그대로 필수다.
- **멈춤점**: Full 2곳(PLAN·DESIGN), Quick 1곳(PLAN). 승인 없이 다음 단계로 안 간다.
- **게이트**: `REVIEW.md` 없이 `REPORT.md`를 쓰려 하면 훅이 차단한다. 리뷰를 건너뛰고 완료 보고를 쓸 수 없다.

## 검증 무결성 — 이 플러그인의 핵심

**자기가 세운 계획을 자기가 채점하면 항상 통과한다.** 세 가지로 막는다.

**① 분모를 먼저 고정한다.** `/plan`이 `behaviors.json`에 검증할 동작을 전부 `passes:false`로 박아둔다. 나중에 분모를 줄여서 통과율을 올릴 수 없다.

**② `passes:true`는 증거가 있어야 유효하다.** 각 behavior는 `evidence`(실행한 명령·출력·파일 참조)를 달아야 하고, 참조가 실존하지 않으면 **자동으로 강등**된다. 증거 없는 통과 주장은 통과가 아니다.

**③ 통과 기준은 비율이 아니라 `unproven == 0`이다.** "Match Rate 85%"는 기준이 아니다 — 증거 없는 통과 주장이 **0건**이어야 넘어간다. 미달이면 `/iterate`가 0이 될 때까지 보완·재분석을 돌린다(최대 5회, 소진 시 BLOCKED 판정).

받쳐주는 것들:
- **receipt 봉인** — 실행한 명령과 출력을 남겨, evidence의 인용을 실제 실행과 대조한다(파일·마스킹 범위는 아래 표).
- **무결성 매니페스트** — `INTEGRITY.sha256`이 `hooks/`·`scripts/`의 실행 파일 32개를 해싱한다. 훅이 몰래 바뀌면 `verify-integrity`가 잡는다.
- **감사 로그** — 차단·통과위반·검증실패가 `.devkit/audit.jsonl`에 남는다.

## 구성

<details>
<summary><b>커맨드 13개</b></summary>

| 이름 | 용도 |
|---|---|
| `/flow` | PLAN→DESIGN→구현(TDD)→Gap→리포트 전체 파이프라인 (게이트별 확인) |
| `/plan` | **PDCA 사이클 시작** — PLAN.md → 승인 → DESIGN → 구현 |
| `/spec` | (선택) 요구사항 인터뷰 → SPEC.md — 1단계 문서는 `/plan` |
| `/tdd` | TDD 레드-그린-리팩터 루프로 기능 구현 |
| `/gap` | PLAN/DESIGN 대비 구현 일치도 — 통과 기준 `unproven==0`. 사이클 필수 단계 |
| `/iterate` | `unproven==0`이 될 때까지 자동 보완-재분석 루프 (최대 5회) |
| `/review` | 현재 diff 리뷰 (버그·보안·컨벤션) |
| `/report` | 완료 리포트 REPORT.md → 사이클 아카이빙 |
| `/cycles` | PDCA 사이클 목록·열람 (진행 중 + 아카이브) |
| `/commit` | Conventional Commit (Co-Author 없이, 푸시 X) |
| `/ship` | 리뷰 → 커밋 메시지 + PR 초안 (승인 후 실행) |
| `/web-interface-audit` | UI 코드를 Vercel Web Interface Guidelines(규칙 100+)로 감사 — 규칙은 원격에서 매번 fetch |
| `/design-md` | 프로젝트 디자인 언어를 `DESIGN.md`로 고정 — 코드·git 수정이력·Figma에서 **관측한 것만** 추출 |
| `/merge` `[PR#]` | PR 스쿼시 머지 → 원격 브랜치 삭제 → 로컬 `main` 동기화. 로컬 브랜치 삭제만 확인 |
| `/improve` | 세션 교훈 추출 → 규칙/에이전트 개선 제안 (자기성장) |
| `/kit` `[init]` | 도움말 / `init` 시 레포에 AGENTS.md·settings.json 생성 |

</details>

<details>
<summary><b>에이전트 7개 · 스킬 3개</b></summary>

| 종류 | 이름 | 용도 |
|---|---|---|
| Agent | `architect` | Design 단계 — 설계 확정 → DESIGN.md (코드 X) |
| Agent | `feature-builder` | 웹 기능 구현 (feature 구조) |
| Agent | `tdd-driver` | 테스트 우선 red-green-refactor 구현 |
| Agent | `code-reviewer` | 읽기전용 코드 리뷰 |
| Agent | `gap-detector` | PLAN/DESIGN 대비 구현 일치도 분석 (`unproven==0`) |
| Agent | `report-writer` | 사이클 종합 → REPORT.md (정직 리포트) |
| Agent | `test-writer` | 테스트 전략 판단 + 사후 테스트 고정 |
| Skill | `convention-check` | 팀 컨벤션 준수 점검 (린터가 못 잡는 것 중심) |
| Skill | `pr-description` | diff → PR 설명 생성 |
| Skill | `visual-verify` | 웹 UI 스크린샷 vision 검증 (브라우저 MCP 필요) |

</details>

<details>
<summary><b>훅 12개</b></summary>

| 이벤트 | 파일 | 하는 일 |
|---|---|---|
| `SessionStart` | `session-start` | 팀 규칙 요약 주입 + 진행 중 PDCA 사이클 재개 안내 |
| `UserPromptSubmit` | `pdca-detect` | 기능 요청 감지 → 사이클 규약 안내 (차단 없이 주입만) |
| `PreToolUse(Bash)` | `bash-guard` | 위험 명령 차단 |
| `PreToolUse(Bash)` | `dep-guard` | 새 의존성 설치 차단 |
| `PreToolUse(Write\|Edit)` | `protected-file` | 보호 파일(.env·lockfile·.git) 편집 차단. **`.env`는 통째 덮어쓰기만 막는다** — Edit·신규 생성·`>>` 추가는 통과 |
| `PreToolUse(Write\|Edit)` | `secret-guard` | 시크릿 감지 차단 |
| `PreToolUse(Write\|Edit)` | `pdca-gate` | **PDCA 게이트** — ① 선행 산출물 없이 `GAP.md`·`REPORT.md` 쓰기 차단(`REVIEW.md` 없이 REPORT 불가) ② 상태 파일 스키마 강제 ③ 사이클 폴더에 `.md`/`.json` 아닌 파일 차단(시안·목업·PNG → **대안 경로 안내와 함께**) |
| `PostToolUse(Write\|Edit)` | `post-edit-format` | 자동 prettier 포맷 |
| `PostToolUse(Write\|Edit)` | `tsc-on-edit` | 타입체크 (opt-in — `DEVKIT_TSC_ON_EDIT=1`). `stop-verify`와 **같은 실행 계약**을 쓴다 |
| `PostToolUse(Write\|Edit)` | `convention-observe` | 통과한 규칙 위반(no-any·console.log·`.tsx` 로직) 관측 기록 |
| `PostToolUse(Bash)` | `bash-receipt` | 실행 receipt 봉인 — evidence 인용 대조의 근거 |
| `Stop` | `stop-verify` | 종료 시 typecheck/lint 실행·보고. 패키지 매니저·스크립트명을 **감지**하고, **실행 실패와 진단을 구분**하며(설정 오류·타임아웃을 "타입 에러"라고 말하지 않는다), 단일 tsc 스크립트는 `--incremental`로 돌린다. **보고는 직전 실행 대비 새로 생긴 진단만** — 기존 에러는 건수 1줄로 접힌다. 끄려면 `DEVKIT_VERIFY=off` |

#### 검증 스위치

| 변수 | 값 | 기본 | 의미 |
|---|---|---|---|
| `DEVKIT_VERIFY` | `off`/`0`/`false`/`no` · `typecheck` · `lint` · `typecheck,lint` | 켬(전부) | 상위 스위치. `off`면 `stop-verify`·`tsc-on-edit` 둘 다 완전 침묵 |
| `DEVKIT_TSC_ON_EDIT` | `1` | 꺼짐 | 편집 직후 타입체크. `DEVKIT_VERIFY`가 꺼져 있으면 이것도 안 돈다 |
| `DEVKIT_VERIFY_MODE` | `auto` · `script` | `auto` | `script`면 `--incremental` 직접 실행을 끄고 프로젝트 스크립트만 쓴다 |

알 수 없는 값(`DEVKIT_VERIFY=ture` 같은 오타)은 **검증을 켜둔 채** stderr로 알린다 — 오타 하나로 검증이 조용히 꺼지는 쪽이 더 비싸다.

**훅 설계 원칙**: 판정할 수 없으면 통과시킨다. 훅 자체의 버그가 작업 차단으로 이어지면 안 되므로, 파싱 실패·예상 못한 입력은 전부 fail-open이다.

</details>

<details>
<summary><b>템플릿 · 스크립트 · 관측</b></summary>

| 종류 | 이름 | 용도 |
|---|---|---|
| Template | `templates/eslint.config.mjs` | 네이밍·no-any·에러·200줄·`.tsx` 로직을 **lint로 강제** |
| Template | `templates/ci.yml` | PR에서 typecheck/lint/test/시크릿/`pnpm audit` **머지 게이트** |
| Template | `templates/pre-commit` | 세션 밖(사람 커밋) 시크릿·lint 방어 (`.githooks/`) |
| Script | `scripts/verify-integrity.mjs` | 훅 공급망 변조 조기 탐지 |
| Script | `scripts/bench-delta.mjs` | 보고 주입량 실측 (`--project <path> [--inject]`). 턴1/턴2/에러 주입 후를 바이트로 비교 — "조용해진 것"과 "고장난 것"을 가른다 |
| Script | `scripts/bench-verify.mjs` | `--incremental` 재실행 속도 실측 (`--project <path>`). 대상 프로젝트의 typescript를 쓴다 — devkit은 TS를 설치하지 않는다 |
| Script | `scripts/verify-evidence.mjs` | evidence 적합성 3층 보고 (ref 실존·인용 대조·커버리지). `/gap`이 부른다 — 플러그인 안에 있으므로 `${CLAUDE_PLUGIN_ROOT}` 경로로 호출 |
| Observability | `.devkit/verify-baseline.json` | 직전 검증의 진단 키 집합 (gitignore 대상). 매 턴 같은 에러가 반복 주입되는 것을 막는다 — **새로 생긴 진단만** 보고하는 근거. 브랜치·tsconfig·러너가 바뀌면 자동으로 버려진다. 진단 원문(파일 경로·타입 이름)이 평문으로 들어간다 |
| Observability | `.devkit/audit.jsonl` | 차단·통과위반·검증실패 기록 |
| Observability | `.devkit/receipts.jsonl` | Bash 명령·출력 기록 (gitignore 대상, **알려진 키 형식 9종만 마스킹 — 그 외(`export K=V`·DB URL·Bearer 토큰 등)는 평문으로 남는다**, 끄려면 `DEVKIT_RECEIPTS=0`) |
| Eval | `test/*.test.mjs` | 훅 동작 + 플러그인 무결성 회귀 테스트 — `node --test` |
| Eval | `evals/README.md` | 에이전트/스킬 행동 시나리오 (수동·반자동) |
| Doc | `RULES.md` | 팀 개발 규칙 원문 (**규칙 단일 소스**) |

</details>

## 레포에 심기

`.claude/settings.json`을 커밋해두면 clone 후 신뢰 대화에서 자동 활성화된다:

```json
{
  "extraKnownMarketplaces": {
    "devkit-marketplace": { "source": { "source": "github", "repo": "<owner>/devkit" } }
  },
  "enabledPlugins": { "devkit@devkit-marketplace": true }
}
```

`/kit init`이 한 번에 깔아준다:
- `AGENTS.md` — setup/test/build 명령어 + 스택 + **공통 규칙 인라인** (Cursor·Codex·Copilot도 읽는 표준)
- `eslint.config.mjs` — 규칙을 lint로 강제 (devDep은 승인 후 직접 설치)
- `.github/workflows/ci.yml` — PR 머지 게이트
- `.claude/settings.json` — clone 시 자동 활성화

## 설계 원칙

- **판정은 열거가 아니라 불변식으로.** 허용목록은 차원마다 독립적으로 틀린다 — 넓으면 새고 좁으면 정직한 작업을 막는다. "정규화 이후에 참이어야 하는 성질" 하나를 단언하면 케이스가 늘어도 안 깨진다.
- **검증은 형태가 아니라 동작으로.** 소스 문자열 검색·`Function.length`·항등식으로 쓴 단언은 검증 대상을 지워도 초록인 채로 죽는다.
- **차단은 대안과 함께.** 대안 없는 금지는 교착이고, 교착에서는 같은 자리에 재시도만 반복된다. 모든 차단 메시지는 "그럼 어디에 두라"를 포함한다.
- **판정할 수 없으면 통과시킨다.** 오탐(정직한 작업 차단)이 미탐보다 비싸다.
- **규칙을 바꾸면 그 규칙이 소비되는 모든 자리를 고친다.** 아래 "수정하는 법" 참조.
- **못 한 것은 못 했다고 적는다.** `REPORT.md`와 `CHANGELOG.md`에 "안 닫힌 것" 절이 있는 이유다.

## 수정하는 법

- **규칙 바꾸기 → 네 자리를 함께 본다.** `RULES.md` 본문 → 같은 파일의 `SUMMARY:START~END` 블록 → `agents/*.md` → `skills/*/SKILL.md`·`commands/*.md`.
  - `hooks/session-start.js`는 **고치지 않는다** — SUMMARY 블록을 읽어갈 뿐이라 `RULES.md`만 고치면 된다.
  - ⚠ 본문만 고치면 새 규칙이 배포 시점에 꺼진다 — 세션에 주입되는 건 SUMMARY뿐이다. 문서 두 곳을 다 고쳐도 `agents/`가 옛 규칙대로 코드를 만든다. **기준은 "읽히는 곳"이 아니라 "지시가 실제로 소비되는 곳"이다.**
  - 바꾼 뒤 `grep -rn "<옛 표현>" RULES.md agents/ commands/ skills/`로 잔존 확인.
- 에이전트 추가 → `agents/<이름>.md` (frontmatter + 본문)
- 커맨드 추가 → `commands/<이름>.md`
- 스킬 추가 → `skills/<이름>/SKILL.md`
- 훅 수정 후 → `node scripts/gen-integrity.mjs` + `node --test test/*.test.mjs`

전부 디렉토리 컨벤션으로 자동 인식된다 — `plugin.json`에 따로 등록할 필요 없다. 버전을 올리면 조직원은 `/plugin update devkit`.

## 요구사항

**Node 20+.** 훅과 검증 스크립트가 node로 돌기 때문에 **프로젝트 언어와 무관하게 필요하다** — Python·Go·Rust 전용 레포에서도 마찬가지다(테스트는 pytest·go test·cargo로 돌리되, 검증 층은 node가 돌린다).

## 로컬에서 바로 써보기 (배포 전)

```
/plugin marketplace add ~/devkit
/plugin install devkit@devkit-marketplace
```

## License

MIT
