---
name: kit
description: devkit 도움말·초기화. 인자 없으면 도움말, `init`이면 현재 프로젝트에 AGENTS.md + .claude/settings.json 생성.
argument-hint: "[init]"
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash
---

# /kit

인자에 따라 분기한다.

## `init` — 현재 프로젝트 초기화

`$ARGUMENTS`가 `init`이면 아래를 수행한다:

1. **프로젝트 감지**: `package.json`을 Read. `scripts`(dev/build/test/lint/typecheck)와 `packageManager`, 주요 의존성(next/react/vite 등)을 파악. 없으면 사용자에게 스택을 한 번 물어본다.
2. **`AGENTS.md` 생성** (이미 있으면 덮어쓰지 말고 diff만 제안). 명령어는 실제 `scripts`에서 가져온 것만, 추측 금지. 비어있으면 그 줄 생략. **팀 공통 규칙은 링크가 아니라 `AGENTS.md`에 인라인**한다 — 그래야 Claude Code뿐 아니라 Cursor·Codex·Copilot도 읽는다. 플러그인 `RULES.md`의 `SUMMARY:START~END` 블록을 Read해서 "## 공통 규칙"으로 그대로 붙여넣는다:
   ```markdown
   # AGENTS.md

   > 이 레포의 AI 에이전트 지침(AGENTS.md 표준). 공통 규칙 + 이 레포 고유 규칙.

   ## Setup / Commands
   - install: `<pm> install`
   - dev / build / test: `<pm> run dev` / `<pm> run build` / `<pm> run test`
   - lint / typecheck: `<pm> run lint` / `<pm> run typecheck`

   ## Tech Stack (버전 핀닝)
   - <감지된 스택 + 버전>
   - 패키지 매니저: <pm> — DO NOT use 다른 매니저

   ## 공통 규칙
   <devkit RULES.md의 SUMMARY 블록 내용을 그대로 인라인>

   ## This repo only
   - <devkit 기본과 다른 것만. 예: I 접두 사용, 특수 폴더 구조>

   ## Do NOT
   - <이 레포에서 하면 안 되는 것>
   ```
3. **`CLAUDE.md` 생성**(없을 때만): Claude Code 1급 컨텍스트가 AGENTS.md를 가리키게 해서 단일 소스 유지 — 내용은 `# CLAUDE.md\n\n이 레포 지침은 @AGENTS.md 를 따른다.` (Claude Code의 `@import`).
4. **`eslint.config.mjs` 복사**: `${CLAUDE_PLUGIN_ROOT}/templates/eslint.config.mjs` → 레포 루트(이미 eslint 설정 있으면 덮지 말고 병합안 제안). 필요 devDep(`eslint typescript-eslint @eslint/js`)은 **직접 설치하지 말고** 사용자에게 안내만(새 의존성은 승인제).
5. **CI 워크플로 복사**: `${CLAUDE_PLUGIN_ROOT}/templates/ci.yml` → `.github/workflows/ci.yml`.
6. **pre-commit 설치**(세션 밖 방어): `${CLAUDE_PLUGIN_ROOT}/templates/pre-commit` → `.githooks/pre-commit`, `chmod +x`, 그리고 `git config core.hooksPath .githooks`. 사람이 터미널에서 직접 커밋해도 시크릿·lint가 걸린다.
7. **`.claude/settings.json` 생성/병합**: `enabledPlugins`에 devkit 선언 + `.devkit/` 쓰기 사전 승인(**기존 키는 보존 병합**):
   ```json
   {
     "enabledPlugins": { "devkit@devkit-marketplace": true },
     "permissions": { "allow": ["Write(.devkit/pdca-state.json)", "Edit(.devkit/pdca-state.json)"] }
   }
   ```
   PDCA 상태 파일은 단계마다 갱신되므로 없으면 매번 승인 프롬프트가 뜬다. **범위는 그 파일 하나로 좁힌다** — `.devkit/**`로 넓히면 가드 훅의 차단 기록이 쌓이는 `.devkit/audit.jsonl`까지 무프롬프트 덮어쓰기 대상이 되어 관측 기능을 스스로 약화시킨다. 프로젝트 상대경로만 넣는다 — 플러그인 설치 경로는 사용자·OS마다 달라 공유 설정에 넣을 수 없다.
   마켓플레이스가 조직 git이면 `extraKnownMarketplaces`도 함께 안내(README 참조).
8. **`.gitignore`에 `.devkit/` 추가** 제안(감사 로그는 로컬 산출물).
9. 생성/변경한 파일 목록을 보고한다. 커밋은 하지 않는다(사용자 요청 시에만).

