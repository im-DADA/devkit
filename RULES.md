# 팀 개발 규칙 (devkit)

이 플러그인을 설치한 모두에게 적용되는 공통 개발 원칙. 프로젝트별 특수 규칙은 각 레포의 `CLAUDE.md`가 우선한다.

> **이 문서가 규칙의 단일 소스(source of truth)다.** 세션 시작 리마인드(`hooks/session-start.js`)는 아래 요약 블록을 그대로 읽어 주입한다. 규칙을 바꿀 땐 **이 파일만** 고친다.

<!-- SUMMARY:START -->
## devkit 팀 규칙 리마인드

- 한국어 간결히. 결론부터.
- ❌ 금지: 추측 답변, 요청 안 한 코드·문서 생성(PDCA 산출물은 예외).
- 🟡 확인 필요: 새 의존성 추가, force/reset --hard/브랜치 삭제, 커밋·푸시·PR, 외부 게시.
- 📋 플랜 우선: 파일 3개+·여러 화면/단계 걸리는 기능은 "그냥 해줘"라도 바로 구현 X → 플랜 짜겠다 밝히거나 "플랜부터? 바로 구현?" 한 번 묻는다. 한 줄 수정은 예외.
- 🔄 PDCA 사이클: 기능 작업은 `docs/{날짜}-{slug}/`에 PLAN→DESIGN→(구현)→GAP→REVIEW→REPORT를 남긴다. PLAN 첫머리 `- **track**: Quick|Full` 1줄로 트랙을 정한다 — **멈춤점은 Full 2곳(PLAN·DESIGN), Quick 1곳(PLAN만, DESIGN 생략)**. Quick도 behaviors.json·Gap·Review·REPORT는 전부 필수(미달 시 /iterate). 완료 후 `docs/archive/`로 이동. slug는 영문, 문서 본문은 사용자 언어.
- 📁 사이클 폴더엔 **`.md`/`.json`만** — 시안·목업 HTML·스크린샷·PNG·데이터는 `design/`·`public/`·코드 옆에 두고 문서에선 **경로로 참조**한다(`docs/`는 보통 gitignore + 아카이빙되면 묻힌다). 훅이 차단한다.
- ✅ 검증 무결성: `behaviors.json`이 Gap의 분모. **`passes:true`는 evidence(실행 흔적)가 있어야 유효** — 없으면 자동 강등된다. 통과 기준은 `unproven==0`이지 Match Rate 숫자가 아니다. 상세는 RULES "PDCA 사이클".
- Feature 구조: `features/{f}/`에 components(.tsx) · hooks·api·data·types·utils(.ts). **`views/` 층 없음** — 화면 조립·`metadata`·서버 fetch는 `app/**/page.tsx`가 직접 한다. `"use client"`는 폼·토글 같은 조각에만(page에 붙이면 metadata를 잃는다).
- 🔒 .tsx엔 로직 금지 — 상태(useState/useEffect)·핸들러·계산·페칭은 무조건 .ts(커스텀 훅/유틸)로 분리.
- 네이밍(린터가 못 잡는 것만): 훅 use* · 핸들러 handle*/on* · boolean is/has/can* · 파일·폴더 kebab-case. 축약어/부정boolean 금지.
- 라이브러리·프레임워크가 있다고 가정하지 말 것 — 쓰기 전 package.json으로 확인.
- 🧪 새 순수함수/명확한 계약(멱등성·경계·격리·대소문자 등)은 **테스트 먼저(TDD)**. 테스트 러너 없으면 조용히 넘기지 말고 "테스트 셋업할까?"를 물어볼 것. 강하게 하려면 `/tdd`.
- 새 유틸/훅 작성 전 Grep으로 기존 것 탐색 → 재사용.
- 커밋: Conventional Commits, Co-Authored-By 금지.

커맨드: /plan · /gap · /cycles · /review · /ship · /kit — 상세 규칙은 플러그인 RULES.md
<!-- SUMMARY:END -->

## 언어 & 톤

- 한국어로 간결히. 기술 용어는 영문 그대로.
- 결론부터. 서두/요약 반복 생략.

## 절대 금지

- ❌ 에러 조용히 swallow하는 try/catch → **throw하거나 상위 전파**.
- ❌ "아마도/~일 수도" 흐린 표현 → 확신 없으면 "모름".
- ❌ 추측으로 답 만들기 → Read/Grep/WebSearch로 확인.
- ❌ TypeScript `any` → `unknown` + narrowing.
- ❌ 에러 메시지/로그 한국어 번역 → **원문 유지**.
- ❌ 커밋 전 `console.log` 잔존.
- ❌ 요청 안 한 리팩토링/파일 생성(README, 테스트 등).
  - **예외: PDCA 사이클 산출물**(`PLAN.md`·`DESIGN.md`·`behaviors.json`·`PROGRESS.md`·`GAP.md`·`REVIEW.md`·`REPORT.md`)은 워크플로 자체라 여기 해당하지 않는다. 기능 작업에서 이 문서들을 만드는 건 "요청 안 한 파일 생성"이 아니다.

## 선제 확인 필요

