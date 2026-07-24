# Changelog

[Keep a Changelog](https://keepachangelog.com/) 형식. 버전은 [SemVer](https://semver.org/).

## [0.10.0] - 2026-07-24

재설계 Phase 2 — 훅 강제 + 진행 추적 3층. Phase 1(0.9.0) 배포 후 실전 재검증에서 드러난 두 결함을 뿌리부터 막는다.

### Fixed
- **D5: `/plan`이 behaviors.json을 안 만들던 문제** — 커맨드 지시만으로는 AI가 빠뜨린다("쓰기가 작업 흐름에 박혀있지 않으면 썩는다"). **"생성 강제"를 포기하고 "소비 시점 게이트"로 전환**(spec-kit `check-prerequisites.sh` 패턴): behaviors.json이 없으면 `/gap`·`/report`가 하드 거부하고, `stop-verify.js`가 백스톱 경고를 낸다. 없으면 다음 단계가 안 열린다.
- **D6: bkit과 상태 스키마 충돌** — bkit이 같이 설치되면 AI가 bkit 스키마(`cycle`/`phase`/`gates`)로 상태를 써서 재개가 깨졌다. `readState`가 양성 시그니처(`version:1`+`cycleId`)만 우리 것으로 받고, `phase`/`gates`/`cycle`이 보이면 `{foreign:"bkit"}`로 명시 감지. SessionStart가 충돌을 경고한다. (Claude Code에 플러그인 간 상태 조율 공식 메커니즘이 없어 자체 방어.)

### Added
- **`hooks/lib/progress.js`** — PROGRESS.md 재개 파서(`identityAnchor`/`tail`). 첫 줄 정체성 앵커로 다른 사이클 저널 오독 방지.
- **`hooks/lib/pdca-state.js`에 `gatePrerequisite`** — behaviors.json 존재 게이트(결정론적).
- **SessionStart 컴팩션 복구** — matcher를 `startup|resume|clear|compact`로. 진행 중 사이클이면 PROGRESS.md 끝 10줄 + behaviors.json 미완료 + `git log -8`을 주입해 컴팩션 후 위치를 복구한다.
- **`/iterate` Breaker** — 5회 소진/2회 정체 시 남은 갭을 parked(근거 기록)/BLOCKED(사용자 보고)로 판결. **"조용한 폐기 금지"** — 모든 판결을 PROGRESS.md에 남긴다.
- 테스트: `test/progress.test.mjs`(7) + pdca-state foreign·게이트 케이스 → 총 85개.

### Changed
- **`.devkit/pdca-state.json`을 4필드로 축소** — `{version, cycleId, stage, status}`. `nextAction`·`matchRates`·`docs`는 각각 PROGRESS.md·behaviors.json·git에서 유도. 넓은 상태 JSON이 null로 썩는 것(bkit 관측) 방지.
- **진행 추적 3층 규약**을 RULES에 명문화 — behaviors.json(토글) / PROGRESS.md(append) / git(커밋).
- `PreCompact`는 도입하지 않음 — 모델에 컨텍스트 주입 불가(공식 확인). 복구는 SessionStart-compact 전담.
- **B4(SubagentStop 산출물 검증)는 Phase 3으로 미룸** — stage와 agent가 1:1이 아니라 오탐 여지가 있고 경고만이라 효과가 약함. 반쯤 만드는 것보다 안 만드는 게 낫다.

## [0.9.0] - 2026-07-24

재설계 Phase 1 — 버그 수정 + **검증 무결성**. 실전 도그푸딩과 리서치 3종(bkit 실사용 분석 / 외부 하네스 벤치마킹 / 품질게이트 문헌)에 근거한다.

### Fixed
- **Stop 훅 출력이 Claude에게 전달되지 않던 버그** — stdout이 컨텍스트로 들어가는 이벤트는 `UserPromptSubmit`·`UserPromptExpansion`·`SessionStart` 셋뿐이다. Stop은 예외에 없어 typecheck/lint 실패가 디버그 로그로만 갔다. `hookSpecificOutput` JSON으로 교체.
- **`stop_hook_active` 가드 추가** — Stop 훅 재진입 시 검증을 반복하지 않는다. 향후 차단형으로 바꿀 때 무한루프 방지의 전제이기도 하다.
- **`marketplace.json` 버전 불일치**(0.1.0 vs plugin.json 0.8.1) — `claude plugin validate`가 검출. 동기화.

### Added
- **`hooks/lib/behaviors.js`** — `behaviors.json` 검증. **`passes:true`라도 evidence(실행 흔적)가 없으면 읽는 시점에 false로 강등**한다. 파일을 고치지 않고 읽기 시점에 판정하는 이유는, 파일을 고치면 모델이 다시 true로 되돌리는 왕복이 생기기 때문이다.
- **`hooks/lib/test-files.js`** — 테스트 파일 판정 + `git status --porcelain` 파싱. `/iterate` 회차 중 테스트가 수정되면 그 회차 점수를 무효화하기 위한 기반.
- 테스트 24개(behaviors 16 / test-files 8) — 총 64개.

### Changed
- **Match Rate를 게이트에서 신호로 강등.** 통과 기준은 `unproven == 0`(증거 없는 통과 주장이 0건)이다. 근거: 자기 설계를 자기가 채점하면 점수가 인플레된다 — 실사용 관측에서 40여 사이클 중 90% 미만이 0건이었고, 분포가 없으면 그건 측정이 아니라 의례다.
- **gap-detector가 테스트를 반드시 실행**하도록. "코드를 눈으로 읽은 것"은 동작 근거가 아니다. 외부 피드백 없는 자기 검증은 개선이 없거나 악화된다는 것이 일관된 연구 결과다.
- **`/iterate`에 테스트 조작 검사 추가** — 회차 시작 SHA 대비 `git diff`로 테스트 파일 변경을 확인하고, 바뀌었으면 그 회차 점수를 무효로 하고 사람에게 보고한다. 규칙으로 훈계하는 것보다 검사가 강하다.
- **`/plan`이 `behaviors.json`을 전부 `passes:false`로 생성** — 분모를 계획 시점에 고정해 사후 축소를 막는다.
- **slug를 영문 kebab-case로 고정** — 폴더·파일명은 경로 호환성 때문에 영문, 문서 제목·본문은 사용자 언어를 따른다.

## [0.8.1] - 2026-07-23

### Fixed
- **feature-builder의 폴더 구조 드리프트** — 에이전트가 `components/{feature}/{ui,...}`를 지시했으나 RULES.md는 `src/features/{feature}/views/`가 정본이었다. 두 규칙이 달라 구현 결과를 code-reviewer가 위반으로 잡을 수 있었다. 복붙된 규칙을 지우고 RULES 참조로 교체.

### Changed
- **에이전트가 RULES.md를 실제로 읽게 배선** — 기존엔 7개 중 code-reviewer만 참조했고 나머지는 지식을 복붙했거나 아예 없었다. architect·feature-builder·tdd-driver·test-writer·gap-detector·code-reviewer에 "시작 전 해당 절을 Read" 지시 추가. 줄번호가 아니라 **섹션 제목**으로 참조해 문서가 바뀌어도 안 깨진다.
- **test-writer를 테스트 전략가로 재정의** — 호출 경로가 없던 고아 에이전트였다. RULES "테스트 / TDD"의 대상별 전략(순수로직=TDD / UI=시각검증 / API=통합)을 담고, `/flow`·`/iterate`에 배선. 에이전트 개수는 그대로 7개.
- **code-reviewer 보안 리뷰 강화** — 4단어 나열이던 것을, 가드 훅이 못 잡는 의미론적 취약점(인가 위치·IDOR·테넌트 격리·injection·CSRF·SSRF·시크릿 노출)으로 확장. 출력에 보안 그룹 추가.
- **architect에 도메인 체크리스트 추가** — 데이터 모델·API 계약·상태 관리·보안 배치·동시성·성능. 에이전트를 쪼개지 않고 한 파일에서 커버. 체크리스트가 없으면 "모른다"는 사실조차 인지되지 않는다.
- **`/flow`에 UI 검증 경로 연결** — RULES는 "UI는 시각 검증"이라 정의해놓고 워크플로에 분기가 없어 UI도 코드 대조만 하고 통과했다. Build·Gap 단계에 `visual-verify` 연결.

## [0.8.0] - 2026-07-23

### Added
- **PDCA 사이클 폴더** — 기능 작업 문서를 `docs/{YYYY-MM-DD}-{slug}/`에 PLAN→DESIGN→GAP→REPORT로 남기고, 완료 시 `docs/archive/{날짜}/{slug}/`로 이동. 사이클마다 폴더가 분리돼 히스토리가 보존된다(기존엔 루트 고정 파일명을 덮어썼음). slug는 한글 허용.
- **자동 발동 훅** — `UserPromptSubmit`에 `pdca-detect.js` 신설. 기능 요청을 감지하면 "PLAN부터 쓰고 승인받아라" 규약을 컨텍스트로 주입한다. **프롬프트를 차단하지 않는다**(주입만) — 오탐 시 사용자가 다시 타이핑하는 비용이 크기 때문. 3중 게이트(억제→배제→포함) + 동사 게이트키퍼로 질문·잡담·한 줄 수정을 걸러낸다.
- **사이클 상태 파일** — `.devkit/pdca-state.json`(gitignore)에 현재 사이클·단계·다음 액션·Match Rate 추이를 기록. `session-start`가 이를 읽어 세션 재개 시 진행 상황을 주입한다.
- **`/cycles` 커맨드** — 진행 중·아카이브된 사이클 목록과 문서 열람.

### Changed
- **1단계 문서를 PLAN으로 통일** — `/spec`은 폐기하지 않고 "선택적 보조"로 강등. 커맨드·에이전트가 PLAN.md를 1순위 근거로 삼는다.
- **Gap을 필수 단계로** — `/report`는 `matchRates`가 비어 있으면 중단하고 `/gap`을 먼저 요구한다. `/iterate`도 회차마다 `matchRates`에 기록.
- 에이전트 7종에 **한국어 보고 지시** 추가 — 서브에이전트는 RULES 주입을 받지 못해 영어로 답하는 경우가 있었다.
- `findProjectRoot`를 `hooks/lib/project-root.js`로 추출해 `audit.js`와 신규 훅이 공유.

## [0.7.0] - 2026-07-15

### Added
- **자동 iterate 루프** — `/iterate` 커맨드. gap-detector로 갭을 찾고 tdd-driver/feature-builder로 ❌·⚠️를 메운 뒤 재분석을 목표 Match Rate(기본 90%)까지 반복(최대 5회). 안전장치: 진전 없으면 중단, 테스트/설계 조작 금지, 미달 시 정직 보고.
- **완료 리포트** — `report-writer` 에이전트 + `/report` 커맨드. 사이클 산출물(SPEC/DESIGN/구현/Gap/Review/테스트) 종합 → REPORT.md(한 일·변경 파일·Match Rate 추이·테스트·남은 갭·배운 것). 과장 금지.
- **`/flow` 완결** — 이제 Plan→Design→Build→**Gap+자동보완**→Review→**Report**. bkit PDCA의 Check-Act-Report까지 devkit 자체로 성립.

## [0.6.0] - 2026-07-15

### Added
- **Gap 분석 단계** — `gap-detector` 에이전트 + `/gap` 커맨드. SPEC.md/DESIGN.md의 behavior·계약·파일 계획 대비 실제 구현을 ✅/⚠️/❌로 대조하고 **Match Rate** 산출(읽기전용).
- **`/flow`에 Gap 단계 통합** — Build 다음, Review 앞. Match Rate 90% 미만이면 보완 후 재분석 루프. 이제 flow = Plan→Design→Build→**Gap**→Review.
- bkit의 gap-detector 의존 없이 devkit 자체로 Check(완전성 검증) 단계 성립.

## [0.5.0] - 2026-07-15

### Added
- **파이프라인 오케스트레이터 `/flow`** — 기능 하나를 요구사항→설계→구현(TDD)→리뷰로 끝까지 연결. 각 단계 산출물(SPEC.md→DESIGN.md→코드→리뷰)을 다음으로 넘기고 단계 사이 사용자 확인 게이트.
- **`architect` 에이전트(Design 단계)** — SPEC 기반 설계 확정 → DESIGN.md(접근법·트레이드오프·파일 계획·타입·behavior 매핑·TDD로 고정할 계약·리스크). 코드는 짜지 않음.
- Design 단계가 채워지면서 Plan→Design→Do→Review 풀 사이클이 devkit 자체로 성립(bkit 의존 축소 방향).

### Changed
- TDD 규칙(RULES.md)과 연동 — architect가 "TDD로 고정할 계약"을 뽑아 tdd-driver로 넘김.

## [0.4.0] - 2026-07-13

### Security
- **시크릿 스캔** — `secret-guard` 훅(PreToolUse Write|Edit)이 명백한 키(private key·AWS·GitHub·Slack·Stripe·Google)를 편집 시 차단, 의심(JWT·generic)은 관측. `ci.yml`·`pre-commit`도 재확인.
- **`echo > .env` 우회 차단** — bash-guard가 리다이렉트/tee로 보호 파일에 쓰는 것도 차단(protected-file의 Bash 우회 방지). 패턴을 `hooks/lib/protected-patterns.js`로 공유.
- **pre-commit 템플릿**(`templates/pre-commit`) — Claude 세션 밖(사람 직접 커밋)에서도 시크릿·lint 방어. `/kit init`이 `.githooks/`에 설치.
- **의존성 취약점** — `ci.yml`에 `pnpm audit --audit-level=high`.
- **훅 무결성** — `scripts/{gen,verify}-integrity.mjs` + `INTEGRITY.sha256`로 공급망 변조 조기 탐지.
- **audit 위변조 한계 명시**(RULES.md) — 로컬 관측용, 거버넌스는 CI/원격 수집.

### Added
- **CLAUDE.md 생성**(`/kit init`) — Claude Code 1급 컨텍스트가 `@AGENTS.md`를 참조해 단일 소스 유지.
- **행동 eval 자동화** — `test/agent-contract.test.mjs`(프롬프트 계약 회귀, 자동) + `evals/run.mjs`(claude headless 실행 채점, opt-in).

## [0.3.0] - 2026-07-13

### Added
- **통과 위반 관측** (`hooks/convention-observe.js`) — 가드가 못 막고 통과한 규칙 위반(no-any·console.log·`.tsx` 사이드이펙트/페칭·200줄 초과)을 편집 직후 `.devkit/audit.jsonl`에 비차단 기록. lint 미설치 레포에서도 위반이 가시화됨.
- **정적 eval** (`test/plugin.test.mjs`) — 플러그인 무결성 회귀 방지: agents/commands/skills frontmatter, hooks.json 참조 무결성, marketplace source 경로, RULES.md SUMMARY 마커.
- **행동 eval** (`evals/README.md`) — 에이전트/스킬 시나리오(입력→기대) 기반 수동·반자동 품질 점검.
- **stop-verify 관측 연동** — typecheck/lint 실패를 `verify-fail`로 audit 기록.

### Changed
- `/kit audit`이 이벤트를 유형별(blocked / warn / verify-fail)로 집계.

## [0.2.1] - 2026-07-13

### Fixed
- **lint 에러 폭탄 방지(점진 채택)** — eslint 스타일 규칙을 기본 `warn`으로(빈 catch만 `error`). CI는 error만 fail이라 기존 레포(IUser·any 다수)가 안 깨진다.
- **boolean 접두 규칙 정직화** — type-aware linting 없이는 동작 안 하는 `types:['boolean']` selector를 기본에서 제거하고 opt-in 방법을 주석화(조용한 거짓 강제 제거).
- **`.tsx` 로직 lint 노이즈 완화** — `useState`까지 막던 것을 사이드이펙트·페칭(useEffect/fetch)만으로 축소.
- **CI 견고성** — `pnpm run … --if-present`로 typecheck/lint/test 스크립트 없는 레포도 CI가 안 깨짐.

### Changed
- Stop 훅 타임아웃 90s→60s(침습성 완화).
- RULES.md 압축(.tsx·Feature 구조 예시 간소화), 강제 섹션에 점진 채택·lint 실제 범위 명시.

## [0.2.0] - 2026-07-13

### Added
- **ESLint 룰셋 동봉** (`templates/eslint.config.mjs`) — 네이밍·no-any·에러 미swallow·200줄·`.tsx` 로직 금지를 코드로 강제. 규칙을 "리마인드"에서 "lint 강제"로.
- **CI 게이트 템플릿** (`templates/ci.yml`) — PR에서 typecheck/lint/test 강제.
- **관측성** — 가드 훅의 차단 이벤트를 프로젝트 `.devkit/audit.jsonl`에 기록(`hooks/lib/audit.js`). `/kit audit`로 조회.
- **`/kit init` 강화** — 레포에 `AGENTS.md`(공통규칙 인라인 → Cursor/Codex도 읽힘) + `eslint.config.mjs` + `.github/workflows/ci.yml` + `.claude/settings.json` 생성.
- **훅 회귀 테스트** (`test/hooks.test.mjs`, `node --test`) — 가드 훅 자동 검증.
- **네이밍 컨벤션** 섹션(RULES.md) 및 모노레포 계층(AGENTS.md) 가이드.

### Changed
- **규칙 단일 소스화** — `RULES.md`의 `SUMMARY` 블록이 유일 소스. `session-start.js`가 이를 읽어 주입(문구 중복 제거).
- **bash-guard 강화** — 명령 정규화(백슬래시 개행·다중 공백) 후 검사, base64 파이프 실행 차단.
- 파일·폴더 네이밍을 kebab-case로(심볼은 PascalCase 유지).

## [0.1.0]

### Added
- 초기 구성: 커맨드(spec/plan/tdd/commit/review/ship/improve/kit), 에이전트(feature-builder/tdd-driver/code-reviewer/test-writer), 스킬(convention-check/pr-description/visual-verify), 가드 훅, RULES.md.