## `audit` — 관측성 조회

`$ARGUMENTS`가 `audit`이면 `.devkit/audit.jsonl`을 Read해서 `action`별로 집계한다. 파일 없으면 "이벤트 없음". 세 종류:
- `blocked` — 가드 훅이 **차단**한 위험 명령/의존성/보호파일.
- `warn` — convention-observe가 관측한 **통과한 규칙 위반**(no-any·console.log·`.tsx` 로직·200줄). 차단은 안 됐지만 남은 것.
- `verify-fail` — 종료 시 typecheck/lint 실패.

예:
```
관측 요약 (총 24건)
  차단(blocked) 12 · 통과위반(warn) 9 · 검증실패(verify-fail) 3
통과 위반 rule별: no-any 5 · tsx-side-effect 3 · console.log 1
최근:
  2026-07-13T… blocked      bash-guard    git reset --hard
  2026-07-13T… warn         convention-observe  user-card.tsx (no-any:L12)
```

## 인자 없음 — 도움말

아래 도움말을 출력한다:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  devkit — 팀 개발 킷
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

커맨드
  /flow     기능 하나 PLAN→DESIGN→구현(TDD)→Gap→리포트 전체 파이프라인
  /plan     사이클 시작 — PLAN.md 작성 → 승인 → DESIGN → 구현
  /spec     (선택) 요구사항 인터뷰 → SPEC.md — 1단계 문서는 /plan
  /tdd      TDD 레드-그린-리팩터 루프
  /commit   Conventional Commit (Co-Author 없이, 푸시 X)
  /gap      PLAN/DESIGN 대비 구현 일치도 (Match Rate) — 사이클 필수 단계
  /iterate  Gap 목표(90%)까지 자동 보완-재분석 루프
  /review   현재 diff 리뷰 (버그·보안·컨벤션) → REVIEW.md — 사이클 필수 단계
  /report   완료 리포트 REPORT.md → 사이클 아카이빙
  /cycles   PDCA 사이클 목록·열람 (진행 중 + 아카이브)
  /ship     리뷰 → 커밋 메시지 + PR 초안 (승인 후)
  /improve  세션 교훈 추출 → 규칙/에이전트 개선 제안 (자기성장)
  /kit      이 도움말
  /kit init 현재 프로젝트에 AGENTS.md + eslint + CI + settings.json 생성
  /kit audit 차단 이벤트(.devkit/audit.jsonl) 집계 조회

에이전트 (자동 위임 또는 요청 시)
  architect         Design 단계 — 설계 확정 → DESIGN.md
  feature-builder   웹 기능 구현 (feature 구조)
  tdd-driver        테스트 우선 red-green-refactor 구현
  code-reviewer     읽기전용 코드 리뷰
  gap-detector      PLAN/DESIGN 대비 구현 일치도 분석
  report-writer     사이클 종합 → REPORT.md
  test-writer       테스트 전략 판단 + 사후 테스트 고정

스킬 (모델 자동 호출 / 직접 호출)
  convention-check  팀 컨벤션 준수 점검
  pr-description    diff → PR 설명 생성
  visual-verify     웹 UI 스크린샷 vision 검증 (브라우저 MCP)

훅 (자동)
  SessionStart      팀 규칙 리마인드 + 진행 중 PDCA 사이클 재개 안내
  UserPromptSubmit  기능 요청 감지 → PDCA 사이클 규약 안내 (차단 없음)
  PreToolUse    위험 bash 차단 · 새 의존성 차단 · 보호파일(.env/lock) 차단
                PDCA 게이트 — GAP/REPORT 선행 산출물 없으면 쓰기 거부 · 상태 4필드 스키마 강제
  PostToolUse   자동 prettier 포맷 · 통과 위반 관측(convention-observe) (+ opt-in tsc)
  Stop          종료 시 typecheck/lint 실행·보고
  관측성        차단·통과위반·검증실패를 .devkit/audit.jsonl 기록 (/kit audit)
  품질(eval)    node --test (정적) · evals/README.md (행동 시나리오)

템플릿 (/kit init 시 레포에 설치)
  eslint.config.mjs   네이밍·no-any·.tsx로직 lint 강제
  ci.yml              PR typecheck/lint/test 머지 게이트
  AGENTS.md           공통규칙 인라인 (Cursor/Codex 호환)

규칙: RULES.md (규칙 단일 소스, 세션 시작 시 요약 리마인드)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