- 🟡 새 라이브러리/의존성 추가 → 먼저 물어볼 것.
- 🟡 `--force`, `reset --hard`, 브랜치 삭제 → 반드시 확인.
- 🟡 `git checkout <경로>` / `git restore <경로>` → 되돌리기 **전에** `git diff <경로>`로 범위를 본다. "한 파일만 되돌린다"고 생각한 명령이 같은 파일의 다른 미커밋 작업까지 지운다. 뮤테이션 검증은 수동 편집 → 수동 원복이 안전하다.
- 🟡 커밋/푸시/PR 생성 → 명시적 요청 시에만.
- 🟡 외부 서비스에 글 올리기(GitHub 코멘트, Slack) → 승인 후.

## 작업 시작 전 — 플랜 우선

- **여러 파일·화면·단계가 걸리는 기능 요청**을 받으면, 사용자가 "그냥 해줘"라고만 해도 **바로 구현에 들어가지 말 것.** 먼저 (a) 규칙대로 플랜/설계를 짜겠다고 밝히거나, (b) "플랜부터 세울까요, 바로 구현할까요?"를 한 번 묻는다.
- 플랜에는 접근법·건드릴 파일·데이터 흐름·엣지케이스를 담고, 큰 기능은 SPEC/DESIGN 문서화(`/spec`, `/plan`, `/flow`)를 검토한다.
- 한 줄짜리 변경·단순 수정·명확한 단일 작업은 플랜 없이 바로 실행 — 오버엔지니어링 금지.
- 판단 기준: **되돌리기 어렵거나, 파일 3개 이상 만지거나, 구조 결정이 필요하면 플랜 먼저.**

## PDCA 사이클

기능 작업은 **문서를 남기며 단계별로** 진행한다. `pdca-detect` 훅이 기능 요청을 감지하면 이 규약을 리마인드한다.

### 흐름

```
① 기능 요청 → PLAN.md 작성(첫머리에 track) → 보여주고 [승인 대기]
② (Full만) 승인 → DESIGN.md 작성(architect) → 보여주고 [승인 대기]
   Quick은 ②를 건너뛰고 ① 승인 후 바로 ③
③ 승인 → 구현(Do)
④ 구현 후 /gap 필수 → 증거 대조 (통과 기준: unproven == 0)
   └ 증거 없는 통과 주장이 남으면 /iterate 루프로 되돌아감
⑤ /review 필수 → REVIEW.md (🔴 버그·보안 / 🟡 컨벤션 / 🟢 nit)
⑥ 통과하면 REPORT.md → 사이클 아카이빙
```

**멈춤점은 Full ①② 두 곳, Quick ① 한 곳.** 문서를 보여주고 사용자가 명시적으로 승인하기 전에 다음 단계로 넘어가지 않는다.

| 트랙 | 멈춤점 | DESIGN.md | behaviors.json · /gap · /review · REPORT | 훅 게이트 |
|---|---|---|---|---|
| **Quick** | ① **1곳** | 생략(없는 게 정상) | **전부 그대로 필수** | 동일 |
| **Full** | ①② 2곳 | 필수 | 필수 | 동일 |

- PLAN 첫머리 `- **track**: Quick|Full` 1줄로 선언한다. **선언 형식의 정본은 `hooks/lib/track.js`의 `TRACK_RE`**이고, 그 함수는 못 읽으면 `null`을 돌려준다(없는 선언을 발명하지 않는다). **`null`을 Full로 취급하는 것은 이 문서의 규칙이다** — 훅이 강제하지 않는다.
- **Quick은 미해결 `[NEEDS CLARIFICATION]`이 0건일 때만 유효**하다 — 1건이라도 남으면 Full로 판정된다. DESIGN이 답할 질문이 남았으면 DESIGN을 건너뛸 수 없다. 해결은 **마커를 답으로 교체**하는 것이고, 경위는 PROGRESS.md에 한 줄.
- **Quick → Full 승격은 언제든, 단방향.** **PLAN 승인 후** Full → Quick 강등은 금지 — "설계가 어려워지자 트랙을 낮춰 회피"가 열린다. 트랙은 PLAN 승인과 함께 확정되므로 **승인 전 정정은 강등이 아니다**(사유를 PROGRESS에 한 줄).
- **Quick은 PLAN이 결정을 미룰 자리가 없다.** "이건 DESIGN에서 정한다"고 남기면 **아무도 안 정하고 기본값으로 굳는다** — 실측: 그렇게 미룬 한 항목이 440줄 파일이 됐다. Quick으로 갈 거면 PLAN에서 다 정하고, 못 정하겠으면 그게 Full이라는 신호다.
- 트랙은 **게이트의 입력이 아니다.** `pdca-gate`는 track을 읽지 않는다 — 읽으면 PLAN.md에 손으로 쓴 한 줄이 검증 층을 끄는 경로가 된다.

### 폴더 규약

```
docs/
  {YYYY-MM-DD}-{slug}/     ← 진행 중인 사이클만 여기
    PLAN.md   DESIGN.md   behaviors.json   PROGRESS.md   GAP.md   REVIEW.md   REPORT.md
  archive/
    {YYYY-MM-DD}/{slug}/   ← 완료 후 이동
```

