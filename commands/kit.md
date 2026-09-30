---
name: kit
description: devkit 도움말·초기화·설정·규칙 동기화. 인자 없으면 도움말, `setup`이면 전역 설정 마법사, `init`이면 AGENTS.md + settings.json 생성, `sync`면 AGENTS.md의 공통 규칙 사본을 정본으로 갱신, `audit`이면 차단 이벤트 집계.
argument-hint: "[setup|init|sync|audit]"
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - AskUserQuestion
---

# /kit

인자에 따라 분기한다.

## `setup` — 전역 설정 마법사

`$ARGUMENTS`가 `setup`으로 시작하면 `~/.devkit/config.json`을 만들거나 고친다. **전역 하나뿐이고 프로젝트별 설정은 없다.**

> **왜 있나**: devkit의 기본값은 만든 사람의 취향(한국어·PDCA·`features/` 구조·스쿼시 머지 등)이다. 설치한 사람이 자기 취향으로 맞출 수 있어야 한다. **설정 파일이 없으면 규칙 주입·판정이 지금까지와 100% 동일하다**(유일한 차이는 첫 실행 안내 한 블록) — 스키마·기본값의 정본은 `hooks/lib/config-schema.js`의 `DEFAULTS`이고, 이 문서에 값을 다시 적지 않는다(적으면 그 사본이 낡는다).

### 하위 명령

| 인자 | 하는 일 |
|---|---|
| `setup` | 마법사 실행 |
| `setup show` | 현재 값 · 기본값과 다른 항목 · frontmatter 일치 여부 · 카탈로그 대조 |
| `setup reset` | 설정 삭제 + `agents/*.md`를 기본값으로 복구 |
| `setup --reapply` | 업데이트로 풀린 모델 설정을 다시 적용(12단계만) |

### 마법사 절차

1. **현재 상태 먼저 보여준다.** `~/.devkit/config.json`을 Read — 있으면 기본값과 다른 항목만, 없으면 `설정 없음 — 기본값으로 동작 중`. 기본값은 `hooks/lib/config-schema.js`를 Read해서 가져온다.
2. **프리셋 4지선다**(AskUserQuestion). 프리셋을 고르면 3~9를 건너뛴다.
   - `기본값 그대로` · `최소 간섭`(가드 minimal · PDCA 끔 · 코드 규칙 전부 끔) · `엄격`(가드 strict · 편집마다 타입체크) · `직접 고르기`
   - ⚠ `기본값 그대로`는 **`{"version":1}` 한 줄만** 쓴다. 동작은 완전 기본값이면서 "설정을 물어봤다"는 사실이 남아 첫 실행 안내가 다시 뜨지 않는다. 기본값 전체를 적어 넣지 마라 — 나중에 devkit의 기본값이 바뀌어도 그 사람만 옛 값에 묶인다.
3. 언어·톤·서식 (`language`·`tone`·`format`)
4. PDCA (`pdca.enabled` → 켜면 `sensitivity`·`defaultTrack`·`docs`)
   - ⚠ `docs: "lite"`는 **GAP·REVIEW를 REPORT의 선행조건에서 뺀다.** 고르기 전에 그 뜻을 한 줄로 말하고 확인받는다 — "리뷰 없이 완료 보고"가 가능해지는 것이 이 값의 의미다. `behaviors.json`은 어느 값에서도 필수다.
