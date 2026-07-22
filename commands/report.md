---
name: report
description: 완료 리포트 생성 — 사이클 산출물(SPEC/DESIGN/구현/Gap/Review/테스트)을 종합해 REPORT.md 작성. report-writer 에이전트에 위임. 커밋은 하지 않음.
argument-hint: "[기능명]"
user-invocable: true
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - Task
---

# /report

한 사이클을 마무리하며 완료 리포트를 만든다.

1. **report-writer 에이전트**를 Task로 띄워 `SPEC.md`·`DESIGN.md`·`git diff`·테스트·Gap 결과를 종합.
2. `REPORT.md` 산출: 한 일 / 변경 파일 / Match Rate 추이 / 테스트 / 남은 갭 / 배운 것.
3. "배운 것"에 규칙화할 만한 게 있으면 `/improve`로 이어가라고 안내.

과장 없이 — 미달·미완은 그대로 기록한다. 커밋은 사용자 요청 시에만.