- **사이클 폴더에는 위 7개 `.md`/`.json`만 둔다.** 시안·목업 HTML·스크린샷·PNG·데이터 파일·산출물은 **넣지 마라** — 사이클 폴더는 **판단의 기록**이지 결과물 저장소가 아니고, `docs/`는 보통 gitignore라 거기 넣으면 **git에 안 남고 아카이빙되면 더 묻힌다.** 시안·이미지는 프로젝트의 실제 위치(`public/`·`assets/`·`design/` 등)에 두고 문서에서는 **경로로 참조**한다.
- **slug**: 기능 설명을 **영문 kebab-case 2~4단어**(`payment-retry`). 최대 40자. 폴더·파일명은 경로 호환성 때문에 영문으로 고정하고, **문서 제목·본문은 사용자 언어를 따른다**(한국어로 대화하면 한국어 문서, 영어면 영어 문서).
- 날짜는 사이클 **시작일**로 고정. 같은 날 충돌 시 `-2`, `-3` 접미.
- 완료(REPORT 승인) 시 폴더를 `docs/archive/{날짜}/{slug}/`로 이동 → `docs/` 최상위엔 진행 중인 것만 남는다.
- **Gap·Review는 필수 단계다.** 스킵하고 REPORT로 건너뛰지 않는다 — `GAP.md`·`REVIEW.md`가 없으면(빈 파일 포함) `pdca-gate` 훅이 REPORT.md 쓰기를 차단한다.
- **PLAN에서 "이 결함·기능이 우리 레포 안에서도 실제와 같게 관측되는가"를 묻는다.** 라이브러리·CLI·플러그인처럼 **남이 설치해 쓰는 것**을 만들면, 자기 레포에서는 두 값이 우연히 같아져(설치 경로 = 소스 경로, 자기 참조가 해석됨) 결함이 **원리적으로 관측되지 않는** 축이 있다. 그런 축이면 **소비자 쪽 대조군**(빈 프로젝트에 설치해 실행)이 검증의 필수 단계다 — 자기 도그푸딩은 그 결함에 대해 무력하다.
- **규칙을 추가·수정하면 같은 문서에서 그 규칙과 충돌하는 자리를 함께 고친다.** 대상을 열거하지 말고 둘만 봐라 — **예시는 산문보다 강하게 복사되고**(스키마·스니펫·기본값), **항상 주입되는 요약은 열어야 보이는 본문을 이긴다**(SUMMARY 블록 vs 본문). 충돌하면 규칙이 지는 쪽이다. 본문에만 고치면 새 규칙이 배포 시점에 꺼진다(D23).
- **한 번 "닫았다"고 기록한 판단이 이후 회차에 뒤집히면, 새 문서에만 적지 말고 원래 기록 자리에 반전 블록을 남긴다.** GAP·DESIGN은 REPORT의 입력물이고 리포트 작성자는 최신 문서만 읽지 않는다 — 뒤집힌 기록을 그대로 두면 완료 보고서가 사실과 다른 성과를 싣는다. 인용한 코드·줄번호가 더 이상 존재하지 않는다는 것까지 적을 것.

### 검증 무결성 (증거 없으면 통과 아님)

사이클 폴더의 `behaviors.json`이 Gap 분석의 **분모**다. `/plan`이 behavior를 전부 `passes:false`로 만들어 분모를 고정한다(사후에 항목을 줄여 점수를 올리는 것을 막는다).

```json
{ "id": "B1", "desc": "…", "priority": "P1", "passes": true,
  "target": "src/discount.ts:42",
  "evidence": { "kind": "test", "ref": "test/x.test.ts:42",
                "cmd": "node --test test/x.test.ts",
                "output": "✔ B1: 100,000 경계에서 할인 적용 (2.1ms)", "at": "…" } }
```

- `cmd`는 **실제로 돌린 명령 전체**다. `"node --test"`처럼 줄여 적으면 아무 실행에나 매칭돼 대조가 무의미해진다.
- `output`은 **러너가 낸 출력을 그대로** 붙인 것이다. 위의 `✔`는 node:test가 찍은 문자지 사람이 붙이는 마커가 아니다 — pytest·go test는 그 러너의 출력 형식 그대로 쓴다. **대조는 마커를 보지 않는다.**
- 🔑 **러너가 낸 줄을 "통째로" 붙여라.** 대조는 receipt의 **한 줄 전체와의 일치**다 — 앞뒤를 다듬거나 테스트명만 잘라 붙이면 정직한 실행도 `uncited`로 보고된다(게이트는 아니다). 흡수되는 차이는 공백과 소요시간 표기(`(2.1ms)`) 둘뿐이다. 여러 줄을 붙여도 되고, **` · `**(양옆 공백)로 서술을 덧붙여도 된다 — 조각 하나만 맞으면 `cited`다. 공백 없이 `·`만 쓰면 조각이 안 쪼개져 정직한 인용도 `uncited`가 된다.
  - ⚠ **러너 줄 자체에 공백류로 띄운 `·`가 있으면 그 줄은 인용할 수 없다.** 인용은 ` · `로 조각나는데 대조 후보 줄은 안 잘리므로, 통째로 붙여도 같아질 수 있는 조각이 원리적으로 없다(위 `·` 방벽의 뒷면이다). 판정은 **공백 정규화 후** 하므로 탭·여러 칸으로 띄운 것도 같다. → **다른 줄을 고르고, 테스트 이름에서는 `·` 양옆을 띄우지 마라** — 쉼표·슬래시로 바꾸거나, `·` 자체가 의미를 갖는 경우(경계 문자 목록 등)엔 `"·"`처럼 **붙여 쓰면** 인용 가능해진다.
  - ⚠ **테스트별 줄이 나오는 옵션으로 돌려라.** 기본 pytest는 테스트마다 점만 찍어(`tests/test_x.py ....  [100%]`) 인용할 안정된 줄이 없다 — `-v`를 붙인다. 요약 줄(`===== 1 passed in 0.03s =====`·`ok example/pkg 0.123s`)은 어느 behavior를 입증하는지 말해주지 않으므로 인용 대상으로 부적절하다.