5. 폴더 구조·테스트 정책 (`structure`·`testing`)
6. 코드 규칙 6토글 + `rules.maxLines`
7. 커밋·머지 (`commit.*`·`merge.strategy`)
8. 가드 (`guards.level`·`newDependency`·`protectedFiles` 4종)
9. 검증 (`verify.*`·`receipts`·`formatOnEdit`)
10. **모델 배분** — Claude Code 서브에이전트 8종의 `model`·`effort`. **이 단계는 Claude Code 서브에이전트 전용이다 — Codex에는 적용되지 않는다**(Codex 서브에이전트의 역할별 모델 지정 경로를 아직 찾지 못했고, `~/.codex/config.toml`의 `model`은 사용자 전역 기본값이라 devkit이 건드리지 않는다).
    1. **목록은 스크립트로 얻는다.** 먼저 CC 버전을 구한다 — `claude --version`을 Bash로 돌려 `x.y.z`를 뽑는다. `CLAUDE_CODE_EXECPATH`의 마지막 경로 조각도 버전처럼 생겼지만 **그건 런처 경로라 실행 중 버전보다 낡는다**(2026-09-30 실측: env는 `2.1.278`, 실제는 `2.1.285`). 둘 다 얻었으면 **큰 값**을 쓴다. ⚠ 낡은 버전을 넘기면 `minVersion`이 높은 최신 모델이 `belowVersion`으로 빠져 **가족 alias가 선택지에서 통째로 사라진다**(그때 `opus`가 없어졌다) — 버전을 모르는 것보다 잘못 아는 것이 나쁘므로, 확신이 없으면 **인자를 넘기지 마라**. 그 값을 붙여 호출한다:
       `node "${CLAUDE_PLUGIN_ROOT}/scripts/list-models.mjs" --cc-version <x.y.z>` (버전을 못 얻으면 인자 없이 — 그러면 버전 필터 없이 전부 보인다). stdout의 JSON 한 줄을 읽는다.
       ⚠ `~/.claude/cache/model-catalog/`의 파일을 **직접 Read하지 마라** — 홈 밖 파일이라 권한 프롬프트가 뜨고, 파싱은 스크립트가 결정적으로 한다. 이 스크립트는 파일을 쓰지 않고 항상 exit 0이다.
    2. `claude.status`가 `ok`면 **`claude.choices`를 그대로 제시한다**: `primary`는 가족 alias로(예: `opus` — Opus 5), `pinned`는 "이전 버전(id로 고정)" 묶음으로 뒤에. ⚠ **이름만 보여주지 마라** — 각 선택지의 `description`(무엇에 쓰는 모델인지)과 `notice`(있으면 비용 경고, 예: "Fable은 Opus보다 사용량을 훨씬 빨리 쓴다")를 **함께** 적는다. 이름만 나열하면 사용자는 무엇을 고르는지 알 수 없다(2026-09-30 실사용에서 드러난 결함이다). 목록 위에 `fetchedAt`(카탈로그 갱신 시각)을 적고, `stale`이 true면 "낡았을 수 있다 — Claude Code가 다음 실행에서 갱신한다"를 붙인다(정보일 뿐 목록을 무효화하지 않는다). `belowVersion`에 든 모델은 선택지에 넣지 말고 "요구 버전 x.y.z(현재 y.y.y)"만 표기한다. `source`는 파일이 여럿일 때만 보여 준다.
    3. `claude.status`가 `ok`가 아니면 **`fallback.models`·`fallback.efforts`로 제시한다**(현행과 같은 가족 3종·effort 5종) — 그리고 `reason`을 한 줄 덧붙인다. `missing`은 정상 상태다(로그인 전·다른 OS) — "카탈로그가 없어 기본 목록으로 보여 준다"처럼 사실만 적고 경고 톤을 쓰지 마라.
    4. 프리셋 3종(`기본` / `절약`: 전부 sonnet 이하 / `최대`: 계획·설계·리뷰를 최고 모델)을 먼저 고르게 하고, 원하면 개별 조정. 8종을 하나씩 묻지 않는다. 카탈로그에는 등급 필드가 없으므로 프리셋의 "최고/절약"은 가족 이름 기준 그대로다.
       ⚠ **프리셋은 이름만으로 뜻이 전달되지 않는다**("절약"·"최대"가 무엇을 바꾸는지 알 수 없다 — 2026-09-30 실사용). 세 선택지 각각에 **에이전트 8종의 실제 배분(모델·effort)을 표로** 보여주고, `notice`가 있는 모델이 섞여 있으면 그 비용 경고를 한 줄 덧붙인다. 포커스한 항목만 보이는 preview에 의존하지 말고 **세 프리셋의 차이를 한눈에** 두어라.
    5. **effort는 고른 모델의 `efforts`만 제시한다.** `effortOptions`의 `label`(표시명)과 `recommended`(카탈로그가 권장으로 표시한 값)를 함께 보여주고 **권장값을 기본 선택으로** 둔다 — 권장 effort는 모델마다 다르다(Opus 5.5는 `medium`, Fable 5.1은 `high`). `efforts`가 빈 배열이면(예: Haiku) "이 모델은 effort를 쓰지 않는다(카탈로그 기준)"를 알리고 **기존 effort 값을 그대로 둔다** — 줄을 지우지 않는다(Claude Code가 그 줄을 거부하지 않는 것을 실측했다, 2026-09-22). 폴백이면 `fallback.efforts` 다섯뿐. 정수도 유효하지만 고르게 하지 않는다.
    6. 카탈로그는 **선택지와 경고만** 만든다. 사용자가 목록 밖의 값을 직접 적겠다고 하면 막지 말고 그대로 저장한다 — 허용 판정은 `validateModel`이 형태만 본다. 단 `claude-`로 시작하는 id가 카탈로그에 없으면 "이 머신의 카탈로그에는 없다 — 호출 시 404로 종료될 수 있다"를 한 번 말한다.
