---
name: gap
description: Gap 분석 — PLAN.md/DESIGN.md 대비 실제 구현 일치도를 검증. gap-detector 에이전트에 위임해 behavior·계약·파일 계획을 대조하고 Match Rate를 GAP.md로 남김.
argument-hint: "[PLAN/DESIGN 경로]"
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash
  - Grep
  - Glob
  - Task
---

# /gap

설계한 대로 구현됐는지 검증한다(완전성/일치 — 코드 품질은 `/review`). **Gap은 사이클의 필수 단계다 — 스킵하고 `/report`로 건너뛰지 않는다.**

1. 사이클 폴더 확인 — `.devkit/pdca-state.json`의 `cycleId`(없으면 `docs/{YYYY-MM-DD}-{slug}/` 중 진행 중인 것). 근거 문서는 `docs/{cycle}/PLAN.md`·`DESIGN.md`(인자로 경로가 주어지면 그것), `SPEC.md`는 있으면 참고. 근거가 약하면 사용자에게 알린다. 규약 상세는 RULES.md "PDCA 사이클".
2. **gap-detector 에이전트**를 Task로 띄워 대조 위임.
3. 결과 정리: 항목별 ✅구현 / ⚠️부분 / ❌누락 / ➕설계밖 + **Match Rate** + 다음 액션.
4. 결과를 `docs/{cycle}/GAP.md`로 저장. 재분석이면 회차를 덧붙여 추이가 남게 한다.
5. `.devkit/pdca-state.json` 갱신 — `stage:"gap"`, `matchRates`에 이번 회차 점수 append, `nextAction`.
6. **Match Rate 90% 미만이면 `/iterate`로 보완 루프**를 이어간다. 통과해야 `/report`로 진행.

수정은 하지 않는다 — 누락·불일치만 보고하고, 보완할지는 사용자가 결정.