- **`passes: true`는 evidence가 있어야 유효하다.** `output`(실행 흔적)이 없으면 읽는 시점에 자동으로 false로 강등된다 — 되돌릴 대상이 없으므로 우기기가 통하지 않는다.
- `kind`는 `test` | `visual` | `manual`. UI처럼 유닛 테스트가 부적절한 것은 `visual`/`manual`로 하되 **확인 절차를 output에 남긴다**.
- **통과 기준은 `unproven == 0`**(증거 없는 통과 주장이 0건). **Match Rate는 참고 신호일 뿐 게이트가 아니다** — 자기 설계를 자기가 채점하면 점수가 인플레된다.
- `ref`는 **검증하는 쪽**(테스트 파일), `target`은 **검증받는 쪽**(구현 코드 위치)이다. `target`은 선택이고 없으면 커버리지 판정을 건너뛴다.

#### evidence 적합성 3층 (L3a)

`unproven==0`은 "증거 없는 통과 주장이 없다"까지만 보장하고 "주장된 통과가 진짜다"를 보장하지 않는다. 그래서 세 가지를 더 본다.

| 판정 | 질문 | 결과 |
|---|---|---|
| `unresolved` | `ref`가 가리키는 파일이 실재하나 | **게이트 — REPORT.md 쓰기가 차단된다** |
| `no-cmd-match` | `cmd`가 주장한 명령을 실제로 돌린 기록이 있나 | 보고 |
| `uncited` | (그 명령을 돌렸는데) `output`의 인용이 그 출력의 **어느 한 줄과 통째로** 같나 | 보고 |
| `no-receipt` | 봉인이 시작되기 전 evidence인가(소급 불가) | 보고 |
| `dead-branch`·`uncovered` | `target` 코드가 실행되기는 하나 | 보고 |

- **이 층은 플러그인 안에서 돈다** — `node "${CLAUDE_PLUGIN_ROOT}/scripts/verify-evidence.mjs"`. 프로젝트 상대경로로 부르면 스크립트가 프로젝트 안에 없어 `MODULE_NOT_FOUND`다. 그리고 **이 층의 커버리지 입력은 lcov 파일 하나다** — 없으면 판정하지 않고 그 사실을 보고 헤더에 밝힌다(러너별 생성 방법은 `/gap`·gap-detector 문서의 표).
- **게이트는 `unresolved` 하나뿐이다.** 나머지는 오탐 여지가 있어 보고만 한다 — 오탐으로 정직한 사이클을 막는 것이 놓치는 것보다 나쁘다.
- `target`은 **분기 조건 라인**을 가리켜야 도달 불가 분기(`dead-branch`)가 잡힌다. 블록 안쪽을 가리키면 `uncovered`만 나온다.
- ⚠ Node는 경로에 `test/` 세그먼트가 있는 파일을 커버리지에서 제외한다. `target`이 `test/` 아래면 항상 `no-data`다.
- **Bash 실행 기록은 `.devkit/receipts.jsonl`에 남는다**(gitignore 대상). 인용 대조의 근거이고, 지우려면 그냥 `rm`, 아예 끄려면 `DEVKIT_RECEIPTS=0`. 봉인이 시작되기 전 사이클을 소급 검사하면 `no-receipt`가 대량으로 뜨는데 그건 위조가 아니라 기록이 없는 것이다.
  - 🔑 **마스킹은 `secret-patterns.js`의 알려진 키 형식 9종(AWS·GitHub·Slack·Stripe·Google·private key·JWT 등)뿐이다.** 그 외 — `export DB_PASSWORD=…`, `DATABASE_URL=postgres://user:pw@…`, `Authorization: Bearer …` 같은 형태는 **평문으로 남는다**. 명령·출력 전문이 기록된다는 뜻이므로 시크릿을 다루는 명령을 돌릴 땐 `DEVKIT_RECEIPTS=0`을 쓰거나 기록을 지워라.
- **인용 대조는 `evidence.cmd`와 실행 명령이 맞는 receipt에서만 한다.** `cmd`에는 실제로 돌린 명령을 **그대로** 적어라 — 표기가 다르면 대조 후보가 0건이 되어 `no-cmd-match`로 보고된다(게이트는 아니다. 조치는 "그 명령을 그대로 다시 돌려라").
- **이 층은 러너 종류를 모른다.** 코드에 러너 목록이 없고(화이트리스트는 다음 러너에서 또 샌다) 마커도 안 본다 — 인정 근거는 "실행 로그의 한 줄은 통째로 그 줄이다"라는 형태 하나다. 그래서 pytest·go test·cargo·rspec에서 그대로 성립하고, 마커가 없다는 이유로 조용히 `skipped`가 되던 무검증이 사라진다.
- ⚠ **검증 도구 자신의 출력에는 `·`가 박혀 있다.** 장식이 아니라 방벽이다 — 인용 조각은 ` · `로 잘려 나오므로 그걸 품은 줄은 어떤 인용과도 같아질 수 없다. 보고서 한 행이 봉인돼 다음 회차에 위조를 입증하는 경로(cross-row 조립)를 그 형태 하나로 막는다. **지우지 마라.**
- **`/iterate` 회차 중 테스트 파일이 바뀌면 그 회차 점수는 무효**다(롤백은 아니고 사람에게 보고). 보완 과정의 정당한 테스트 추가와 "기존 테스트를 통과하도록 고치는 것"을 사람이 구분한다.