11. **diff를 보여주고 승인받는다.** 기존 파일이 있으면 같은 폴더에 `config.backup-{ISO}.json`을 **먼저** 남기고 그 경로를 보고한다. 승인 후 `~/.devkit/config.json`을 Write.
    - ⚠ 이 파일은 **보호 파일**이라 Write 시 확인 창이 뜬다. 정상이다 — 거절되면 우회하지 말고 사용자가 직접 고치도록 경로와 내용을 보여준다.
12. **모델 설정을 `agents/*.md`에 적용한다** — `cfg.models`가 기본값과 **다른 에이전트만** 연다. 기본값과 같으면 파일을 **열지 않는다**(무변경이 곧 기본값 보장).
    - 적용은 `hooks/lib/agent-frontmatter.js`의 `applyModel`로 한다. 직접 정규식을 짜지 말 것 — 그 모듈이 "두 줄만 바꾼다·없는 줄은 만들지 않는다"를 보장하고 테스트가 고정한다.
    - `{ok:false}`가 오면 그 에이전트는 **건너뛰고** 사유를 보고한다. 값을 고쳐 넣지 않는다.
    - 성공하면 설정의 `_appliedAt`을 ISO 시각으로 기록한다.
    - **`gen-integrity.mjs`를 돌리지 않는다.** `INTEGRITY.sha256`은 `hooks/`·`scripts/`만 덮고 `agents/`는 애초에 대상이 아니다(재생성하면 agents에는 무의미하고, 그 시점 `hooks/`의 상태를 무조건 정당화해 변조 탐지의 기준선을 말없이 다시 긋는다). 보고에 한 줄로 그 사실을 적는다.
    - ⚠ **대상 디렉터리에 `.git`이 있으면 멈추고 확인받는다.** devkit 소스 레포일 수 있고, 그 경우 `test/agent-contract.test.mjs`의 모델 계약 테스트가 RED가 된다. 거절하면 설정만 저장하고 `_appliedAt`은 `null`로 둔다.
13. **마무리 보고 3줄**: ① 바뀐 항목 수 + 백업 경로 ② 규칙 주입이 바뀌었으면 **"새 세션부터 적용된다"**(`session-start`는 세션 시작에만 돈다) ③ `/kit init`을 돌린 프로젝트가 있으면 **`/kit sync` 안내** — 사본이 설정 이전 텍스트라 낡음으로 뜬다.

### `setup show`

현재 값 · 기본값과 다른 항목 · `agents/*.md`가 설정과 맞는지(`readModel`로 대조) · **카탈로그 대조**: `node "${CLAUDE_PLUGIN_ROOT}/scripts/list-models.mjs" --check`를 돌려 `agents[]`를 표로 보인다 — `modelStatus`가 `absent`면 "이 머신의 Claude Code 카탈로그에 없다 — 호출 즉시 404로 종료된다", `effortStatus`가 `unsupported`면 "모델 X는 effort Y를 제공하지 않는다(카탈로그 기준)", `none`이면 "effort를 쓰지 않는 모델(값은 무시된다)", `unjudged`는 "판정하지 않음(정수 effort·alias·카탈로그 없음)"으로 표기만 한다. `claude.status`가 `ok`가 아니면 대조를 건너뛰고 `reason` 한 줄. 이 대조는 **Claude Code 서브에이전트 기준**이다(Codex 미적용) · 설정 파일 경로 · `DEVKIT_CONFIG`가 설정돼 있으면 그 사실.

### `setup reset`

