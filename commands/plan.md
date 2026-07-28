---
name: plan
description: PDCA 사이클 시작 — 탐색 후 docs/{날짜}-{slug}/PLAN.md 작성 → 승인 대기 → (Full이면 DESIGN) → 구현 → Gap. 트랙은 PLAN 첫머리 track 1줄로 정하고 Quick은 DESIGN을 생략한다. 한 줄짜리 변경은 스킵.
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

1. **한 줄 diff로 끝날 일이면** 계획 생략하고 바로 구현하라고 안내 (오버헤드 방지). 사이클을 열 일이면 **트랙을 함께 제안한다** — 탐색(2번) 결과 답해야 할 설계 질문이 없으면 `Quick`(DESIGN 생략, 멈춤점 1곳), 그 외 전부 `Full`. 판정은 **제안**이고 8번 PLAN 승인에 포함된다(별도 멈춤점을 만들지 않는다).
2. 아니면 **읽기전용 탐색** — 관련 코드/의존성 파악. 이 단계에선 **수정 금지**.
3. **사이클 폴더 생성** — `docs/{YYYY-MM-DD}-{slug}/`. slug는 **영문 kebab-case 2~4단어**(경로 호환성). 문서 제목·본문은 사용자 언어를 따른다. 같은 경로가 있으면 `-2` 접미. 규약 상세는 RULES.md "PDCA 사이클".
4. `docs/{cycle}/PLAN.md` 작성. 첫머리는 이 형태 그대로:
   ```md
   # PLAN — {제목}

   - **track**: Full
   - **사이클 ID**: `{폴더명}`
   ```
   그 아래 본문:
   - **목표** (한 문단)
   - **단계별 작업** (순서)
   - **건드릴 파일** + 각 변경 요지
   - **behavior 목록** — 테스트 가능한 단위로. 이게 Gap 분석의 분모가 된다
   - **리스크/불확실성**
   - **검증 방법** (테스트/실행)
   - **범위 밖** (스코프 크립 방지)
   - **모르는 것은 추측하지 말고 `[NEEDS CLARIFICATION: 질문]`으로 남긴다.** 이 마커가 1건이라도 있으면 `track: Quick` 선언은 무효가 되고 Full로 판정된다 — 트랙 판정의 기계 판독 근거다. 해결되면 **그 자리를 답으로 교체**하고(마커를 지운다), 무엇을 어떻게 정했는지는 PROGRESS.md에 한 줄 남긴다.
     ⚠ **이 지시 문장 자체를 PLAN 본문에 복사하지 말 것.** 판정은 코드펜스·인용·산문을 구분하지 않으므로, 마커 문구를 옮겨 적으면 실제 질문이 없어도 Quick이 Full로 강등된다.
5. **`docs/{cycle}/behaviors.json` 생성** — PLAN의 behavior를 **전부 `passes: false`로** 넣는다. 분모를 여기서 고정해야 나중에 항목을 줄여 점수를 올리는 일이 생기지 않는다.
   ```json
   {
     "version": 1,
     "cycleId": "{폴더명}",
     "behaviors": [
       { "id": "B1", "desc": "subtotal 100,000 경계에서 할인 적용", "priority": "P1", "target": null, "passes": false, "evidence": null }
     ]
   }
   ```
   `evidence`는 구현 후 채운다: `{kind:"test"|"visual"|"manual", ref, cmd, output, at}`. **`output`(실행 흔적)이 없으면 통과로 세지 않는다.**
   `target`은 그 behavior가 겨냥하는 **구현 코드** 위치(`파일:라인` 또는 `파일:시작-끝`)다 — `ref`(테스트 파일)와 반대쪽이다. 구현하면서 채우고, 모르면 `null`로 두면 커버리지 판정만 건너뛴다.
6. `.devkit/pdca-state.json` 생성/갱신 — **4필드만**: `{version:1, cycleId:"폴더명", stage:"plan", status:"awaiting-approval"}`. (bkit이 같이 설치돼 있어도 이 형식을 지킬 것 — `cycle`/`phase`/`gates`는 bkit 스키마다.)
7. `docs/{cycle}/PROGRESS.md` 생성 — 첫 줄은 정체성 앵커 `# PROGRESS — docs/{cycle}/`, 그 아래 `- {date} plan: PLAN.md + behaviors.json 작성, 승인 대기`. 이후 각 단계가 여기에 한 줄씩 append한다.
8. 사용자에게 계획 보여주고 **수정 여지 주고 승인 대기**. ⚠ 승인 전에 다음 단계로 넘어가지 말 것.
9. **Design** — `track: Full`이면 승인 후 architect 에이전트로 `docs/{cycle}/DESIGN.md` 작성 → 보여주고 다시 승인 대기. 상태 `stage:"design"`.
   `track: Quick`이면 **이 단계를 통째로 건너뛰고 10번으로 간다.** PLAN 첫머리를 이렇게 적은 경우다:
   ```md
   - **track**: Quick
   ```
   DESIGN.md가 없는 것이 정상이고, `/gap`·gap-detector는 있는 것만 읽는다.
   - **승격은 단방향이다.** 구현 중 설계 결정이 드러나면 언제든 **Quick → Full**로 올린다(track 줄을 고치고 DESIGN을 쓴다). 올린 사실은 PROGRESS.md에 한 줄. **PLAN 승인 후 Full → Quick 강등은 금지** — 설계가 어려워지자 트랙을 낮춰 회피하는 경로가 된다. 트랙은 PLAN 승인과 함께 확정되므로 **승인 전 정정은 강등이 아니다**(사유를 PROGRESS.md에).
   - ⚠ **Quick으로 갈 거면 PLAN에서 다 정해라.** "이건 DESIGN에서 정한다"고 남기면 **아무도 안 정하고 기본값으로 굳는다** — 못 정하겠으면 그게 Full이라는 신호다.
   - ⚠ Quick이어도 `behaviors.json` · `/gap`(unproven==0) · `/review` · REPORT.md는 **전부 그대로 필수**다. 훅 게이트는 트랙을 읽지 않는다.
10. 승인 후 **구현(Do)** — Full은 DESIGN 승인, Quick은 PLAN 승인이 그 승인이다. 상태 `stage:"do"`, `status:"in-progress"`. behavior가 통과할 때마다 `behaviors.json`의 `passes`·`evidence`를 갱신한다.
11. 구현 완료되면 **`/gap` 필수** — PLAN·DESIGN 대비 대조. **통과 기준은 `unproven == 0`**(증거 없는 통과 주장이 없음)이지 Match Rate 숫자가 아니다. 미달이면 `/iterate` 보완 루프.
