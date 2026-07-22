---
name: gap
description: Gap 분석 — SPEC.md/DESIGN.md 대비 실제 구현 일치도를 검증. gap-detector 에이전트에 위임해 behavior·계약·파일 계획을 대조하고 Match Rate를 보고. 읽기전용.
argument-hint: "[SPEC/DESIGN 경로]"
user-invocable: true
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - Task
---

# /gap

설계한 대로 구현됐는지 검증한다(완전성/일치 — 코드 품질은 `/review`).

1. `SPEC.md`·`DESIGN.md` 존재 확인(인자로 경로가 주어지면 그것). 둘 다 없으면 대화의 요구/설계를 근거로 삼되, 근거가 약하면 사용자에게 알린다.
2. **gap-detector 에이전트**를 Task로 띄워 대조 위임.
3. 결과 정리: 항목별 ✅구현 / ⚠️부분 / ❌누락 / ➕설계밖 + **Match Rate** + 다음 액션.

수정은 하지 않는다 — 누락·불일치만 보고하고, 보완할지는 사용자가 결정. Match Rate 90% 미만이면 보완 후 재분석을 권한다.
