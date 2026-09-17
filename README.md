# devkit

Claude Code 플러그인. **되돌릴 수 없는 사고는 훅으로 막고, "다 됐습니다"는 실행 흔적 없이 인정하지 않는다.**

개인 개발 규칙과 워크플로우를 커맨드 14개 · 에이전트 8개 · 스킬 5개 · 훅 12개로 묶었다. 주 무대는 Claude Code이고, Codex에는 같은 규칙의 사본(`~/.codex/AGENTS.md`)이 들어간다.

## 왜 만들었나

**① 규칙을 읽고도 어긴다.** `CLAUDE.md`에 "any 쓰지 마라"를 적어도 컨텍스트가 길어지면 흐려진다. 규칙이 **있는 것**과 그 순간에 **닿는 것**은 다르다.

**② "테스트 통과했습니다"가 테스트를 안 돌리고 나온다.** 스스로 세운 계획을 스스로 채점하면 언제나 만점이 나온다.

그래서 규칙은 필요한 순간에 다시 주입하거나 훅으로 막고, 완료 주장은 실행 흔적으로만 인정한다.

## 설치

```
/plugin marketplace add https://github.com/im-DADA/devkit
/plugin install devkit@devkit-marketplace
```

세션을 다시 시작한 뒤 `/kit`으로 확인한다. 훅·커맨드 변경은 **새 세션**부터 반영된다.

로컬 clone으로 쓰려면 `/plugin marketplace add <clone한 경로>` — 이 경우 커밋하지 않은 수정도 바로 반영된다.

## 규칙이 닿는 방식

| 층 | 수단 | 성격 |
|---|---|---|
| 1. 주입 | `SessionStart`가 `RULES.md`의 요약 블록을 주입 · 매 프롬프트마다 출력 언어·서식 1줄씩 · 편집 직후 규칙 위반(`any`·`console.log`·빈 catch·`.tsx` 로직·200줄)을 Claude에게 알림 | 안내 — 막지 않는다 |
| 2. 거부·확인 | `PreToolUse` 훅. 되돌릴 수 없는 것(위험 명령·`.env` 덮어쓰기·`.git` 내부·시크릿·리뷰 없는 REPORT)은 **거부**(exit 2). 사용자가 정할 것(새 의존성·lockfile·`node_modules`·`chmod -R 777`)은 **확인 창**(ask) | 사고만 강제, 나머지는 사용자 판단 |
| 3. 레포 게이트 (선택) | `/kit init`이 까는 CI·pre-commit·eslint 템플릿 | 세션 밖 — 설정 나름 (아래 "레포에 심기") |

## Codex와 같이 쓰기

규칙 원문은 `RULES.md` 하나다. 개인 규칙을 `~/.claude/CLAUDE.md`에 따로 두지 않는다.

| 대상 | 규칙이 들어가는 길 |
|---|---|
| Claude Code | `SessionStart` 훅이 `SUMMARY` 블록 주입 + 훅이 강제 |
| Codex | `~/.codex/AGENTS.md`의 마커 구간에 `CODEX` 블록 사본. **Codex에는 devkit 훅이 없어 문구로만 지킨다** |
| 응답 언어 | Claude Code는 `~/.claude/settings.json`의 `"language"`. Codex는 `AGENTS.md` 머리말에 한 줄 |

처음 한 번:
1. `~/.codex/AGENTS.md`에 마커 두 줄을 넣는다 — `<!-- devkit:rules:start mode=managed -->` / `<!-- devkit:rules:end -->`
2. Claude Code에서 `/kit sync` → diff 확인 후 승인하면 **마커 안만** 교체된다. 파일이 없으면 만들지 않고, 마커가 없으면 위치만 제안한다.

이후 `RULES.md`가 바뀌어 사본이 낡으면 Claude Code 세션 시작 때 2줄 경고가 뜬다 → `/kit sync`. 일부러 고쳐 쓰는 사본이면 마커를 `mode=custom`으로 바꾸면 경고가 멈춘다.

> Codex를 승인·샌드박스 없이 실행하면 `.env` 덮어쓰기나 운영 DB 쓰기를 막는 장치는 `AGENTS.md` 문구뿐이다. 실행 권한 설정을 확인할 것.

