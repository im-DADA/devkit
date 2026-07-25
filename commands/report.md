---
name: report
description: 완료 리포트 생성 — 사이클 산출물(PLAN/DESIGN/구현/GAP/Review/테스트)을 종합해 docs/{cycle}/REPORT.md 작성 후 아카이빙. report-writer 에이전트에 위임. 커밋은 하지 않음.
argument-hint: "[기능명]"
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash
  - Grep
  - Glob
  - Task
---

# /report

한 사이클을 마무리하며 완료 리포트를 만들고 사이클 폴더를 아카이빙한다. 규약 상세는 RULES.md "PDCA 사이클".

1. 사이클 폴더 확인 — `.devkit/pdca-state.json`의 `cycleId` → `docs/{cycle}/`.
2. **하드 게이트** — `docs/{cycle}/`에 `behaviors.json`·`GAP.md`·`REVIEW.md` 중 하나라도 없으면(빈 파일도 없는 것으로 본다) 없는 것과 만드는 커맨드(`/plan`의 behavior 단계 · `/gap` · `/review`)를 안내하고 **여기서 중단**한다. Gap 통과 조건은 `unproven == 0`(증거 없는 통과 주장이 0건)이다 — Match Rate 숫자가 아니다. (같은 판정을 훅 `hooks/pdca-gate.js`가 REPORT.md 쓰기 시점에 별도로 강제한다.)
3. **report-writer 에이전트**를 Task로 띄워 `docs/{cycle}/PLAN.md`·`DESIGN.md`·`GAP.md`·`REVIEW.md`·`git diff`·테스트를 종합.
4. 에이전트가 반환한 **REPORT.md 본문을 그대로** `docs/{cycle}/REPORT.md`에 Write한다. 요약하거나 재작성하지 않는다(반환 텍스트가 산출물의 정본이다). 구성: 한 일 / 변경 파일 / Match Rate 추이 / 테스트 / 남은 갭 / 배운 것.
   - **REVIEW.md에 🔴가 미해결로 남아 있으면 "남은 갭"에 그대로 적는다.** 리뷰를 무르게 해서 통과시키는 것을 막는다.
5. 사용자에게 보여주고 확인받은 뒤 **아카이빙** — `docs/{cycle}/PROGRESS.md`에 `- {date} report: 아카이빙` append 후, 사이클 폴더(PLAN·DESIGN·behaviors.json·GAP·REVIEW·REPORT·PROGRESS 전부)를 `docs/archive/{YYYY-MM-DD}/{slug}/`로 이동(날짜는 사이클 시작일). 상태를 `stage:"done"`, `status:"done"`으로 갱신 — `complete`가 아니라 `done`이다(4필드 유지).
6. "배운 것"에 규칙화할 만한 게 있으면 `/improve`로 이어가라고 안내.

과장 없이 — 미달·미완은 그대로 기록한다. 커밋은 사용자 요청 시에만.
