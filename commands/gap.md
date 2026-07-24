---
name: gap
description: Gap 분석 — PLAN.md/DESIGN.md 대비 실제 구현 일치도를 검증. gap-detector 에이전트에 위임해 behavior·계약·파일 계획을 대조하고 GAP.md로 남김. 통과 기준은 증거 없는 통과 주장이 0건(unproven==0).
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

0. **하드 게이트 — behaviors.json 필수.** 사이클 폴더에 `behaviors.json`이 없으면 **여기서 중단**하고 "먼저 `/plan`의 behavior 목록 단계를 완료하라"고 안내한다. behaviors.json이 없으면 대조할 분모가 없어 Gap 자체가 무의미하다. (`hooks/lib/pdca-state.js`의 `gatePrerequisite`가 같은 판정을 한다 — 커맨드는 그 결과를 따른다.)
1. 사이클 폴더 확인 — `.devkit/pdca-state.json`의 `cycleId`(없으면 `docs/{YYYY-MM-DD}-{slug}/` 중 진행 중인 것). 근거 문서는 `docs/{cycle}/PLAN.md`·`DESIGN.md`(인자로 경로가 주어지면 그것), `SPEC.md`는 있으면 참고. 근거가 약하면 사용자에게 알린다. 규약 상세는 RULES.md "PDCA 사이클".
2. 사이클 폴더에 `behaviors.json`이 있으면 그것이 **대조의 분모**다. 항목을 사후에 늘리거나 줄이지 않는다.
3. **gap-detector 에이전트**를 Task로 띄워 대조 위임. 에이전트는 **테스트를 실제로 실행**해야 하며, 실행 없이 ✅를 준 항목이 있으면 그 판정을 신뢰하지 않는다.
4. 결과 정리: 항목별 ✅구현 / ⚠️부분 / ❌누락 / ➕설계밖 + **unproven 개수** + Match Rate(참고) + 다음 액션.
5. 결과를 `docs/{cycle}/GAP.md`로 저장. 재분석이면 회차를 덧붙여 추이가 남게 한다.
6. `.devkit/pdca-state.json` 갱신 — `stage:"gap"`(4필드 유지). `docs/{cycle}/PROGRESS.md`에 `- {date} gap: unproven N` 한 줄 append.
7. **통과 기준은 `unproven == 0`** — 증거(실행 흔적) 없는 통과 주장이 하나도 없어야 한다. 남아 있으면 `/iterate`로 보완 루프를 이어간다. 통과해야 `/report`로 진행.

   > **Match Rate는 게이트가 아니다.** 자기 설계를 자기가 채점하면 점수가 인플레된다(실사용 관측: 40여 사이클 중 90% 미만 0건). 숫자가 몇이든 증거 없는 항목이 남아 있으면 통과가 아니고, 반대로 숫자가 낮아도 모든 항목에 증거가 있으면 그건 정직한 미완성이다.

수정은 하지 않는다 — 누락·불일치만 보고하고, 보완할지는 사용자가 결정.
