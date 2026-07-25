# 팀 개발 규칙 (devkit)

이 플러그인을 설치한 모두에게 적용되는 공통 개발 원칙. 프로젝트별 특수 규칙은 각 레포의 `CLAUDE.md`가 우선한다.

> **이 문서가 규칙의 단일 소스(source of truth)다.** 세션 시작 리마인드(`hooks/session-start.js`)는 아래 요약 블록을 그대로 읽어 주입한다. 규칙을 바꿀 땐 **이 파일만** 고친다.

<!-- SUMMARY:START -->
## devkit 팀 규칙 리마인드

- 한국어 간결히. 결론부터.
- ❌ 금지: any 타입(→ `unknown`+narrowing), 에러 swallow(빈 catch), console.log 커밋, 추측 답변, 요청 안 한 파일 생성.
- 🟡 확인 필요: 새 의존성 추가, force/reset --hard/브랜치 삭제, 커밋·푸시·PR, 외부 게시.
- 📋 플랜 우선: 파일 3개+·여러 화면/단계 걸리는 기능은 "그냥 해줘"라도 바로 구현 X → 플랜 짜겠다 밝히거나 "플랜부터? 바로 구현?" 한 번 묻는다. 한 줄 수정은 예외.
- 🔄 PDCA 사이클: 기능 작업은 `docs/{날짜}-{slug}/`에 PLAN→DESIGN→(구현)→GAP→REVIEW→REPORT를 남긴다. **멈춤점은 PLAN·DESIGN 승인 2곳**, Gap·Review는 필수(미달 시 /iterate). 완료 후 `docs/archive/`로 이동. slug는 영문, 문서 본문은 사용자 언어.
- ✅ 검증 무결성: `behaviors.json`이 Gap의 분모. **`passes:true`는 evidence(실행 흔적)가 있어야 유효** — 없으면 자동 강등된다. 통과 기준은 `unproven==0`이지 Match Rate 숫자가 아니다. 상세는 RULES "PDCA 사이클".
- 파일 200줄 초과 시 분리. Feature 구조: ui=.tsx(뷰만) / hooks·api·utils·types=.ts.
- 🔒 .tsx엔 로직 금지 — 상태(useState/useEffect)·핸들러·계산·페칭은 무조건 .ts(커스텀 훅/유틸)로 분리.
- 네이밍: 변수/함수 camelCase · 컴포넌트/타입 PascalCase · 훅 use* · 핸들러 handle*/on* · boolean is/has/can* · 상수 UPPER_SNAKE · 파일·폴더 kebab-case(심볼은 PascalCase). 축약어/부정boolean/I·T접두 금지.
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

## 선제 확인 필요

- 🟡 새 라이브러리/의존성 추가 → 먼저 물어볼 것.
- 🟡 `--force`, `reset --hard`, 브랜치 삭제 → 반드시 확인.
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
① 기능 요청 → PLAN.md 작성 → 보여주고 [승인 대기]
② 승인 → DESIGN.md 작성(architect) → 보여주고 [승인 대기]
③ 승인 → 구현(Do)
④ 구현 후 /gap 필수 → 증거 대조 (통과 기준: unproven == 0)
   └ 증거 없는 통과 주장이 남으면 /iterate 루프로 되돌아감
⑤ /review 필수 → REVIEW.md (🔴 버그·보안 / 🟡 컨벤션 / 🟢 nit)
⑥ 통과하면 REPORT.md → 사이클 아카이빙
```

**멈춤점은 ①② 두 곳.** 문서를 보여주고 사용자가 명시적으로 승인하기 전에 다음 단계로 넘어가지 않는다.

### 폴더 규약

```
docs/
  {YYYY-MM-DD}-{slug}/     ← 진행 중인 사이클만 여기
    PLAN.md   DESIGN.md   behaviors.json   PROGRESS.md   GAP.md   REVIEW.md   REPORT.md
  archive/
    {YYYY-MM-DD}/{slug}/   ← 완료 후 이동