### 진행 추적 3층

"어디까지 했나"를 세 곳이 나눠 담는다. 각 갱신이 "필드 하나 토글 / 줄 하나 추가 / 커밋"이라 전체 재작성이 없다 — 넓은 JSON 상태 파일은 null로 썩는다는 교훈.

| 층 | 파일 | 담당 | 갱신 |
|---|---|---|---|
| 어디까지 | `docs/{cycle}/behaviors.json` | behavior별 통과+증거 | `passes`·`evidence` 토글 |
| 어떻게 됐나 | `docs/{cycle}/PROGRESS.md` | 판단·회차·Breaker 판결 | append만 |
| 실제 코드 | `git log` | 진실의 원천 | 커밋 |
| 포인터 | `.devkit/pdca-state.json` | 현재 사이클·단계 | 4필드 |

**상태 파일은 4필드 포인터**(gitignore):
```json
{ "version": 1, "cycleId": "2026-07-24-payment-retry", "stage": "design", "status": "awaiting-approval" }
```
- `stage`: `plan|design|do|gap|review|report|done` · `status`: `in-progress|awaiting-approval|done` — **허용값 밖이면 `pdca-gate` 훅이 상태 쓰기를 거부한다**(정본은 `hooks/lib/pdca-state.js`의 `STAGES`·`STATUSES`).
- ⚠ **bkit이 같이 설치돼 있어도 이 형식을 쓸 것.** `cycle`/`phase`/`gates`는 bkit 스키마다 — 섞이면 재개가 깨진다(훅이 감지해 경고한다).
- 문서를 쓴 **직후 커맨드가** 갱신하고, 훅은 읽기만 한다(SessionStart가 재개 시 PROGRESS 끝·behaviors 미완료·git log를 주입).

**PROGRESS.md**는 첫 줄이 정체성 앵커(`# PROGRESS — docs/{cycle}/`)다. 각 단계·회차가 한 줄씩 append하며, git이 답할 수 있는 것(무엇이 변했나)은 안 쓰고 "왜 그렇게 판단했나"만 남긴다.

### behaviors.json 게이트 (D5 — 소비 시점 차단)

`/plan`이 behaviors.json을 만들지만 **그것에 의존하지 않는다.** 없으면 `/gap`·`/report`가 하드 거부하고("먼저 /plan의 behavior 단계 실행"), Stop 훅이 백스톱 경고를 낸다. 파일을 만들게 강제하는 대신 **없으면 다음 단계가 안 열리게** 한다(spec-kit 패턴).

지시가 아니라 **훅이 실제로 강제**한다 — `pdca-gate`(PreToolUse)가 사이클 폴더의 산출물 쓰기를 가로채 선행조건을 검사한다:

| 쓰려는 파일 | 선행 산출물 |
|---|---|
| `docs/{cycle}/GAP.md` | `behaviors.json` |
| `docs/{cycle}/REPORT.md` | `behaviors.json` · `GAP.md` · `REVIEW.md` |

빈 파일은 없는 것으로 본다(`touch`로 게이트를 여는 우회 차단). 정본은 `hooks/lib/pdca-state.js`의 `STAGE_REQUIREMENTS`다.

## Figma / 디자인 구현

- Figma MCP가 연결돼 있으면 **각 화면마다 `get_design_context`(또는 metadata/variables)로 정확한 수치를 받아** 구현: width/height, gap, padding, margin, font-size/weight/line-height/letter-spacing, color(hex), radius를 하나하나 대조한다.
- ❌ **스크린샷 눈대중으로 값(간격·크기·폰트)을 추정해 만들지 말 것.** 스크린샷은 전체 레이아웃 파악·최종 대조용이지 수치 산출용이 아니다.
- 한 화면은 처음부터 design context 값으로 정밀하게. 나중에 찔끔찔끔 고치지 말고 **한 번에 시안대로** 맞춘다.
- 벡터 에셋은 텍스트 대체 가능한지 먼저 판단(동적·반응형이면 텍스트), 브랜드 자산·아웃라인 폰트는 에셋으로. 에셋은 `public/`에 저장하고 코드에서 참조.

## 코드 철학