① 백업을 남기고 설정 파일을 **`{"version":1}`로 교체**한다(삭제가 아니다 — 지우면 다음 세션에 첫 실행 안내가 다시 떠서 "다시 묻지 않는다"를 스스로 깬다. 동작은 완전 기본값이므로 "완전 복구" 의미는 그대로다. 진짜 처음 상태를 원하면 사용자가 파일을 직접 지우면 되고, 그때 안내가 다시 뜨는 것은 의도된 동작이다) ② `_appliedAt`이 있었으면 `agents/*.md`를 `DEFAULTS.models`로 되돌림 ③ `node "${CLAUDE_PLUGIN_ROOT}/scripts/verify-integrity.mjs"` 실행 결과 보고 ④ "새 세션부터 완전 기본값" 안내.

## `init` — 현재 프로젝트 초기화

`$ARGUMENTS`가 `init`이면 아래를 수행한다:

1. **프로젝트 감지**: `package.json`을 Read. `scripts`(dev/build/test/lint/typecheck)와 `packageManager`, 주요 의존성(next/react/vite 등)을 파악. 없으면 사용자에게 스택을 한 번 물어본다.
2. **`AGENTS.md` 생성** (이미 있으면 덮어쓰지 말고 diff만 제안). 명령어는 실제 `scripts`에서 가져온 것만, 추측 금지. 비어있으면 그 줄 생략. **팀 공통 규칙은 링크가 아니라 `AGENTS.md`에 인라인**한다 — 그래야 Claude Code뿐 아니라 Cursor·Codex·Copilot도 읽는다. 플러그인 `RULES.md`의 `SUMMARY:START~END` 블록을 Read해서 "## 공통 규칙"으로 그대로 붙여넣는다.
   ⚠ **이미 `CLAUDE.md`가 있고 `@AGENTS.md` import가 없는 레포에서는 AGENTS.md를 바로 만들지 않는다.** Codex는 폴더당 규칙 파일 하나만 읽고, `AGENTS.md`가 없을 때만 `CLAUDE.md`를 대신 읽는다(`project_doc_fallback_filenames`). AGENTS.md가 생기는 순간 **CLAUDE.md의 프로젝트 규칙(운영 DB 경고 같은 것)이 Codex에서 조용히 빠진다.** 대신 **이전안을 diff로 제안**한다 — CLAUDE.md 본문을 분류하지 않고 통째로 AGENTS.md의 `## This repo only` 자리로 옮기고, CLAUDE.md는 `이 레포 지침은 @AGENTS.md 를 따른다.` 한 줄로 바꾼다. 합친 크기가 32KiB(Codex 기본 읽기 한도)를 넘으면 제안문에 적는다. **거절하면 AGENTS.md를 만들지 않고** 나머지 단계만 진행한다.
   ⚠ **인라인 구간을 `devkit:rules` 마커로 감싼다 (필수).** 이 사본은 devkit이 규칙을 바꿔도 자동으로 갱신되지 않는다 — 마커가 있어야 `session-start` 훅이 낡음을 탐지하고 `/kit sync`가 그 구간만 안전하게 교체할 수 있다. 마커가 없으면 사본은 조용히 낡고, 에이전트는 낡은 사본을 정본보다 **우선** 읽는다(결함로그 D26).
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

   <!-- devkit:rules:start mode=managed -->
   <devkit RULES.md의 SUMMARY 블록 내용을 그대로 인라인>
   <!-- devkit:rules:end -->

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

## `sync` — 공통 규칙 사본을 정본에 맞춘다

`$ARGUMENTS`가 `sync`면 규칙 사본을 플러그인 정본으로 갱신한다. 대상이 **둘**이다.

- **프로젝트** `AGENTS.md` (아래 "프로젝트 규칙")
- **전역** `~/.codex/AGENTS.md` (아래 "전역 Codex 규칙")

⚠ **두 대상은 서로 독립이다.** 먼저 어느 쪽이 낡았는지 보고 **해당하는 절만** 수행한다. 프로젝트 `AGENTS.md`가 없다고 해서 전역 단계를 건너뛰면, 전역 경고는 매 세션 뜨는데 고칠 길이 없어진다(경고는 프로젝트와 무관하게 전역 파일을 보고 뜬다).