## 기능 하나 만들 때

```
/plan  →  PLAN.md + behaviors.json  →  [승인]  →  (DESIGN.md → [승인])  →  구현  →  /gap  →  /review  →  /report
```

- **`docs/{날짜}-{slug}/`** 폴더에 판단 기록이 남고, `/report` 후 `docs/archive/{날짜}/{slug}/`로 옮긴다. slug는 영문 소문자 kebab-case.
- **트랙**: `PLAN.md` 첫머리 `- **track**: Quick|Full`. Quick은 `DESIGN.md`와 두 번째 승인만 생략하고 `behaviors.json`·`/gap`·`/review`·`REPORT.md`는 그대로 필수.
- **모델 배분**: 계획(`planner`)과 설계(`architect`)는 에이전트로 떼어 더 강한 모델로 돌린다. 파일은 메인 세션이 쓴다.
- 기능 요청처럼 보이는 프롬프트에는 `UserPromptSubmit` 훅이 사이클 규약을 주입한다. 표현만 보고 판단하므로 작은 작업이면 무시하라고 함께 적혀 있다.

## 검증 무결성

**① 분모를 먼저 고정한다.** `/plan`이 `behaviors.json`에 검증할 동작을 전부 `passes:false`로 넣는다.

**② `passes:true`는 증거가 있어야 유효하다.** `evidence`는 `{kind, ref, cmd, output, at}`. kind가 `test`/`visual`/`manual`이 아니거나, ref가 비었거나, output이 10자 미만이면 **통과로 세지 않는다**.

**③ 통과 기준은 `unproven == 0`이다.** Match Rate 숫자가 아니라 증거 없는 통과 주장이 0건이어야 한다. 미달이면 `/iterate` — 최대 5회, 같은 갭이 2회 연속 안 줄면 중단, 회차 중 테스트 파일이 바뀌면 그 회차 점수 무효.

**④ REPORT는 훅이 막는다.** `behaviors.json`·`GAP.md`·`REVIEW.md` 중 하나라도 없거나 비었거나, evidence의 ref가 가리키는 파일이 없으면 `REPORT.md` 쓰기가 거부된다.

받쳐주는 것:
- **receipt** — Bash 명령·출력을 `.devkit/receipts.jsonl`에 남겨 evidence 인용과 대조한다(`/gap`의 `verify-evidence`). 알려진 키 형식 11종만 마스킹하고 그 외는 평문으로 남는다.
- **감사 로그** — 거부·확인·경고·검증 결과가 `.devkit/audit.jsonl`에 남는다. `/kit audit`로 집계.
- **무결성 매니페스트** — `INTEGRITY.sha256`이 `hooks/`·`scripts/`의 실행 파일 45개를 해싱한다. **수동 실행**: `node scripts/verify-integrity.mjs`. `agents`·`commands`·`skills`의 `.md`는 대상이 아니다.

## 구성

<details>
<summary><b>커맨드 14개</b></summary>

| 이름 | 용도 |
|---|---|
| `/plan` | 사이클 시작 — planner가 탐색·초안 → PLAN.md + behaviors.json → 승인 대기 |
| `/flow` | PLAN → DESIGN → 구현(TDD) → Gap → 리뷰를 단계별 확인하며 한 흐름으로 |
| `/spec` | (선택) 요구사항 인터뷰 → SPEC.md |
| `/tdd` | 레드-그린-리팩터 루프로 구현 |
| `/gap` | PLAN/DESIGN 대비 구현 일치도. 기준 `unproven==0` |
| `/iterate` | `unproven==0`까지 보완→재분석 반복 (최대 5회) |
| `/review` | 현재 diff 리뷰(버그·보안·컨벤션). 사이클 중이면 REVIEW.md로 남김 |
| `/report` | REPORT.md 작성 → 사이클 아카이브 |
| `/cycles` | 진행 중·아카이브 사이클 목록과 문서 열람 |
| `/commit` | Conventional Commit, Co-Authored-By 없음, 푸시 안 함. main 브랜치면 먼저 확인 |
| `/ship` | 리뷰 → 커밋 메시지·PR 설명 초안 → 커밋/푸시 전 확인 |
| `/merge` `[PR#]` | 스쿼시 머지 → 원격 브랜치 삭제 → 로컬 main 동기화. 로컬 브랜치 삭제만 확인. fast-forward가 안 되면 멈추고 묻는다 |
| `/improve` | 최근 작업의 교훈 추출 → 규칙·에이전트 개선을 하나씩 제안(승인제) |
| `/kit` `[init\|sync\|audit]` | 도움말 / 레포 초기화 / 프로젝트 `AGENTS.md`·전역 `~/.codex/AGENTS.md` 규칙 사본 갱신 / 감사 로그 집계 |