```

- **slug**: 기능 설명을 **영문 kebab-case 2~4단어**(`payment-retry`). 최대 40자. 폴더·파일명은 경로 호환성 때문에 영문으로 고정하고, **문서 제목·본문은 사용자 언어를 따른다**(한국어로 대화하면 한국어 문서, 영어면 영어 문서).
- 날짜는 사이클 **시작일**로 고정. 같은 날 충돌 시 `-2`, `-3` 접미.
- 완료(REPORT 승인) 시 폴더를 `docs/archive/{날짜}/{slug}/`로 이동 → `docs/` 최상위엔 진행 중인 것만 남는다.
- **Gap·Review는 필수 단계다.** 스킵하고 REPORT로 건너뛰지 않는다 — `GAP.md`·`REVIEW.md`가 없으면(빈 파일 포함) `pdca-gate` 훅이 REPORT.md 쓰기를 차단한다.
- **한 번 "닫았다"고 기록한 판단이 이후 회차에 뒤집히면, 새 문서에만 적지 말고 원래 기록 자리에 반전 블록을 남긴다.** GAP·DESIGN은 REPORT의 입력물이고 리포트 작성자는 최신 문서만 읽지 않는다 — 뒤집힌 기록을 그대로 두면 완료 보고서가 사실과 다른 성과를 싣는다. 인용한 코드·줄번호가 더 이상 존재하지 않는다는 것까지 적을 것.

### 검증 무결성 (증거 없으면 통과 아님)

사이클 폴더의 `behaviors.json`이 Gap 분석의 **분모**다. `/plan`이 behavior를 전부 `passes:false`로 만들어 분모를 고정한다(사후에 항목을 줄여 점수를 올리는 것을 막는다).

```json
{ "id": "B1", "desc": "…", "priority": "P1", "passes": true,
  "target": "src/discount.ts:42",
  "evidence": { "kind": "test", "ref": "test/x.test.ts:42",
                "cmd": "node --test", "output": "✔ … (2.1ms)", "at": "…" } }
```

- **`passes: true`는 evidence가 있어야 유효하다.** `output`(실행 흔적)이 없으면 읽는 시점에 자동으로 false로 강등된다 — 되돌릴 대상이 없으므로 우기기가 통하지 않는다.
- `kind`는 `test` | `visual` | `manual`. UI처럼 유닛 테스트가 부적절한 것은 `visual`/`manual`로 하되 **확인 절차를 output에 남긴다**.
- **통과 기준은 `unproven == 0`**(증거 없는 통과 주장이 0건). **Match Rate는 참고 신호일 뿐 게이트가 아니다** — 자기 설계를 자기가 채점하면 점수가 인플레된다.
- `ref`는 **검증하는 쪽**(테스트 파일), `target`은 **검증받는 쪽**(구현 코드 위치)이다. `target`은 선택이고 없으면 커버리지 판정을 건너뛴다.

#### evidence 적합성 3층 (L3a — `node scripts/verify-evidence.mjs`)

`unproven==0`은 "증거 없는 통과 주장이 없다"까지만 보장하고 "주장된 통과가 진짜다"를 보장하지 않는다. 그래서 세 가지를 더 본다.

| 판정 | 질문 | 결과 |
|---|---|---|
| `unresolved` | `ref`가 가리키는 파일이 실재하나 | **게이트 — REPORT.md 쓰기가 차단된다** |
| `uncited` | `output`의 인용이 실제 실행 로그(receipt)에 있나 | 보고 |
| `dead-branch`·`uncovered` | `target` 코드가 실행되기는 하나 | 보고 |

- **게이트는 `unresolved` 하나뿐이다.** 나머지는 오탐 여지가 있어 보고만 한다 — 오탐으로 정직한 사이클을 막는 것이 놓치는 것보다 나쁘다.
- `target`은 **분기 조건 라인**을 가리켜야 도달 불가 분기(`dead-branch`)가 잡힌다. 블록 안쪽을 가리키면 `uncovered`만 나온다.
- ⚠ Node는 경로에 `test/` 세그먼트가 있는 파일을 커버리지에서 제외한다. `target`이 `test/` 아래면 항상 `no-data`다.
- **Bash 실행 기록은 `.devkit/receipts.jsonl`에 남는다**(gitignore 대상). 인용 대조의 근거이고, 지우려면 그냥 `rm`, 아예 끄려면 `DEVKIT_RECEIPTS=0`. 봉인이 시작되기 전 사이클을 소급 검사하면 `uncited`가 대량으로 뜨는데 그건 위조가 아니라 기록이 없는 것이다.
  - 🔑 **마스킹은 `secret-patterns.js`의 알려진 키 형식 9종(AWS·GitHub·Slack·Stripe·Google·private key·JWT 등)뿐이다.** 그 외 — `export DB_PASSWORD=…`, `DATABASE_URL=postgres://user:pw@…`, `Authorization: Bearer …` 같은 형태는 **평문으로 남는다**. 명령·출력 전문이 기록된다는 뜻이므로 시크릿을 다루는 명령을 돌릴 땐 `DEVKIT_RECEIPTS=0`을 쓰거나 기록을 지워라.
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