**왜 필요한가**: `init`이 심은 사본은 devkit이 규칙을 바꿔도 자동 갱신되지 않는데, 에이전트는 그 사본을 정본보다 **우선** 읽는다. `session-start` 훅이 낡음을 탐지하면 이 명령을 안내한다.

⚠ **정본은 "설정을 반영한 블록"이다.** `~/.devkit/config.json`이 있으면 그 설정대로 줄이 빠진 블록이 정본이고, `session-start`도 같은 기준으로 낡음을 판정한다. 그래서 아래 절차는 **설정을 먼저 읽는다**:

- 설정이 없거나 **전부 기본값이면** `RULES.md`의 블록 원문을 그대로 쓴다 → 설정 안 한 사람에게 이 명령은 한 글자도 달라지지 않는다.
- 기본값이 아니면 `hooks/lib/rules-render.js`의 `SUMMARY_MAP`·`CODEX_MAP`을 Read해서 **해당 줄을 뺀 채로** 붙여넣는다. **문장을 새로 쓰지 않는다** — 지우기만 한다(쓰기 시작하면 정본이 둘이 된다).
- ⚠ 설정 노트(`- [devkit 설정] …`)와 **첫 실행 안내(`[devkit 첫 실행] …`)는 사본에 넣지 않는다.** 둘 다 매 세션 주입되는 것이고 사본에 들어가면 영구 낡음으로 뜬다.

### 프로젝트 규칙 (`AGENTS.md`)

1. `AGENTS.md`를 Read. **없으면** `/kit init`을 안내하고 **이 절만** 끝낸다(전역 절은 계속 진행한다).
2. `<!-- devkit:rules:start ... -->` / `<!-- devkit:rules:end -->` 마커를 찾는다.
   - **마커 없음** = `init` 이전 버전으로 만든 파일이다. 공통 규칙 절을 **자동으로 찾아 감싸지 마라** — 어디까지가 devkit 사본인지 추측하는 순간 사용자가 쓴 줄을 삼킨다. 대신 마커를 넣을 위치를 **제안**하고 승인을 받는다.
   - **`mode=custom`** = 사용자 소유다. **아무것도 하지 않고** 그대로 보고한다.
3. 플러그인 `RULES.md`의 `SUMMARY:START~END` 블록을 Read.
4. **마커 사이만** 교체한다. 마커 밖은 한 글자도 건드리지 않는다 — `## This repo only`·`## Do NOT`은 사용자가 쓴 것이다.
5. 교체 전 **diff를 보여주고 승인**을 받는다. `AGENTS.md`는 사용자 소유 파일이라 무단 덮어쓰기 금지.

> 규칙을 devkit과 다르게 유지하고 싶으면 마커를 `mode=custom`으로 바꾼다 → 이후 탐지·동기화 대상에서 완전히 빠진다.

### 전역 Codex 규칙 (`~/.codex/AGENTS.md`)

Codex가 받는 devkit 규칙은 이 파일의 `devkit:rules` 구간이고, 정본은 플러그인 `RULES.md`의 `CODEX:START~END` 블록이다. `session-start`가 "`~/.codex/AGENTS.md`의 devkit 규칙이 … 다르다"를 알렸거나 사용자가 요청하면, 위 프로젝트 단계와 **따로** 한다(프로젝트 `AGENTS.md`가 없어도 이 단계는 할 수 있다).

1. `~/.codex/AGENTS.md`를 Read. **없으면 만들지 않는다** — 사용자 전역 파일이라 생성은 사용자가 요청할 때만.
2. `devkit:rules` 마커를 찾는다. **마커가 없으면 교체하지 않고** 마커를 넣을 위치만 제안한다. `mode=custom`이면 아무것도 하지 않고 보고만.
3. 플러그인 `RULES.md`의 `CODEX:START~END` 블록을 Read.
4. **마커 사이만** 교체한다. 마커 밖(머리말 — 응답 언어 1줄 등)은 한 글자도 건드리지 않는다. Codex에는 응답 언어 설정이 없어서 언어는 사용자가 머리말에 둔다 — devkit은 공개 플러그인이라 특정 언어를 정본에 넣지 않는다.
5. 교체 전 **diff를 보여주고 승인**을 받는다.

## `audit` — 관측성 조회