</details>

<details>
<summary><b>에이전트 8개 · 스킬 5개</b></summary>

| 에이전트 | 용도 | 모델 · effort |
|---|---|---|
| `planner` | Plan — 읽기전용 탐색 → PLAN.md 본문 | fable · max |
| `architect` | Design — 설계 확정 → DESIGN.md 본문 | fable · max |
| `feature-builder` | feature 구조에 맞춰 구현 | opus · medium |
| `tdd-driver` | 테스트 우선 구현 | opus · medium |
| `code-reviewer` | 읽기전용 리뷰 | opus · high |
| `gap-detector` | 구현 일치도 분석 | sonnet · high |
| `test-writer` | 테스트 전략 + 사후 테스트 | sonnet · medium |
| `report-writer` | REPORT.md 본문 | sonnet · low |

모델·effort는 에이전트 frontmatter에 고정돼 있다. 훅은 메인 세션 모델을 바꿀 수 없어서 단계를 에이전트로 떼어냈다. 평소 대화·구현은 세션 기본값을 따른다.

스킬은 모두 `/이름`으로도 부를 수 있다.

| 스킬 | 용도 |
|---|---|
| `convention-check` | 컨벤션 준수 점검(린터가 못 잡는 것 중심) |
| `pr-description` | diff → PR 설명 |
| `visual-verify` | 웹 UI 스크린샷 검증 (브라우저 MCP 필요) |
| `web-interface-audit` | Vercel Web Interface Guidelines로 UI 코드 감사 — 규칙은 매번 원격에서 받음 |
| `design-md` | 코드·git 수정이력·Figma에서 **관측한 것만** 모아 디자인 언어를 `DESIGN.md`로 고정 |

</details>

<details>
<summary><b>훅 12개</b></summary>

| 이벤트 | 파일 | 하는 일 |
|---|---|---|
| `SessionStart` | `session-start` | 규칙 요약 주입, 진행 중 사이클 재개 안내(단계·통과 수·PROGRESS 끝·최근 커밋), 프로젝트 `AGENTS.md`·전역 Codex 사본이 낡았으면 2줄 경고 |
| `UserPromptSubmit` | `pdca-detect` | 매 프롬프트 출력 언어·서식 지시 주입. 사이클 진행 중이면 재개 안내, 아니고 기능 요청처럼 보이면 사이클 규약 안내. 프롬프트를 막지 않는다 |
| `PreToolUse(Bash)` | `bash-guard` | 거부: 위험 경로 `rm -rf`, `push --force`(`--force-with-lease` 제외), `reset --hard`, `clean -f`, `curl\|sh` 류, `.env` 잘라쓰기, `.git` 리다이렉트. 확인: `chmod -R 777`, lockfile·`node_modules` 리다이렉트. 섞이면 거부가 이긴다 |
| `PreToolUse(Bash)` | `dep-guard` | 새 의존성 설치 → 확인 창. 라이브러리 없는 설계로 몰래 우회하지 말라고 Claude에게 따로 알림 |
| `PreToolUse(Write\|Edit)` | `protected-file` | 거부: `.env` 통째 덮어쓰기(`.env.example` 등 템플릿 제외), `.git/` 내부. 확인: lockfile, `node_modules` |
| `PreToolUse(Write\|Edit)` | `secret-guard` | 확실한 키 형식 8종(private key·AWS·GitHub 2종·Slack·Stripe live·Google·Anthropic) 거부. JWT·`password = '...'` 같은 의심 패턴은 감사 로그에만 |
| `PreToolUse(Write\|Edit)` | `pdca-gate` | 거부: 선행 산출물 없는 `GAP.md`·`REPORT.md`, evidence ref가 없는 REPORT. 경고: 상태 파일 스키마 위반, 사이클 폴더의 `.md`/`.json` 아닌 파일 |
| `PostToolUse(Write\|Edit)` | `post-edit-format` | 프로젝트에 prettier(`node_modules/.bin`)가 있을 때만 포맷 |
| `PostToolUse(Write\|Edit)` | `tsc-on-edit` | 편집 직후 타입체크 (opt-in `DEVKIT_TSC_ON_EDIT=1`) |
| `PostToolUse(Write\|Edit)` | `convention-observe` | 규칙 위반을 Claude에게 알림(막지 않음). Edit은 **이번에 넣은 코드만**, 200줄은 **이번 편집으로 넘었을 때만**. 로직 파일에 테스트가 없으면 넛지 |
| `PostToolUse(Bash)` | `bash-receipt` | 명령·출력 receipt 기록 |
| `Stop` | `stop-verify` | 응답 종료 시 typecheck/lint 실행·보고(막지 않음). 패키지 매니저·스크립트 감지, 실행 실패와 코드 진단을 구분, **직전 실행 대비 새 진단 위주로** 보고 |

