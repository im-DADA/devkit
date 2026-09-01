# Changelog

[Keep a Changelog](https://keepachangelog.com/) 형식. 버전은 [SemVer](https://semver.org/).

## [0.20.0] - 2026-08-12

### 검증 보고를 "내가 만든 것"으로 좁힌다

0.19.0이 남긴 미결을 닫는다: `found` 상한이 kind당 40줄/8KB라 WIP 중 에러가 남아 있으면
**매 턴 반복 주입**됐다(실측 16,353바이트). 고칠 수도 없는 남의 에러가 매 턴 같은 자리에 오면
경고 전체를 무시하게 된다.

이제 보고는 **직전 실행 대비 차분**이다.

| | 보고 |
|---|---|
| 새로 생긴 진단 | 전문 |
| 해결된 진단 | 건수 1줄 |
| 그대로인 진단 | `그 외 기존 진단 N건 (변경 없음)` 1줄 |
| 아무 변화 없음 | **완전 침묵** (세션 첫 턴만 1줄로 존재를 알린다) |

실측: 턴1 226바이트 → 턴2 **0바이트** → 에러 1건 주입 시 292바이트(**새 것만**).
`node scripts/bench-delta.mjs --project <path> --inject`로 재현한다.

**`new`는 위치를 가리지 않는다** — `a.ts`를 고쳐 `z.ts`가 깨져도 잡힌다. import 그래프로
표현되지 않는 결합(`declare global`·ambient `.d.ts`·tsconfig 변경·생성된 타입)까지 포함이다.

### 동작 변경

1. **`.devkit/verify-baseline.json`이 생긴다**(gitignore 대상). 진단 원문이 평문으로 들어간다.
   브랜치·mode·스크립트·러너·tsconfig/lockfile이 바뀌면 자동으로 버려진다.
2. **무관 파일만 바뀐 턴에는 검증기를 아예 안 띄운다** — `.md` 한 줄에 타입체크가 돌지 않는다.
   (반대로 워킹트리가 깨끗하면 **전체 실행한다** — "안 했다"가 아니라 "볼 수 없다"이고,
   그 턴에 편집→커밋했다면 깨진 커밋이 무검증으로 통과하기 때문이다.)
3. **`ok`가 더 이상 완전 침묵이 아니다** — 기존 진단이 전부 해결되면 1줄로 알린다(1회성).

### 고침

- **lint 요약 줄(`✖ N problems`)이 진단으로 세어지던 것** — 에러를 고칠 때마다 거짓
  "새 진단 1건"이 떴다. 대표 신호를 상시 오염시켜 정확히 무시 학습을 만들었다.
- **`.devkit/`가 스코프를 트리거하던 것** — 우리 산출물이 git status에 잡혀 우리를 깨웠다.
- **import 정규식 백트래킹** — 세미콜론 없는 스타일에서 512KB 파일 하나에 3.3초가 붙었다.
- **기준선이 있는 정상 턴에도 전체 소스 스캔이 돌던 것** — 결과를 아무도 안 쓰는데 매 턴 돌았다.

### 고침 (0.20.1)

- **두 세션 핑퐁** — 알림 슬롯이 하나뿐이라 같은 레포에 두 세션이 붙으면 서로의 이력을
  지워 "기존 진단 N건 남아 있다"가 매 턴 반복됐다(실측 A3·B2·A4 전부 177바이트).
  최근 8개 세션을 기억한다. 옛 형식 상태도 읽으므로 기존 사용자 이력은 안 잃는다.
- **스캔 예산이 디렉터리 사이에서만 체크되던 것** — 한 디렉터리에 3만 파일이면 상한의
  7.5배(11.2초)·15배(RSS 1.28GB)를 쓰고 나서야 포기했다. 초과 시 `scanned`를 함께 돌려
  "언제 멈췄는가"를 테스트가 볼 수 있게 했다 — 결과만 보면 뮤테이션이 살아남는다.
- **기준선 쓰기가 보고보다 앞에 오는 것을 구조로 막았다** — 순서가 뒤집히면 훅이 죽었을 때
  그 진단이 영원히 침묵한다. 실행으로 재현 불가한 종류라 위치를 단언한다.
- **순수성 검사가 위조되던 것** — 소스 grep이라 `require('fs')`를 못 잡았다. 로드된 모듈
  그래프를 본다.

### 바뀐 동작 (0.20.1)

- **`.env` 가드를 "소실 방지"로 좁혔다.** Read는 애초에 훅이 안 본다(matcher가 `Write|Edit`) —
  이 규칙이 지키던 건 유출이 아니라 소실이었다. `.env`는 gitignore라 통째로 날리면 복구가 안 되니
  그 경로만 남긴다. **Edit(부분 수정)·없는 파일 새로 만들기·`>>` 추가는 통과**하고, 기존 파일의
  **Write 통째 대체와 `> .env` 자르기는 계속 차단**한다. 값 하나 고치는 실사용까지 전부 막혀
  사용자가 직접 하게 되던 것을 없앤다. lockfile·`.git`·`node_modules`는 그대로 전부 차단이다.
- **출력 서식 지시를 매 턴 주입한다**(`pdca-detect`). 출력 언어 고정과 같은 메커니즘·같은 자리다.
  ⚠ 조건이 핵심이다 — **답이 3문단을 넘거나 항목이 여럿일 때만** 구조(`###`·빈 줄·**굵게**·`---`)를
  주고, 한두 문장으로 끝날 답은 명시적으로 면제한다. 무조건 걸면 "간결하게, 1줄이면 1줄"과
  충돌해 한 줄짜리 답에 헤더가 붙는다 — 읽기 어려운 걸 고치려다 키우는 셈이다.
  주입 순서는 서식 → 언어로, **가장 가까운 자리는 언어가 갖는다**(드리프트가 더 심하다).

### 안 닫힌 것

- **키가 같고 위치만 바뀐 진단**은 전문 대신 `위치가 바뀐 N건` 1줄로만 알린다.
  `TS2532`처럼 식별자를 안 담는 메시지는 같은 파일 두 줄이 바이트 단위로 동일해서,
  키에 줄번호를 넣으면 막히지만 **줄 하나만 밀려도 전부 새 진단**이 되는 더 큰 소음이 생긴다.
- **gitignore된 소스가 깨졌는데 같은 턴에 무관 파일이 끼면** 검증이 안 돈다.

## [0.19.0] - 2026-08-12

### 검증 실행 계약 (breaking-ish — 동작이 바뀐다)

`stop-verify`·`tsc-on-edit`의 실행·판정을 하나의 계약(`hooks/lib/verify-runner.js`)으로 합쳤다.
기존 코드는 전제가 전부 하드코딩이었다: `npm run` 고정, 스크립트명 `typecheck`/`lint` 고정,
0이 아닌 종료코드를 전부 "실패"로 뭉갬, 출력 뒤 20줄만 남김.

**기존 사용자 동작 변경 3가지:**

1. **처음으로 끌 수 있다** — `DEVKIT_VERIFY=off`. 지금까지 `stop-verify`는 끄는 방법이 없었다.
2. **다른 스크립트명도 잡는다** — `type-check`·`check-types`·`ts:check`·`tsc`·`lint:check`·`eslint`·`biome`.
   그동안 이 이름을 쓰던 프로젝트는 **아무것도 검증되지 않고 있었다**(조용히).
   (`types`·`check`는 일부러 뺐다 — emit 부작용/CI 전체 파이프라인인 경우가 흔하다.)
3. **스크립트가 없으면 처음으로 말한다** — 세션당 1회, 그리고 **Node 프로젝트에서만**.
   검증되는 줄 알았는데 아무것도 안 도는 상태가 제일 나쁘다는 판단이다. 시끄러우면 `DEVKIT_VERIFY=off`.
4. **`tsc-on-edit`이 스크립트를 요구한다** — 예전엔 `node_modules/.bin/tsc`를 무조건 직접 돌렸다.
   지금은 같은 계약을 쓰므로 typecheck 계열 스크립트가 필요하고, 없으면 stderr로 알린다.

### 고침

- **진단 파서가 pretty 출력을 못 읽던 것**(리뷰에서 발견) — `tsc`의 **기본** 출력 형식은
  `src/a.ts:1:7 - error TS2322`인데 괄호 형식만 알아서, script 모드에서 **진짜 타입 에러가
  "검증이 실행되지 못했다"로** 나갔다. 두 형식 모두 인식한다.
- **실행 실패를 타입 에러라고 보고하던 것** — tsconfig 오류·타임아웃·OOM이 "타입 에러"로 올라왔다.
  이제 `ok`/`found`/`unavailable`/`failed`/`skipped` 5-status로 나뉘고, `failed`는
  "검증이 실행되지 못했다"로 보고하며 에러 개수에 세지 않는다.
- **출력 절단이 뒤를 남기던 것** — tsc는 에러 뒤에 요약을 찍으므로 마지막 20줄이 요약만일 수 있었다.
  이제 앞(첫 진단)을 남기고 잘린 개수를 밝힌다.
- **패키지 매니저 하드코딩** — `packageManager` 필드 > lockfile 순으로 감지한다.
- **중복 실행** — 같은 패키지·같은 kind에 single-flight 락. 죽은 락은 PID 생존 OR mtime으로 만료.

### 빨라짐

단일 `tsc` 스크립트는 `--incremental`로 직접 돈다(안전 조건 5개를 전부 통과할 때만 —
`&&`·`tsc -b`·`next build`·`vue-tsc`·`references`·`composite`는 전부 거부). 실측:

| 프로젝트 | cold | warm(중앙값) | 비율 |
|---|---|---|---|
| adion | 7708ms | 1532ms | 0.199 |
| cogotool | 2081ms | 752ms | 0.361 |
| designer-hire-app | 1140ms | 734ms | 0.644 |

`node scripts/bench-verify.mjs --project <path>`로 재현. TypeScript 4.5.5·5.9.3에서 확인.
문제가 생기면 `DEVKIT_VERIFY_MODE=script`로 직접 실행을 끈다.

### 안 닫힌 것

- **Windows에서는 `--incremental` 직접 실행을 쓰지 않는다**(알려진 결함이라 껐다):
  `.bin/tsc`가 확장자 없는 sh 스크립트라 cmd.exe가 못 돌리고, `shell:true`가 인자를 인용 없이
  이어붙여 공백 있는 경로에서 argv가 쪼개진다. 스크립트 경로로만 동작하며 이쪽은 러너가 해결한다.
- `meta.fallback` 라벨이 캐시 손상일 때도 `incremental-unsupported`라고 말한다.
- lint 러너별 exit code 관례는 eslint 기준이다. biome 2.x·oxlint는 미검증(틀려도 `failed` 방향이라 안전).

## [0.18.0] - 2026-07-29

**낡은 규칙 사본을 탐지한다** — 0.17.0이 닫은 것의 마지막 갈래. `/kit init`이 `RULES.md`의 SUMMARY를 소비자 `AGENTS.md`에 인라인 복사하는데 재동기화 경로가 없었고, **에이전트는 그 사본을 정본보다 우선 읽는다.** 즉 0.17.0의 `views/` 폐지는 이미 `init`을 돌린 프로젝트에 영원히 도달하지 않는 상태였다(D26 세 번째 갈래). 새 의존성 0.

⚠ **새로 보이는 것**: 세션 시작 시 `AGENTS.md` 사본이 낡았거나 마커가 없으면 **2줄**이 뜬다. 최신이거나 devkit과 무관한 파일이면 완전히 침묵한다.

### Added
- `hooks/lib/rules-sync.js` — `compareRules(canonical, agentsMd)` 순수함수. 5상태: `current`·`stale`·`custom`·`unmarked`·`unknown`. **fs를 안 본다**(파일 읽기는 호출자 몫) — fs를 봉인한 프로세스에서 실행해 동작으로 단언한다.
- `/kit sync` — `AGENTS.md`의 마커 구간**만** 정본으로 교체. 마커 밖은 건드리지 않고, 교체 전 diff를 보이고 승인을 받는다. `mode=custom`이면 아무것도 하지 않는다.
- `<!-- devkit:rules:start mode=managed|custom -->` 마커 — `/kit init`이 삽입한다. **커스터마이즈 여부는 사용자가 선언한다**(devkit이 추론하지 않는다 — 자유 텍스트 분류는 허용목록이 되어 양방향으로 틀린다, D24·D25).
- `test/rules-sync.test.mjs` 23건 — 단위 + 훅 배선 + **소비자 대조군**(devkit 밖 임시 프로젝트). 이 축은 자기 레포에서 원리적으로 관측되지 않는다(devkit엔 `AGENTS.md`가 없다).

### Changed
- `hooks/session-start.js` — 드리프트 검사 배선. **정확히 2줄**, `stale`/`unmarked`가 아니면 완전 침묵, 억제 타이머 없음(타이머는 상태 파일이 필요하고 그게 또 낡는다). 경고는 **고치는 방법과 탈출구를 둘 다** 준다 — 대안 없는 경고는 교착이다.
- `RULES.md` D26 개정 2줄: **범위는 이 레포도 아니다**(소비자 사본은 사람이 훑을 수 없어 탐지를 기계에 맡긴다 — 규칙을 고친 걸로 끝이 아니라 소비자 쪽에 탐지가 뜨는지까지가 배포다) · **복사를 참조로 바꿔 해결하려 하지 마라**(D8·D10 때문에 에이전트엔 안 통한다. 드리프트를 없애려면 참조가 아니라 생성이다).
- 해시·버전 스탬프를 **의도적으로 두지 않았다.** 관통 원칙: *드리프트를 막으려고 드리프트할 수 있는 것을 새로 만들지 않는다.* 스탬프는 유지 대상이고, 사본을 고치고 스탬프를 안 고치면 낡은 게 "최신"으로 위장된다 — **탐지기가 거짓말하는** 최악의 실패다. 정본이 런타임에 옆에 있으므로 직접 비교한다.

### Fixed
- **초록인데 목표 미달이었다** — GAP이 잡았다. behavior 8/8 통과 · `unresolved==0` · 증거 게이트 통과 상태에서 PLAN의 성공 기준이 깨져 있었다. 목표 인구(이미 `init`을 돌린 프로젝트)는 마커가 없어 `unknown`→침묵이라 **정확히 그 인구에서 기능이 안 돌았다.** 게다가 순환이었다 — 마커를 넣으려면 `/kit sync`를 돌려야 하는데 돌릴 이유를 알려주는 게 그 경고다. 테스트 픽스처가 **항상 마커를 붙여** 마이그레이션 *이후*만 검증한 탓이다. `unmarked` 상태를 갈라 해소.
- **균일 들여쓰기가 모든 프로젝트를 stale로 만들 뻔했다** — 리뷰가 잡았다. `commands/kit.md`의 템플릿은 코드펜스 안에 들여쓰기로 보이므로 전사되면 사본 전 줄에 들여쓰기가 붙는다. dedent로 수정하되 **상대 들여쓰기는 보존**(중첩 목록은 규칙의 구조).
- `extractSummary()` 실패 시 `FALLBACK`으로 사본을 비교해 멀쩡한 `AGENTS.md`를 전부 `stale`로 보고할 뻔한 것 — 정본을 못 읽은 우리 잘못을 사용자 파일 탓으로 돌리지 않도록 가드.

### 안 닫힌 것
- 🟡 **`/kit sync`·`init`의 마커 처리에 테스트가 없다.** 커맨드 문서라 모델이 수행하고 **D8**(*"참조하라"는 지시는 실행되지 않는다*) 리스크를 그대로 받는다. 사용자 소유 파일을 편집하는 절차라 어긋나면 비싸다. 근본 해법은 마커 교체를 순수함수로 빼고 커맨드가 부르게 하는 것.
- 🟡 **`agents/*.md` 인라인 사본의 드리프트**(복사 사슬 #2)는 여전히 열려 있다. 폴백을 참조로 바꾸려다 `agent-contract.test.mjs` **Q3**에 걸려 전체 철회했다 — **D10**(프로젝트 밖 Read는 승인 프롬프트)과 **D8**. 그 사본은 사고가 아니라 하중을 받는 구조다. 해법이 **생성**임은 밝혀졌으나 빌드 타임 메커니즘이라 별도 사이클.
- 🟡 `unmarked` 판정이 `## 공통 규칙`(한국어)에만 반응한다. 실패 방향은 안전하나 다국어 템플릿이 생기면 새는 자리 — 열거로 늘리면 허용목록이 되어 D24와 충돌하므로 **의도적으로 안 고쳤다.**
- ✅ **소비자 경로는 전 생애주기까지 실측했다**(릴리스 후 추가 검증). `hooks.json`의 SessionStart 명령을 그대로 — `${CLAUDE_PLUGIN_ROOT}` 치환·환경변수·`cwd`=소비자 프로젝트 — 실행했고, `AGENTS.md`는 손으로 만들지 않고 `git show 1fe884a:RULES.md`로 **0.17.0 시점 SUMMARY를 뽑아** `/kit init`이 심었을 형태로 재현했다.
  - ① 마커 없는 0.17.0 사본 → 마이그레이션 안내(낡았다고 단정하지 않음) · ② 마커 + 낡은 내용 → `3줄 다르다` · ③ 마커 + 최신 → 침묵 · ④ `mode=custom` → 침묵 · 마커 밖 사용자 내용 보존 확인.
  - **②→③ 전이가 핵심**: `/kit sync` 후 경고가 사라진다 = 소음이 영구화되지 않고 수렴한다. 🔴 무시-학습 리스크에 대한 직접 반박이다.
  - 남은 미검증은 "Claude Code가 훅을 실행하고 stdout을 컨텍스트에 주입하는 것" 둘뿐인데, 그건 이 플러그인이 매 세션 하고 있는 일이다.
- ℹ `bash-guard`·`dep-guard`가 **인용된 문자열 안을 실제 명령으로 본다**(D27 후보). 이 사이클 작업 중 검증 명령이 두 번 차단당했다. `08c8450`이 스캐너에 적용한 인용 구간 불변식이 이 두 훅엔 안 들어갔다.
- 0.17.0에서 이월: `SCANNED` 확장자 열거 · 멀티라인 오탐 · untracked 미스캔 · `/flow` Full 전용.

## [0.17.0] - 2026-07-29

**닿지 않던 자리들** — 규칙·판정이 정직하게 적혀 있는데 필요한 순간에 작동하지 않던 결함 묶음. 네 건의 원인이 같다: **근사로 판정했거나, 강제되지 않는 층에 규칙을 뒀다.** 처방도 같다 — 판정은 열거·위치 근사 대신 **불변식**으로, 규칙은 안내 대신 **훅**으로. 결함로그 D26 신설. 새 의존성 0.

⚠ **컨벤션 반전 있음**: `views/` 층을 폐지했다(아래 Changed). devkit의 구조 가이드를 따르던 프로젝트는 영향을 받는다.

### Added
- `hooks/lib/pdca-state.js`의 `gateCycleFolderFile(filePath)` — 사이클 폴더(`docs/{날짜}-{slug}/`, `docs/archive/{날짜}/{slug}/`, 하위 폴더 포함) 아래 `.md`/`.json`이 아닌 파일 쓰기를 `pdca-gate`가 차단한다. **fs를 보지 않는 경로 전용 순수함수**라 폴더 존재 여부로 인한 오탐이 없다.
  - 차단 메시지에 **대안 위치**(`design/`·`public/`·`assets/`·코드 옆)와 "문서에서 경로로 참조하라"를 넣었다. 대안 없는 금지는 교착이라 같은 자리에 재시도만 반복된다.
- `test/pdca-gate.test.mjs` +7건. **절반이 과잉차단 감시다** — `docs/HANDOFF.md`·`docs/diagram.png`(최상위는 사이클 폴더가 아니다)·`public/logo.png`가 통과해야 초록이다. 하위 폴더 우회(`mockups/login.html`)와 Edit 도구 우회도 고정.

### Changed
- **`views/` 층 폐지 — 화면 조립은 `app/**/page.tsx`가 직접 한다.** App Router에서 화면 파일은 `page.tsx`가 이미 그 자리라 `views/`는 중복 층이고(Vite·CRA·RN에서 넘어온 것), 화면 전체를 `<XxxView />`로 위임하면 page가 `metadata`만 든 빈 파일이 된다. 더 큰 이유는 부수효과다 — `views/`를 두면 `"use client"`가 화면 꼭대기로 올라가 `metadata`(서버 전용 export)를 못 쓰고 서버 렌더를 통째로 잃는다. 경계는 폼·토글 조각에 긋는다.
  - `RULES.md` 본문·SUMMARY에 더해 **`agents/architect.md` · `agents/feature-builder.md` · `skills/convention-check/SKILL.md`까지** 정정(D26 ③).
- **"규칙을 추가·수정하면 충돌하는 자리를 함께 고친다"의 범위를 문서에서 걷어냈다.** 축이 둘에서 셋으로: 복사되는가 · 항상 주입되는가 · **실행되는가**(`agents/`·`skills/`·`commands/`는 모델에게 주입돼 코드가 된다). 여전히 열거가 아니라 축이다.
- `TRIVIAL_RE`에 `시안|목업|mockup|와이어프레임` 추가 — 산출물을 그리는 작업이지 시스템을 짓는 작업이 아니다.
- 트랙 강등 금지를 **"PLAN 승인 후"로 한정**. 트랙은 승인과 함께 확정되므로 승인 전 정정은 회피가 아니다 — Quick 첫 실사용에서 걸린 구멍.
- `RULES.md` §테스트에 **형태 관찰 단언 금지**. 문서 문자열 존재는 정당한 예외로 명시해 교착을 피했다.

### Fixed
- **안내를 두 곳에 넣었는데 둘 다 그 상황에 닿지 않았다**(D26 ①②). 시안·PNG가 사이클 폴더에 계속 들어가던 문제를 0.16.x에서 두 번 고쳤는데 실측하니 전부 무효였다 — `RULES.md` 본문은 세션에 주입되지 않고(SUMMARY 블록만 주입, D23 재발), KICKOFF는 **같은 커밋이 시안을 `TRIVIAL_RE`로 배제해서** 애초에 안 떴다(`"로그인 화면 시안 만들어줘"` → `too-short`). 경고를 넣은 자리와 필요한 상황이 배타적이라 훅으로 옮겼다.
- **PDCA 자동발동이 구두점을 셌다.** `countClauses`가 "요구 항목 수"를 잰다고 했지만 실제로는 쉼표·마침표로 쪼갰다 — `"README 만들어줘. 설치법이랑 사용법, 예제까지"`처럼 나열만 해도 파일 하나짜리 작업이 임계를 넘었다. 제거 후 실측: 기존 발동 4건 전부 3점 유지, 문서·엑셀·유틸 생성 4건 전부 2점으로 하락.
- **실행 지시 판정이 파일 위치로 근사해 양방향으로 틀렸다.** `INVOKE_RE`가 `SKIP_DIRS` 허용목록으로 "실행 지시"를 근사해서, 제외 밖 산문은 걸리고(CHANGELOG가 과거의 상대경로 형태를 인용하는 순간 오진) 제외 안의 진짜 지시는 원리적으로 안 잡혔다. **인용 구간 불변식**으로 교체 — 명령이 인용 안에서 시작하면 지시가 아니다(여는 부호를 기억하고 같은 부호로만 닫는다). 스캔 대상도 `git ls-files`에 위임해 "배포 대상인가"를 우리가 열거하지 않는다. 프로덕션 코드 0줄.
- **`README.md`가 규칙 전파를 두 자리로만 안내했다**(D26 ④ — ③의 처방을 적용한 **직후** 재발). "수정하는 법"이 *"규칙 바꾸기 → `RULES.md` + `hooks/session-start.js`"*였는데, `session-start.js`는 SUMMARY 블록을 읽어갈 뿐이라 **고칠 필요가 없는 파일**이다. 네 자리(본문 → SUMMARY → `agents/` → `skills/`·`commands/`) + 잔존 확인 `grep`으로 교체했다.
- **`README.md` 훅 표에 `pdca-gate`가 아예 없었다.** `PreToolUse(Write|Edit)`를 "보호 파일 + 시크릿 감지"로만 적어, 선행조건 게이트(`REVIEW.md` 없이 REPORT 불가)·상태 스키마 강제·이번 사이클 폴더 차단이 **전부 미기재**였다. 오늘 추가한 것뿐 아니라 원래 있던 기능도 문서에 없었다.
- KICKOFF 탈출구를 지시 **앞**으로 이동. 구체적 지시 9개 뒤에 붙은 "사소하면 무시해도 된다" 한 줄은 구조적으로 진다.

### 안 닫힌 것
- 🟡 **소비자 대조군은 절반 닫혔다.** devkit 밖의 빈 프로젝트(`package.json`만 있는 디렉터리)에서 cwd를 소비자로 두고 훅을 절대경로로 호출한 결과 — 차단 2건(사이클 폴더 PNG·하위폴더 HTML), 통과 2건(`PLAN.md`·`public/logo.png`) 전부 기대대로. `session-start`(SUMMARY 주입)·`pdca-detect`·`verify-evidence`도 `MODULE_NOT_FOUND` 없이 정상 degrade했다. **D22의 경로·모듈 해석 축은 닫혔다.**
  - 남은 것은 **플러그인 로딩 자체**다 — 마켓플레이스 설치 → `hooks.json` 등록 → Claude Code의 `${CLAUDE_PLUGIN_ROOT}` 전개는 실제 소비자 세션에서만 밟힌다. 이 축은 자기 레포(설치경로=소스경로)에서 원리적으로 관측되지 않는다.
  - 부수 실증: 소비자 쪽에서도 `"로그인 화면 시안 만들어줘"`에 `pdca-detect`가 아무 출력을 안 낸다 — D26 ②(안내 채널이 그 상황에 안 뜬다)가 그대로 재현되고, 훅으로 옮긴 판단이 맞았음을 보인다.
- **D26 ③의 처방은 아직 문서 지시다.** D23이 단언(`test/track.test.mjs` B6)으로 닫힌 것과 대비된다. "RULES의 규칙 X와 `agents/`·`skills/`가 모순되지 않는다"를 기계로 물으려면 규칙을 식별자로 들고 있어야 하는데 그 표현을 못 정했다 — 열거로 가면 허용목록이 되어 D24·D25와 충돌한다.
- **무결성 매니페스트가 지시 층을 안 덮는다.** `gen-integrity.mjs`의 `TARGET_DIRS`는 `hooks`·`scripts`의 `.js`/`.mjs` 32개뿐이다(자동 실행 코드의 변조 탐지가 목적인 의도된 범위). 그런데 D26이 밝힌 것은 **`agents/*.md`·`skills/*/SKILL.md`·`commands/*.md`도 실행되는 층**이라는 것이다 — LLM 하네스에서 "실행"의 정의가 `.js`보다 넓다. 이번에 `agents/` 2개를 고쳤지만 매니페스트는 움직이지 않았다. 범위를 넓힐지 미판단.
- 이 릴리스의 사이클 문서가 얇다. `docs/2026-07-29-cycle-folder-guard/`는 Quick이고 **사용자 승인하에 GAP·REVIEW·REPORT를 생략**했다(검증은 테스트로 대체). `views/` 폐지는 사이클 밖 대화에서 나왔다.
- 0.16.0에서 이월: `SCANNED` 확장자 열거(`templates/*` 사각) · 멀티라인 오탐 · 홀로 뜬 아포스트로피 미탐 · untracked 미스캔 · `invocation-path.test.mjs` 440줄(200줄 초과).
- `/flow`는 아직 Full 전용 — `commands/flow.md`의 "DESIGN 없이 Build 금지"가 Quick과 충돌한다(0.16.0에서 이월).

## [0.16.0] - 2026-07-28

**Quick/Full 트랙** — 한 줄 수정에도 PLAN→DESIGN 2단 승인을 요구하던 마찰을 없앤다. Quick은 **DESIGN.md와 두 번째 승인만** 생략하고 `behaviors.json`·`/gap`·`/review`·REPORT는 전부 필수로 남는다. 결함로그 D4 해소, D23 신설. 새 의존성 0.

### Added
- `hooks/lib/track.js` — `readTrack(planText)` 순수함수. PLAN 상단 10줄의 `- **track**: Quick|Full`을 읽고, 못 읽으면 `null`(추측하지 않는다). fs 미사용, 어떤 입력에도 throw 없음.
- `RULES.md` §PDCA에 트랙 표 + `commands/plan.md` 1·4·9·10단계 + `pdca-detect` KICKOFF 분기.
- `test/track.test.mjs`(17건) — 그중 **B4는 입력을 조립하지 않는다**. `commands/plan.md`의 코드펜스에서 템플릿 줄을 뽑아 파서에 먹인다(추출은 구조로, 판정은 `readTrack`으로 — 파서로 고른 입력을 그 파서가 파면 무검사다).

### Changed
- **트랙 판정은 열거가 아니라 불변식 하나다.** `track: Quick`은 미해결 `[NEEDS CLARIFICATION]`이 0건일 때만 유효하고, 1건이라도 남으면 **읽는 시점에** Full로 강등된다(파일은 고치지 않는다 — 고치면 모델이 되돌려 무한 왕복이다). "파일 3~5개" 같은 열거는 차원마다 독립적으로 틀린다.
- 마커 해결 표기는 **제거** 하나로 고정. `[RESOLVED]`·취소선을 인정하면 그게 허용목록이 되어 다음 표기에서 샌다.
- `RULES.md` "같은 문서의 예시" 규칙에서 **대상 열거를 걷어냈다** — 판정을 "복사되는가 / 항상 보이는가" 두 축으로.

### Fixed
- **SUMMARY 블록이 새 규칙을 배포 시점에 껐다**(D23). 트랙 표를 §PDCA 본문에만 넣었는데, 매 세션 주입되는 SUMMARY는 `멈춤점은 PLAN·DESIGN 승인 2곳`을 그대로 말하고 있었다 — 항상 보이는 층이 이긴다. 리뷰 🔴로 잡았고 `test/track.test.mjs`가 정합성을 단언으로 고정한다.

### 안 닫힌 것
- **Quick 경로는 이 사이클에서 한 번도 실행되지 않았다.** 검증은 형태까지다(훅·커맨드 변경은 세션 재시작 후 반영 — D17). 실사용 Quick 완주 1건이 다음 사이클로 이관됐다.
- **Full → Quick 강등 금지는 검사되지 않는다** — 훅이 track을 읽지 않기로 한 대가로 원리적으로 강제 불가. 트랙을 게이트 입력으로 만들면 사람이 손으로 쓴 한 줄이 검증 층을 끄는 경로가 열린다.
- `track.js`는 **호출자 0인 모듈**이다(의도된 설계, 회귀 테스트가 미배선을 적극 단언).
- `/flow`는 아직 Full 전용 — `commands/flow.md`의 "DESIGN 없이 Build 금지"가 Quick과 충돌한다.

## [0.15.0] - 2026-07-27

devkit이 **자기 레포 밖에서 돌지 않던 것**을 고친다. 3사이클(0.12~0.14)에 걸쳐 만든 evidence 검증 층(L3a)의 실행 지시가 전부 프로젝트 상대경로라, 남의 프로젝트에 설치하면 `MODULE_NOT_FOUND`였다. 결함로그 D22, D10 부분 해소. 새 의존성 0.

### Added
- `test/invocation-path.test.mjs` — 문서에서 검증 명령을 추출 → `${CLAUDE_PLUGIN_ROOT}` 치환 → **devkit 밖 임시 프로젝트에서 실행**. 자기 레포에서는 두 경로의 결과가 같아 이 결함이 관측되지 않는다.
- `/gap`·gap-detector에 **러너별 lcov 생성 표**(node:test·vitest·pytest·go·cargo). 실측하지 않은 행은 `미실측`으로 표시하고 테스트가 그 구분을 강제한다.
- `README`에 `## 요구사항`(Node 20+ — 비-Node 프로젝트에도 검증 층은 node로 돈다).

### Changed
- 검증 스크립트 실행 지시 **6곳**을 `node "${CLAUDE_PLUGIN_ROOT}/scripts/verify-evidence.mjs"`로 통일. 열거는 세 번 다 빗나갔고(4→5→6) 6번째는 전수 스캔 테스트가 잡았다.
- 도구가 스스로 내는 런타임 안내가 `fileURLToPath`로 **자기 실제 경로**를 찍는다. 전에는 상대경로를 알려줘 복붙하면 죽었다.
- 에이전트의 규칙 접근을 **플러그인 파일 Read에서 뺐다**(7개 전수) — 본문 리터럴(1차) + 프로젝트 `AGENTS.md`(2차). 치환은 되지만 프로젝트 밖 Read는 승인 프롬프트를 부른다(D10).

### Fixed
- **lcov가 없으면 보고에 드러난다.** 전에는 `uncovered 0 · dead-branch 0`으로 나와 "커버리지가 돌아서 깨끗한 것"과 구분 불가였다(`--json`에 `lcovPresent`).

## [0.14.0] - 2026-07-27

인용 대조를 **마커 무관 + receipt 한 줄 전체 일치**로 전환. pytest·go test·cargo·rspec에서 조용히 `skipped`(무검증)이던 것이 `cited`/`uncited`로 보고된다. 결함로그 D21. 새 의존성 0.

- `citation.js`에서 `TICK_RE`·`TICK_LINE_RE` 제거, `tickLines`→`candidateLines`(Set), `includes`→`has`. **코드에 러너 목록이 없다.**
- `detick`의 전제가 무너져(보고서 줄이 전부 대조 후보가 된다) **기존 불변식을 재사용**하는 형태 규칙으로 교체 — `extractQuotes`가 `' · '`로 자르므로 인용 조각은 그걸 품을 수 없다. `emit`/`diag.warn`이 모든 출력 줄에 그 형태를 강제한다.
- 알려진 신규 오탐: 러너 줄 자체가 공백으로 띄운 `·`를 품으면 통째로 붙여도 `uncited`다(정리의 뒷면). 코드로 완화하면 방벽이 죽어 문서로 처리했다.

## [0.13.0] - 2026-07-26

receipt 인용 대조를 **cmd 일치 방식**으로 전환 — `evidence.cmd`와 실행 명령이 맞는 receipt에서만 대조한다. 결함로그 D15·D18·D20의 **우발적 오염** 경로 해소. 새 의존성 0.

- `hooks/lib/citation.js` 분리(토큰 부분집합 `evidence ⊆ receipt`), 이름 블랙리스트 `SELF_RE` 제거.
- `no-cmd-match` 상태 추가 — 매칭 0건을 `uncited`에 뭉개지 않는다(조치가 다르다).
- `MAX_STDOUT` 8K→32K · `MAX_FILE` 2M→8M(비율 256 고정). 실행 출력 17,036자가 절단 없이 보존된다(D18).
- 의도적 위조는 안 닫혔다 — `cmd`를 맞춰 적고 인용 줄을 직접 출력하면 통과한다(설계 수용, docblock 명시).

## [0.12.0] - 2026-07-25

evidence 적합성 검증 L3a — `unproven==0`이 보장하는 범위를 **"증거가 있나"에서 "그 증거가 실재하나"로** 넓힌다. 결함로그 D11-b 해소, D12 부분 해소. 새 의존성 0.

### Added
- **`hooks/lib/evidence.js`** — evidence `ref`의 파일 실존 판정. `hooks/pdca-gate.js`가 `unresolved > 0`이면 **REPORT.md 쓰기를 `exit 2`로 차단**한다(게이트는 이 한 종류뿐). 아카이빙된 사이클 문서를 자동으로 따라가는 **archive 폴백** 포함 — 없으면 완료된 사이클의 evidence가 전부 위조로 둔갑한다.
- **`hooks/lib/receipt.js` + `hooks/bash-receipt.js`** — PostToolUse(Bash)가 명령·출력을 `.devkit/receipts.jsonl`에 봉인하고, evidence `output`의 인용을 대조한다(보고 전용). 시크릿은 `secret-patterns.js` 재사용으로 마스킹, `DEVKIT_RECEIPTS=0`으로 끌 수 있다.
- **`hooks/lib/lcov.js`** — lcov 파싱으로 `target` 코드의 **도달 불가 분기(`dead-branch`)·미실행(`uncovered`)** 판정. Node 내장 `--experimental-test-coverage` 사용.
- **`scripts/verify-evidence.mjs`** — 3층 판정 보고 CLI. `/gap`·`gap-detector`가 커버리지 수집형 테스트 명령과 함께 호출한다. **exit code는 항상 0**(차단은 훅만 한다).
- **`behaviors.json`에 `target` 필드** — behavior가 겨냥하는 **구현 코드** 위치(`ref`는 테스트 파일, `target`은 검증받는 쪽). 다음 사이클 뮤테이션의 입력이기도 하다.
- 테스트 147 → **234**. 무결성 22 → 28파일.

### Fixed
- **D11-b: evidence `ref` 실존 검사 없음** — 그럴듯한 문자열만 있으면 통과하던 것을 게이트로 막는다.
- **D12(부분): 데드코드 시드 통과** — 커버리지가 도달 불가 분기를 실제로 잡는다(`BRDA:2,2,0,0` 독립 재현). PLAN이 "가설"로 분모에 넣은 항목이 실증됐다. 단 **"실행되지만 결과에 영향 없음"은 여전히 못 잡는다** — 뮤테이션(L3b)이 필요하다.
- 도그푸딩으로 **DESIGN이 번호까지 박아둔 fail-open E4의 미검증**을 발견해 메웠다(테스트 208개가 통과하는데 그 분기는 한 번도 안 탔다).

### Changed
- `/gap`·`gap-detector`의 테스트 실행이 **커버리지 수집형**으로(다중 리포터 1회 실행으로 spec + lcov).
- `RULES.md`에 L3a 판정표·`target` 설명·receipts 프라이버시 고지. `commands/plan.md` 템플릿에 `target`.

### Known issues
- 🔴 **L3a-2(receipt 인용)는 우회 가능하다** — `git diff` 한 번이면 위조 evidence가 `cited`로 뒤집힌다(결함로그 D15). `evidence.cmd`와 receipt `cmd` 대조로 전환해야 하며 **설계 변경이라 다음 사이클**이다.
- **폴더명 위조는 어느 층에서도 안 막힌다** — 게이트에서 오탐 방지를 위해 의도적으로 포기했고 이관 대상 층이 미완이다.
- **마스킹은 알려진 키 형식 9종뿐** — `export K=V`·DB URL·`Bearer …`는 평문으로 남는다.
- **낡은 lcov로 판정이 돌 수 있다**(D16) — `verify-evidence`가 증거의 나이를 확인하지 않는다.

## [0.11.0] - 2026-07-25

*(당시 누락되어 0.12.0 작업 중 소급 기록)*

review를 **GAP↔REPORT 사이 독립 필수 단계로 승격**하고, 게이트를 문서 지시가 아닌 훅으로 강제한다.

### Added
- **`hooks/pdca-gate.js`** (PreToolUse Write|Edit) — 사이클 산출물의 **선행조건을 실제로 강제**한다. `GAP.md`는 `behaviors.json`을, `REPORT.md`는 `behaviors.json`·`GAP.md`·`REVIEW.md`를 요구하고 없으면 `exit 2`. 빈 파일은 없는 것으로 본다(`touch` 우회 차단). `.devkit/pdca-state.json`의 4필드 스키마 검증도 같은 훅.
- 테스트 87 → 147.

### Changed
- `/review`가 사이클 필수 단계 — REVIEW.md가 없으면 REPORT.md 쓰기가 훅에 차단된다(결함로그 D13: review 없이 "완료" 선언된 사이클에 실제 버그 3건이 남아 있었다).

### Fixed
- D13(review가 필수가 아님) · D14(아카이빙 경로·status 불일치).
- **핵심 교훈**: `commands/gap.md`가 "`gatePrerequisite`가 같은 판정을 한다"고 써놨지만 **마크다운은 JS를 호출할 수 없었다.** 하드 게이트가 실제로는 AI의 성실성에 의존했고 그래서 D7·D8이 재발했다.

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
