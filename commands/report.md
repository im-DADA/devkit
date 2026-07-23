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
2. **Gap 필수 확인** — `matchRates`가 비어 있으면 "Gap을 먼저 수행하라(`/gap`)"고 안내하고 **여기서 중단**한다.
3. **report-writer 에이전트**를 Task로 띄워 `docs/{cycle}/PLAN.md`·`DESIGN.md`·`GAP.md`·`git diff`·테스트를 종합.
4. `docs/{cycle}/REPORT.md` 산출: 한 일 / 변경 파일 / Match Rate 추이 / 테스트 / 남은 갭 / 배운 것.
5. 사용자에게 보여주고 확인받은 뒤 **아카이빙** — 사이클 폴더를 `docs/archive/{YYYY-MM-DD}/{slug}/`로 이동(날짜는 사이클 시작일). 상태를 `stage:"done"`, `status:"done"`으로 갱신.
6. "배운 것"에 규칙화할 만한 게 있으면 `/improve`로 이어가라고 안내.

과장 없이 — 미달·미완은 그대로 기록한다. 커밋은 사용자 요청 시에만.