**판정 원칙**: 입력을 파싱할 수 없으면 통과시킨다(훅 버그가 작업을 막지 않게). 예외로, 리다이렉트 대상이 `$변수`·glob이거나 `cd`와 섞여 경로를 확정할 수 없으면 **보호 파일로 간주해 거부**한다.

#### 환경변수

| 변수 | 값 | 기본 | 의미 |
|---|---|---|---|
| `DEVKIT_VERIFY` | `off`/`0`/`false`/`no` · `typecheck` · `lint` · `typecheck,lint` | 전부 켬 | `stop-verify` 범위. `off`면 `tsc-on-edit`도 끈다. 모르는 값은 켠 채로 stderr 경고 |
| `DEVKIT_TSC_ON_EDIT` | `1` | 꺼짐 | 편집 직후 타입체크 (25초 고정) |
| `DEVKIT_VERIFY_MODE` | `script` | — | `--incremental` 직접 실행을 끄고 프로젝트 스크립트만 쓴다 |
| `DEVKIT_TIMEOUT_TYPECHECK` | 초 5~600 | `30` | `stop-verify` typecheck 상한. 큰 레포는 늘릴 것 |
| `DEVKIT_TIMEOUT_LINT` | 초 5~600 | `15` | `stop-verify` lint 상한 |
| `DEVKIT_RECEIPTS` | `0`/`false`/`off`/`no` | 켬 | receipt 기록 끄기. 모르는 값이면 끄고 경고 |

</details>

<details>
<summary><b>템플릿 · 스크립트 · 기록 파일</b></summary>

| 종류 | 이름 | 내용 |
|---|---|---|
| Template | `templates/eslint.config.mjs` | 빈 catch만 error. `any`·`console`·200줄·네이밍·`.tsx` 로직은 **warn** |
| Template | `templates/ci.yml` | pnpm·Node 20, typecheck/lint/test(`--if-present`)·시크릿 grep. `pnpm audit`은 실패해도 통과. 머지를 막으려면 브랜치 보호 설정 필요 |
| Template | `templates/pre-commit` | staged 파일 시크릿 검사 + lint 스크립트 실행. `--no-verify`로 우회된다 |
| Script | `scripts/verify-integrity.mjs` / `gen-integrity.mjs` | 훅 파일 해시 검사 / 매니페스트 재생성 |
| Script | `scripts/verify-evidence.mjs` | evidence 적합성(ref 실존·인용 대조·커버리지). `/gap`이 부른다 |
| Script | `scripts/bench-delta.mjs` · `bench-verify.mjs` | 보고 주입량 · `--incremental` 속도 실측 (`--project <path>`) |
| 기록 | `.devkit/audit.jsonl` | 거부·확인·경고·검증 결과. 시크릿 마스킹 |
| 기록 | `.devkit/receipts.jsonl` | Bash 명령·출력. **알려진 키 형식 11종만 마스킹** — 그 외(`export K=V`·Bearer 토큰 등)는 평문. 8MB 넘으면 1세대 로테이트 |
| 기록 | `.devkit/verify-baseline.json` | 직전 검증 진단 목록(새 진단만 보고하는 근거). 브랜치·설정·lockfile이 바뀌면 버려진다 |
| 기록 | `.devkit/pdca-state.json` | 진행 중 사이클 `{version, cycleId, stage, status}` |
| Eval | `test/*.test.mjs` · `evals/` | 훅 회귀 테스트(`node --test test/*.test.mjs`) · 행동 시나리오(`evals/run.mjs`, `claude -p` 사용) |

