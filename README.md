# devkit

Claude Code 플러그인. 개인 개발 워크플로우와 팀 컨벤션을 커맨드·에이전트·훅으로 묶어둔 것.

## 구성

| 종류 | 이름 | 용도 |
|---|---|---|
| Command | `/flow` | **PLAN→DESIGN→구현(TDD)→Gap→리포트 전체 파이프라인** (게이트별 확인) |
| Command | `/plan` | **PDCA 사이클 시작** — PLAN.md → 승인 → DESIGN → 구현 |
| Command | `/spec` | (선택) 요구사항 인터뷰 → SPEC.md — 1단계 문서는 `/plan` |
| Command | `/tdd` | TDD 레드-그린-리팩터 루프로 기능 구현 |
| Command | `/commit` | Conventional Commit (Co-Author 없이, 푸시 X) |
| Command | `/gap` | PLAN/DESIGN 대비 구현 일치도 (Match Rate) — 사이클 필수 단계 |
| Command | `/iterate` | Gap 목표(90%)까지 자동 보완-재분석 루프 (최대 5회) |
| Command | `/review` | 현재 diff 리뷰 (버그·보안·컨벤션) |
| Command | `/report` | 완료 리포트 REPORT.md → 사이클 아카이빙 |
| Command | `/cycles` | PDCA 사이클 목록·열람 (진행 중 + 아카이브) |
| Command | `/ship` | 리뷰 → 커밋 메시지 + PR 초안 (승인 후 실행) |
| Command | `/improve` | 세션 교훈 추출 → 규칙/에이전트 개선 제안 (자기성장) |
| Command | `/kit` `[init]` | 도움말 / `init` 시 레포에 AGENTS.md·settings.json 생성 |
| Agent | `architect` | Design 단계 — 설계 확정 → DESIGN.md (코드 X) |
| Agent | `feature-builder` | 웹 기능 구현 (feature 구조) |
| Agent | `tdd-driver` | 테스트 우선 red-green-refactor 구현 |
| Agent | `code-reviewer` | 읽기전용 코드 리뷰 |
| Agent | `gap-detector` | PLAN/DESIGN 대비 구현 일치도 분석 (Match Rate) |
| Agent | `report-writer` | 사이클 종합 → REPORT.md (정직 리포트) |
| Agent | `test-writer` | 테스트 전략 판단 + 사후 테스트 고정 |
| Skill | `convention-check` | 팀 컨벤션 준수 점검 |
| Skill | `pr-description` | diff → PR 설명 생성 |
| Skill | `visual-verify` | 웹 UI 스크린샷 vision 검증 (브라우저 MCP 필요) |
| Hook | `SessionStart` | 세션 시작 시 팀 규칙 리마인드 + 진행 중 PDCA 사이클 재개 안내 |
| Hook | `UserPromptSubmit` | 기능 요청 감지 → PDCA 사이클 규약 안내 (차단 없이 주입만) |
| Hook | `PreToolUse(Bash)` | 위험 명령 차단 + 새 의존성 설치 차단 |
| Hook | `PreToolUse(Write\|Edit)` | 보호 파일(.env·lockfile·.git) 편집 차단 + **시크릿 감지 차단(secret-guard)** |
| Hook | `PostToolUse(Write\|Edit)` | 자동 prettier 포맷 (+ opt-in `DEVKIT_TSC_ON_EDIT=1` 타입체크) |
| Hook | `Stop` | 종료 시 typecheck/lint 실행·보고 |
| Hook | `PostToolUse(convention-observe)` | 통과한 규칙 위반(no-any·console.log·`.tsx` 로직) 관측 기록 |
| Hook | `PostToolUse(Bash)` | 실행 receipt 봉인 — evidence 인용 대조의 근거 |
| Observability | `.devkit/audit.jsonl` | 차단·통과위반·검증실패 기록 (`/kit audit` 조회) |
| Observability | `.devkit/receipts.jsonl` | Bash 명령·출력 기록 (gitignore 대상, **알려진 키 형식 9종만 마스킹 — 그 외(`export K=V`·DB URL·Bearer 토큰 등)는 평문으로 남는다**, 끄려면 `DEVKIT_RECEIPTS=0`, 지우려면 `rm`) |
| Eval | `test/*.test.mjs` | 정적 eval (훅 동작 + 플러그인 무결성) — `node --test` |
| Eval | `evals/README.md` | 에이전트/스킬 행동 시나리오 (수동·반자동) |
| Template | `templates/eslint.config.mjs` | 네이밍·no-any·에러·200줄·`.tsx` 로직을 **lint로 강제** |
| Template | `templates/ci.yml` | PR에서 typecheck/lint/test/시크릿/`pnpm audit` **머지 게이트** |
| Template | `templates/pre-commit` | 세션 밖(사람 커밋) 시크릿·lint 방어 (`.githooks/`) |
| Script | `scripts/verify-integrity.mjs` | 훅 공급망 변조 조기 탐지 (`node scripts/verify-integrity.mjs`) |
| Doc | `RULES.md` | 팀 개발 규칙 원문 (규칙 단일 소스) |
| Doc | `CHANGELOG.md` | 버전 이력 |

## 설치

Claude Code에서:

```
/plugin marketplace add <이-레포-git-url>
/plugin install devkit@devkit-marketplace
```

세션을 다시 시작한 뒤 `/kit`으로 확인한다.

### 레포에 자동 설치 심기

프로젝트 레포에 `.claude/settings.json`을 커밋해두면 clone 후 신뢰 대화에서 devkit이 자동 활성화된다:

```json
{
  "extraKnownMarketplaces": {
    "devkit-marketplace": { "source": { "source": "github", "repo": "<owner>/devkit" } }
  },
  "enabledPlugins": { "devkit@devkit-marketplace": true }
}
```

`/kit init`을 실행하면 레포에 다음을 한 번에 깔아준다:
- `AGENTS.md` — setup/test/build 명령어 + 스택 + **공통 규칙 인라인**(Claude Code뿐 아니라 Cursor·Codex·Copilot도 읽는 AGENTS.md 표준)
- `eslint.config.mjs` — 규칙을 lint로 강제 (devDep은 승인 후 직접 설치)
- `.github/workflows/ci.yml` — PR 머지 게이트
- `.claude/settings.json` — clone 시 devkit 자동 활성화

### 규칙이 실제로 지켜지는 3단계

1. **리마인드** — 세션 시작에 규칙 요약 주입(`RULES.md` 단일 소스).
2. **하드 차단** — 위험 명령·새 의존성·보호 파일은 가드 훅이 차단하고 `.devkit/audit.jsonl`에 기록.
3. **CI 강제** — 네이밍·no-any·`.tsx` 로직 등은 ESLint + CI 게이트로 PR에서 막음.

## 로컬에서 바로 써보기 (배포 전)

```
/plugin marketplace add ~/devkit
/plugin install devkit@devkit-marketplace
```

## 수정하는 법

- 규칙 바꾸기 → `RULES.md` + `hooks/session-start.js`
- 에이전트 추가 → `agents/<이름>.md` (frontmatter + 본문)
- 커맨드 추가 → `commands/<이름>.md`
- 스킬 추가 → `skills/<이름>/SKILL.md`

전부 디렉토리 컨벤션으로 자동 인식됨 — `plugin.json`에 따로 등록 불필요. 버전 올리면 조직원은 `/plugin update devkit`.