- 파일 200줄 넘으면 분리 검토. 로직은 훅/서비스로 빼고 `.tsx`는 렌더만.
- **Next.js App Router: `page.tsx`를 껍데기로 두지 마라. `views/` 층은 두지 않는다.** 레이아웃 마크업·조립·`metadata`·서버 fetch·세션 체크·`redirect()`/`notFound()`를 page가 직접 한다. App Router에서 **화면 파일은 `page.tsx`가 이미 그 자리**다 — `views/`는 라우트가 마크업을 못 드는 환경(Vite·CRA·RN)에서 온 층이라 여기선 중복이고, 화면 전체를 `<XxxView />`로 위임하면 page가 metadata만 든 빈 파일이 된다.
  - **`"use client"`는 상태가 실제로 필요한 조각(폼·토글 등)에만.** 화면 꼭대기에 붙이면 `metadata`(서버 전용 export)를 못 쓰고 서버 기능을 통째로 잃는다. `views/`를 두면 경계가 꼭대기로 올라가는 압력이 생기는데, 그게 이 층을 없애는 더 큰 이유다.
  - 폼처럼 화면 하나가 통째로 한 덩어리 상태면 client 경계가 `<form>` 하나로 커진다 — 그래도 page는 `<main>`·컨테이너·헤딩·진행바 같은 **서버 마크업을 들고** client 컴포넌트 하나를 부른다. 그건 껍데기가 아니다.
  - 여러 라우트가 같은 화면을 쓰거나 인터셉트 라우트로 재사용해도 **`components/`의 큰 조각 하나**면 된다. 층 이름을 따로 만들 이유가 아니다.
  - 🔎 **"엔트리가 껍데기다"는 대개 위층이 아니라 아래층의 증상이다.** 화면 파일이 200줄을 넘겼으면 조립이 아니라 **구현**이라 위층에 남길 게 없어 보이는 것이다. 판단 순서: 위층이 비었나? → **먼저 아래층 줄 수를 봐라.** 폼은 섹션 단위로 쪼갠다(`signup-account-section.tsx` · `signup-profile-section.tsx`).
- **Feature-based 구조** (엄격):
  - `src/features/{feature}/` → `components/`(.tsx feature 전용 조각) · `hooks/`(.ts 상태·로직·핸들러) · `api/`(.ts 외부호출) · `data/`(.ts 정적 데이터·상수) · `types/`(.ts) · `utils/`(.ts 순수함수). **`views/`는 두지 않는다** — 화면 조립은 `app/**/page.tsx`가 한다(위 App Router 항목).
  - `src/shared/` → 여러 feature가 공유하거나 도메인 무관 범용: `ui/`(Button·Input 등) · `hooks/` · `utils/`.
  - **page vs components**: 화면 조립·레이아웃은 `app/**/page.tsx`, 분리한 조각은 `features/*/components/`. 화면 하나를 통째로 담는 `views/`·`screens/`·`containers/` 층은 만들지 않는다.
  - **shared vs feature**: 특정 feature 전용이면 `features/*/`, 공유·범용이면 `shared/`. 개발 중 공통이 되면 `features/*/` → `shared/`로 승격(두 번째 feature가 쓰는 순간이 신호), 반대면 강등. 애매하면 YAGNI로 feature에 두고 실제 재사용될 때 옮긴다.
- 🔒 **`.tsx`에는 로직 금지.** `.tsx`는 JSX + 훅 호출/props 전달만. 계산·핸들러 구현·데이터 페칭·사이드이펙트는 `.ts`(커스텀 훅/유틸/api)로 분리. (`❌ const handleSave = async () => await fetch(...)` → `✅ const { onSave } = useUserCard(id)`)
- 파일 확장자 규칙: **JSX 있으면 `.tsx`, 없으면 `.ts`.** 커스텀 훅은 JSX가 없으니 항상 `.ts`.
- 기존 프로젝트는 **기존 구조 존중**. 억지 마이그레이션 금지.
- **검증·판정 로직의 두 번째 처방은 조건을 좁히는 쪽으로.** 입력 검증·파서·필터처럼 "이건 유효한가"를 가르는 코드에서 오탐/미탐이 나면 첫 처방은 대개 규칙 추가(예외 하나 더)다. **그게 실패해서 두 번째 처방을 낼 때는 규칙을 더 얹지 말고 인정 조건을 좁혀라** — 자유 텍스트를 완전히 분류하는 일은 케이스가 끝나지 않아서, 예외를 얹으면 다음 케이스에서 또 샌다. 조건을 좁히면 **실패가 한 방향으로만 나도록 형태가 강제**되고 그건 케이스가 늘어도 안 깨진다. 대가는 놓치는 쪽이므로 **무엇을 포기했는지 주석과 문서에 남긴다.**
  - ⚠ **"좁힌다"를 허용목록(allowlist) 열거로 구현하면 양방향으로 틀린다** — 실측: 명령 형태 허용목록이 셸 주입을 통과시키면서(경로 문자 클래스가 넓었다) 동시에 도구 자신이 안내하는 정직한 명령을 거부했다(인자 문법이 좁았다). 열거는 차원마다 독립적으로 틀린다. **좁힐 때는 열거가 아니라 불변식으로** — "치환이 끝났으므로 셸 메타문자가 남을 수 없다"처럼 **정규화·전개 이후에 참이어야 하는 성질** 하나를 단언하면 케이스가 늘어도 안 깨진다.

## 네이밍 컨벤션

| 대상 | 규칙 | 예 |
|---|---|---|
| 변수·함수 | camelCase | `userName`, `fetchUser()` |
| 컴포넌트·타입·인터페이스·enum | PascalCase | `UserCard`, `type UserProfile` |
| 커스텀 훅 | `use` 접두 + camelCase | `useUserCard` |
| 이벤트 핸들러 | 함수는 `handle`, prop은 `on` | `handleSubmit`, `<Btn onClick={...}>` |
| boolean | `is`/`has`/`can`/`should` 접두 | `isLoading`, `hasError` |
| 상수(모듈 스코프 불변) | UPPER_SNAKE_CASE | `MAX_RETRY`, `API_BASE_URL` |
| 파일(컴포넌트) | **kebab-case** (심볼명은 PascalCase 유지) | `user-card.tsx` → `export function UserCard` |
| 파일(훅·유틸·api·타입) | kebab-case | `use-user-card.ts`, `format-date.ts` |
| 폴더 | kebab-case | `user-card/`, `data-table/` |