- 파일 200줄 넘으면 분리 검토. 페이지/엔트리는 **조립 전용**, 로직은 훅/서비스로.
- **Feature-based 구조** (엄격):
  - `src/features/{feature}/` → `views/`(.tsx 화면 — 라우트/스텝에 1:1, 조립 전용) · `components/`(.tsx feature 전용 재사용 조각) · `hooks/`(.ts 상태·로직·핸들러) · `api/`(.ts 외부호출) · `data/`(.ts) · `types/`(.ts) · `utils/`(.ts 순수함수).
  - `src/shared/` → 여러 feature가 공유하거나 도메인 무관 범용: `ui/`(Button·Input 등) · `hooks/` · `utils/`.
  - **views vs components**: 화면 전체는 `views/`(`*Screen`/`*View`), 재사용 조각은 `components/`. `pages/`(Next 예약어)·`screens/`(모바일) 대신 `views/`.
  - **shared vs feature**: 특정 feature 전용이면 `features/*/`, 공유·범용이면 `shared/`. 개발 중 공통이 되면 `features/*/` → `shared/`로 승격(두 번째 feature가 쓰는 순간이 신호), 반대면 강등. 애매하면 YAGNI로 feature에 두고 실제 재사용될 때 옮긴다.
- 🔒 **`.tsx`에는 로직 금지.** `.tsx`는 JSX + 훅 호출/props 전달만. 계산·핸들러 구현·데이터 페칭·사이드이펙트는 `.ts`(커스텀 훅/유틸/api)로 분리. (`❌ const handleSave = async () => await fetch(...)` → `✅ const { onSave } = useUserCard(id)`)
- 파일 확장자 규칙: **JSX 있으면 `.tsx`, 없으면 `.ts`.** 커스텀 훅은 JSX가 없으니 항상 `.ts`.
- 기존 프로젝트는 **기존 구조 존중**. 억지 마이그레이션 금지.
- **검증·판정 로직의 두 번째 처방은 조건을 좁히는 쪽으로.** 입력 검증·파서·필터처럼 "이건 유효한가"를 가르는 코드에서 오탐/미탐이 나면 첫 처방은 대개 규칙 추가(예외 하나 더)다. **그게 실패해서 두 번째 처방을 낼 때는 규칙을 더 얹지 말고 인정 조건을 좁혀라** — 자유 텍스트를 완전히 분류하는 일은 케이스가 끝나지 않아서, 예외를 얹으면 다음 케이스에서 또 샌다. 조건을 좁히면 **실패가 한 방향으로만 나도록 형태가 강제**되고 그건 케이스가 늘어도 안 깨진다. 대가는 놓치는 쪽이므로 **무엇을 포기했는지 주석과 문서에 남긴다.**

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
