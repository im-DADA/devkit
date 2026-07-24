---
name: plan
description: PDCA 사이클 시작 — 탐색 후 docs/{날짜}-{slug}/PLAN.md 작성 → 승인 대기 → DESIGN → 구현 → Gap. 한 줄짜리 변경은 스킵.
argument-hint: "<작업 설명>"
user-invocable: true
allowed-tools:
  - Read
  - Glob
  - Grep
  - Write
  - Task
---

# /plan

"바로 코딩하면 엉뚱한 문제를 푼다." 여러 파일 작업은 계획부터.

1. **한 줄 diff로 끝날 일이면** 계획 생략하고 바로 구현하라고 안내 (오버헤드 방지).
2. 아니면 **읽기전용 탐색** — 관련 코드/의존성 파악. 이 단계에선 **수정 금지**.
3. **사이클 폴더 생성** — `docs/{YYYY-MM-DD}-{slug}/`. slug는 **영문 kebab-case 2~4단어**(경로 호환성). 문서 제목·본문은 사용자 언어를 따른다. 같은 경로가 있으면 `-2` 접미. 규약 상세는 RULES.md "PDCA 사이클".
4. `docs/{cycle}/PLAN.md` 작성:
   - **목표** (한 문단)
   - **단계별 작업** (순서)
   - **건드릴 파일** + 각 변경 요지
   - **behavior 목록** — 테스트 가능한 단위로. 이게 Gap 분석의 분모가 된다
   - **리스크/불확실성**
   - **검증 방법** (테스트/실행)
   - **범위 밖** (스코프 크립 방지)
5. **`docs/{cycle}/behaviors.json` 생성** — PLAN의 behavior를 **전부 `passes: false`로** 넣는다. 분모를 여기서 고정해야 나중에 항목을 줄여 점수를 올리는 일이 생기지 않는다.
   ```json
   {
     "version": 1,
     "cycleId": "{폴더명}",
     "behaviors": [
       { "id": "B1", "desc": "subtotal 100,000 경계에서 할인 적용", "priority": "P1", "passes": false, "evidence": null }
     ]
   }
   ```
   `evidence`는 구현 후 채운다: `{kind:"test"|"visual"|"manual", ref, cmd, output, at}`. **`output`(실행 흔적)이 없으면 통과로 세지 않는다.**
6. `.devkit/pdca-state.json` 생성/갱신 — **4필드만**: `{version:1, cycleId:"폴더명", stage:"plan", status:"awaiting-approval"}`. (bkit이 같이 설치돼 있어도 이 형식을 지킬 것 — `cycle`/`phase`/`gates`는 bkit 스키마다.)
7. `docs/{cycle}/PROGRESS.md` 생성 — 첫 줄은 정체성 앵커 `# PROGRESS — docs/{cycle}/`, 그 아래 `- {date} plan: PLAN.md + behaviors.json 작성, 승인 대기`. 이후 각 단계가 여기에 한 줄씩 append한다.
8. 사용자에게 계획 보여주고 **수정 여지 주고 승인 대기**. ⚠ 승인 전에 다음 단계로 넘어가지 말 것.
9. 승인되면 **Design** — architect 에이전트로 `docs/{cycle}/DESIGN.md` 작성 → 보여주고 다시 승인 대기. 상태 `stage:"design"`.
10. Design 승인 후 **구현(Do)**. 상태 `stage:"do"`, `status:"in-progress"`. behavior가 통과할 때마다 `behaviors.json`의 `passes`·`evidence`를 갱신한다.
11. 구현 완료되면 **`/gap` 필수** — PLAN·DESIGN 대비 대조. **통과 기준은 `unproven == 0`**(증거 없는 통과 주장이 없음)이지 Match Rate 숫자가 아니다. 미달이면 `/iterate` 보완 루프.