- 축약어 금지(관용적인 것 제외): `btn`·`usr` ❌ / `id`·`url`·`api` ✅.
- 부정 boolean 금지: `isNotReady` ❌ → `isReady` 사용.
- 타입 접두사 `I`/`T` 금지: `IUser` ❌ → `User`.
- 기존 프로젝트가 다른 컨벤션이면 **기존 것 존중**.
- 주석은 "왜(why)"가 비자명할 때만.
- **YAGNI**. 당장 필요 없는 추상화/fallback 금지.
- **바퀴 재발명 금지**. 새 유틸/훅 작성 직전 Grep으로 기존 것 탐색 → 있으면 재사용.
- **라이브러리 존재를 가정하지 말 것.** import·사용 직전 `package.json`(및 lockfile)으로 실제 설치 여부 확인. 없으면 새 의존성 추가 규칙(🟡)을 따른다.

## 테스트 / TDD

**무엇을 테스트하냐가 먼저다 — 대상에 따라 방식이 다르다.**

- **순수함수·명확한 계약이 있는 로직 → TDD(먼저 쓴다)**, RED → GREEN → REFACTOR. 계약 예: 멱등성, 경계값, 워크스페이스/테넌트 격리, 대소문자 우회 차단, 이중 처리 방지, 금액/포맷 계산(formatPhone·validation류). AI 시대에도 이 영역은 TDD가 유효 — 계약이 명확해 테스트가 안 흔들린다.
- **UI·화면·플로우 → TDD 강제 X.** 시안(Figma) 픽셀 맞추기가 본질인 작업은 test-first가 오히려 방해다. 진짜 검증은 **시각 검증**(디자인 대조·스크린샷·`/visual-verify`)과 **E2E 스모크 1~2개**. 유닛 테스트로 마크업을 고정하면 유지비 > 이득.
- **API/CRUD → 통합 테스트 위주.** 프레임워크가 보장하는 껍데기는 유닛으로 잘게 쪼개지 말고, 복잡한 비즈니스 로직만 유닛. 핵심 플로우 1개의 통합 테스트가 유닛 10개보다 낫다.
- **AI 시대 관점**: AI가 구현을 빨리 뽑으므로 "테스트로 설계를 유도"하는 TDD의 원래 이점은 약해지고, 그 역할은 **SPEC/DESIGN 문서**가 대신한다. 대신 **AI가 만든 코드를 믿을 근거**로서 테스트 가치는 커진다 → 로직 외 영역은 *test-first*보다 **"반드시 남는 테스트/검증으로 사후 고정"** 을 지킨다.
- 구현부터 하고 임시 스크립트로 확인한 뒤 지우는 것 ❌ — 검증이 저장소에 **남는 테스트(또는 재현 가능한 검증 절차)** 로 고정돼야 회귀를 막는다.
- **테스트 러너는 필수가 아니다 — 단계적으로.** 로직 테스트가 필요한데 러너가 없으면: ① 먼저 **Node 내장 `node:test` + `node:assert`(무설치, Node 18+)** 로 커버 가능한지 본다 (`node --test`, TS는 tsx/트랜스파일). ② watch·mocking·커버리지 등 편의가 실제로 필요할 때만 vitest 도입을 **묻는다**(새 의존성 🟡). 임시/소규모엔 내장으로 충분, 본격 프로젝트엔 vitest. 어느 쪽이든 **테스트 없이 조용히 넘어가지 말 것** — 최소 내장 러너로라도 남긴다.
- "기존 구조 존중"이 **테스트 부재까지 존중하라는 뜻은 아니다** — 리스크 있는 신규 기능(결제·인증·수신거부 등)은 첫 테스트를 심을 근거가 된다.
- **불변식이 함수보다 넓은 범위를 선언하면 테스트도 그 범위의 바깥 관측점에서 단언한다.** "출력 경로 전체"·"어떤 입력에도"처럼 함수 하나보다 넓은 것을 주장하면서 정작 그 함수를 직접 호출하면 **방벽의 범위 오류는 원리적으로 안 보인다** — 방벽이 안 걸린 경로는 테스트도 안 지나기 때문이다. 프로세스 stdout/stderr·HTTP 응답·파일 내용처럼 **관측 가능한 가장 바깥**에서 단언하라(`spawnSync` 등). 판별법: **방벽을 뮤테이션으로 되돌렸을 때 빨개지는 테스트가 하나도 없으면 그 테스트는 범위를 과장하고 있다.** 바깥으로 못 올리겠으면 **이름에서 '전체'를 빼서 실제 범위에 맞춘다.**
- **테스트가 코드의 형태를 관찰하면 그 단언은 초록인 채로 죽는다.** 소스 문자열 검색 · `Function.length` · 같은 식 두 번 비교(`assert.deepEqual(f(x), f(x))`)가 그 형태다 — 한 사이클에서 셋 다 났고, 매번 "동작으로 단언하라"로 고쳤는데 **다음 층에서 또 형태로 회귀했다**(D24). **검증 대상을 실행해 결과로 단언하라.** 특히 **자기 소스 파일을 읽는 테스트는 금지** — 찾는 리터럴이 그 테스트 본문에 있으면 영구히 참이다. 문서 문자열 존재처럼 형태 관찰이 불가피하면 **이름에 그렇게 밝히고 동작 단언과 섞지 마라.**
- **테스트 이름에서 `·` 양옆을 공백으로 띄우지 마라.** 그 줄은 evidence 인용으로 쓸 수 없다(§검증 무결성의 인용 대조 규칙). 쉼표·슬래시로 바꾸거나 `"·"`처럼 붙여 쓴다.
- **테스트가 입력을 직접 조립하면 그 입력을 만드는 층은 검증되지 않는다.** 관측점을 바깥으로 올려도(위 규칙) 입력을 테스트가 만들면 **입력 생성 층은 여전히 무검증**이다 — 실측: 프로세스 경계에서 도는 265개 테스트가 세 사이클 동안 초록인 채, 문서에 적힌 호출 문자열이 틀린 것을 못 봤다(테스트가 그 경로를 스스로 조립했다). 계약을 쓸 때 **"이 입력을 실사용에서는 누가 만드나"**를 묻고, 그 자리가 문서·설정·사용자 입력이면 **거기서 읽어와서** 넣는다. 못 읽어오면 그 층이 무검증이라는 것을 주석에 남긴다.
- 강하게 진행하려면 `/tdd`(또는 tdd-driver) 호출 — 단 대상이 로직일 때. UI엔 `/visual-verify`.