`$ARGUMENTS`가 `audit`이면 `.devkit/audit.jsonl`을 Read해서 `action`별로 집계한다. 파일 없으면 "이벤트 없음". 세 종류:
- `blocked` — 가드 훅이 **차단**한 위험 명령/의존성/보호파일.
- `asked` — 확인 창을 띄운 것(새 의존성·lockfile·`node_modules`·`chmod -R 777`). 사용자가 승인했는지는 로그에 없다.
- `warn`·`warned` — 통과한 규칙 위반(`no-any`·`console.log`·빈 catch·`.tsx` 로직·200줄)과 절차 경고. 차단은 안 됐지만 남은 것.
- `verify-ok`·`verify-failed`·`verify-*` — 종료 시 검증 결과. 실패만 보려면 `verify-failed`를 센다(`verify-fail`이라는 값은 없다).

예:
```
관측 요약 (총 24건)
  차단(blocked) 12 · 확인창(asked) 4 · 통과위반(warn) 9 · 검증실패(verify-failed) 3
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
  /gap      PLAN/DESIGN 대비 구현 일치도 — 통과 기준은 unproven==0. 사이클 필수 단계
  /iterate  unproven==0까지 자동 보완-재분석 루프 (최대 5회)
  /review   현재 diff 리뷰 (버그·보안·컨벤션) → REVIEW.md — 사이클 필수 단계
  /report   완료 리포트 REPORT.md → 사이클 아카이빙
  /cycles   PDCA 사이클 목록·열람 (진행 중 + 아카이브)
  /ship     리뷰 → 커밋 메시지 + PR 초안 (승인 후)
  /merge    PR 스쿼시 머지 → 원격 브랜치 삭제 → 로컬 main 동기화
  /improve  세션 교훈 추출 → 규칙/에이전트 개선 제안 (자기성장)
  /kit      이 도움말
  /kit setup 전역 설정 마법사 (~/.devkit/config.json) — 언어·가드 강도·PDCA·구조·
             코드 규칙·커밋/머지·검증·에이전트 모델. 설정 없으면 기본값으로 동작
             모델 목록은 Claude Code 로컬 카탈로그에서 읽는다 (없으면 고정 목록 · Codex 미적용)
  /kit init 현재 프로젝트에 AGENTS.md + eslint + CI + settings.json 생성
  /kit sync  프로젝트 AGENTS.md·전역 ~/.codex/AGENTS.md의 규칙 사본 갱신 (마커 구간만)
  /kit audit 차단 이벤트(.devkit/audit.jsonl) 집계 조회

에이전트 (자동 위임 또는 요청 시)
  planner           Plan 단계 — 탐색 → PLAN.md 본문
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
  web-interface-audit  UI 코드를 Web Interface Guidelines로 감사
  design-md         디자인 언어를 DESIGN.md로 고정 (관측한 것만)

훅 (자동)
  SessionStart      팀 규칙 리마인드 + 진행 중 PDCA 사이클 재개 안내
  UserPromptSubmit  기능 요청 감지 → PDCA 사이클 규약 안내 (차단 없음)
  PreToolUse    위험 bash 거부 · 새 의존성·lockfile은 확인 창 · .env 덮어쓰기·.git 거부
                PDCA 게이트 — GAP/REPORT 선행 산출물 없으면 거부 · 상태 스키마는 경고
  PostToolUse   prettier 포맷(있을 때) · 규칙 위반을 그 자리에서 알림(convention-observe) (+ opt-in tsc)
  Stop          종료 시 typecheck/lint 실행·보고
  관측성        차단·통과위반·검증실패를 .devkit/audit.jsonl 기록 (/kit audit)
  품질(eval)    node --test (정적) · evals/README.md (행동 시나리오)

템플릿 (/kit init 시 레포에 설치)
  eslint.config.mjs   네이밍·no-any·.tsx로직 lint 강제
  ci.yml              PR typecheck/lint/test 머지 게이트
  AGENTS.md           공통규칙 인라인 (Cursor/Codex 호환)

요구: Node 20+ (훅·검증 스크립트가 전부 node — 프로젝트 러너와 무관하게 필요)
규칙: RULES.md (규칙 단일 소스, 세션 시작 시 요약 리마인드)
설정: ~/.devkit/config.json (없으면 전부 기본값) — 만들려면 /kit setup
      파일이 없으면 세션 시작 때 한 번 물어본다 (거절하면 다시 안 묻는다)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