`.devkit/`은 쓰는 프로젝트의 `.gitignore`에 넣을 것(`/kit init`이 제안한다).

</details>

## 레포에 심기 (`/kit init`)

- `CLAUDE.md` · `AGENTS.md` 생성 — 기존 `CLAUDE.md`가 `@AGENTS.md`를 import하지 않으면 옮기기 안을 제안하고, 거절하면 `AGENTS.md`를 만들지 않는다
- `eslint.config.mjs` 복사 — 기존 설정이 있으면 병합안 제안. devDependency는 설치하지 않고 안내만
- `.github/workflows/ci.yml` 복사
- `.githooks/pre-commit` 설치 + `git config core.hooksPath .githooks`
- `.claude/settings.json`에 플러그인 활성화 · `pdca-state.json` 쓰기 허용
- `.gitignore`에 `.devkit/` 추가 제안

## 설계 원칙

- **강제는 되돌릴 수 없는 것만.** 나머지는 확인 창이나 알림으로 두고 사용자가 정한다.
- **판정은 열거가 아니라 불변식으로.** 허용목록은 넓으면 새고 좁으면 정직한 작업을 막는다.
- **검증은 형태가 아니라 동작으로.** 소스 문자열 검색으로 쓴 단언은 대상을 지워도 초록인 채로 죽는다.
- **규칙이 없어서가 아니라 멀어서 어긴다.** 규칙을 더 쓰기보다 필요한 순간에 가까이 둔다(매 프롬프트 언어 지시, 편집 직후 위반 알림).
- **규칙을 바꾸면 그 규칙이 소비되는 모든 자리를 고친다.** 아래 "수정하는 법".
- **못 한 것은 못 했다고 적는다.** `REPORT.md`와 `CHANGELOG.md`에 "안 닫힌 것" 절이 있는 이유다.

## 수정하는 법

- **규칙 바꾸기 → 다섯 자리를 함께 본다.** `RULES.md` 본문 → `SUMMARY:START~END`(Claude 주입) → `CODEX:START~END`(Codex 사본 정본) → `agents/*.md` → `skills/*/SKILL.md`·`commands/*.md`.
  - `hooks/session-start.js`는 고치지 않는다 — 두 블록을 읽어갈 뿐이다.
  - Claude 세션에 들어가는 건 SUMMARY뿐이고, Codex가 읽는 건 사본뿐이다. 본문만 고치면 규칙이 아무 데도 닿지 않는다.
  - CODEX 블록을 고쳤으면 `/kit sync`로 `~/.codex/AGENTS.md`도 맞춘다.
  - 바꾼 뒤 `grep -rn "<옛 표현>" RULES.md agents/ commands/ skills/`로 잔존 확인.
- 에이전트·커맨드·스킬 추가 → `agents/<이름>.md` · `commands/<이름>.md` · `skills/<이름>/SKILL.md`. 디렉토리 컨벤션으로 자동 인식되어 `plugin.json` 등록이 필요 없다.
- 훅 수정 후 → `node scripts/gen-integrity.mjs` + `node --test test/*.test.mjs`

## 요구사항

**Node 20+** (CI 템플릿·개발 기준. 더 낮은 버전은 확인하지 않았다). 훅과 검증 스크립트가 node로 돌기 때문에 **프로젝트 언어와 무관하게 필요하다** — Python·Go 레포에서도 테스트는 pytest·go test 같은 자기 러너로 돌리되, 검증 층은 node가 돌린다.