## 기술 스택 기본

- 패키지 매니저: **pnpm** (기존 npm/yarn 프로젝트는 유지)
- Node: **20+**, TypeScript: **strict**

## 강제 & 배포

- 이 규칙 중 **네이밍 · no-any · 에러 미swallow · 200줄 · `.tsx` 로직**은 **ESLint 룰셋(`templates/eslint.config.mjs`)으로 lint 강제**, **CI(`templates/ci.yml`)로 PR 게이트**한다. `/kit init`으로 설치.
  - **점진 채택**: 기본은 스타일 규칙 `warn`(빈 catch만 `error`) → CI는 error만 fail이라 **기존 레포는 안 깨진다**. 신규/성숙 프로젝트는 `warn`을 `error`로 올린다.
  - lint가 실제로 막는 `.tsx` 로직은 **사이드이펙트·페칭**(useEffect/fetch). `useState` 같은 로컬 UI 상태와 boolean 접두는 노이즈/설정부담 때문에 lint 기본에서 제외 — 이건 `convention-check` 스킬이 점검한다.
- **Setup/build/test 명령어는 레포마다 다르므로 각 레포 `AGENTS.md`에 적는다** (이 문서에 두지 않음). 추측 금지 — copy-paste 가능한 실제 명령만.
- **모노레포는 패키지별 `AGENTS.md`를 배치**한다. 에이전트는 가장 가까운 파일을 우선 적용하므로, 루트엔 공통·패키지엔 특수 규칙을 둔다.
- 위험 명령·새 의존성·보호 파일 편집은 **가드 훅이 하드 차단**하며, 차단 이벤트는 `.devkit/audit.jsonl`에 기록된다(`/kit audit`로 조회).

## 보안

- ❌ **시크릿 하드코딩 금지** — API 키·토큰·비밀번호는 `.env`(미커밋) 또는 시크릿 매니저로. `secret-guard` 훅이 명백한 키(private key·AWS·GitHub·Stripe 등)를 편집 시 차단하고, 의심 패턴(JWT·generic)은 관측한다.
- 🔑 **시크릿 출력 마스킹** — 시크릿을 읽고 참조하는 건 자유(`.env` 읽기·코드에서 사용 OK). **문제는 채팅 출력뿐**: AI가 시크릿 값을 채팅에 다시 쓸(복창할) 땐 앞뒤 몇 글자만 남기고 가운데를 `***`로 마스킹한다 (예: `R2_SECRET_ACCESS_KEY=3e89***…***cb32`). 전체 값을 평문으로 재출력 금지.
- **보호 파일**(.env·lockfile·.git·node_modules)은 Write/Edit뿐 아니라 **Bash 리다이렉트(`> .env`)도 차단**된다.
- **pre-commit**(`/kit init`)으로 Claude 세션 밖에서 사람이 직접 커밋해도 시크릿·lint가 걸린다. CI(`ci.yml`)는 시크릿 스캔·`pnpm audit`을 push 시점에 재확인.
- ⚠️ `.devkit/audit.jsonl`은 **로컬 관측용**이라 위변조 가능하다. 규정 준수/거버넌스 근거로 쓰려면 CI나 원격으로 수집해 append-only로 보관할 것.
- 훅/스크립트는 설치자 머신에서 실행되므로 공급망 위험이 있다. 신뢰된 커밋에서 설치 후 `node scripts/verify-integrity.mjs`로 변조를 조기 확인한다(서명은 아니므로 완전 방어는 아님).

## 커밋 메시지

**Conventional Commits**: `<type>(<scope>): <subject>`

- type: feat | fix | docs | style | refactor | perf | test | chore | ci | build | revert
- subject: 한국어 OK, 50자 이내, 마침표 X
- ❌ `Co-Authored-By` 트레일러 금지.
