---
name: iterate
description: Gap이 목표 Match Rate(기본 90%)에 도달할 때까지 자동으로 보완→재분석을 반복. gap-detector로 갭을 찾고 tdd-driver/feature-builder로 ❌·⚠️를 메운 뒤 다시 분석. 최대 5회, 안전장치 포함.
argument-hint: "[목표% (기본 90)]"
user-invocable: true
allowed-tools:
  - Read
  - Edit
  - Write
  - Bash
  - Grep
  - Glob
  - Task
---

# /iterate

Gap 분석 → 보완 → 재분석을 **자동으로 반복**해 Match Rate를 목표(인자 없으면 90%)까지 끌어올린다.

## 루프 (최대 5회)

1. **gap-detector** Task로 SPEC/DESIGN 대비 현재 구현 분석 → Match Rate + ❌/⚠️ 목록.
2. **종료 조건 검사** — 아래 중 하나면 멈춘다:
   - Match Rate ≥ 목표 → 성공.
   - 5회 소진 → 남은 갭 명시하고 사람에게.
   - **같은 갭이 2회 연속 안 줄어듦** → 자동으로 못 메우는 것. 멈추고 사람에게(수동 개입 요청).
3. ❌·⚠️ 항목을 보완: **계약/로직이면 tdd-driver(테스트 먼저), UI/조립이면 feature-builder**를 Task로.
4. 1로 돌아가 재분석.

## 회차 기록

각 회차마다 `회차 N — Match Rate X% → Y% (보완: …)`를 남긴다. 종료 시 추이 요약.

사이클이 진행 중이면(`.devkit/pdca-state.json` 존재) **회차마다 `matchRates`에 점수를 append**한다. `/gap`만 기록하면 iterate 회차가 빠져 REPORT의 추이가 끊긴다. 사이클 폴더의 `GAP.md`도 회차를 누적해 갱신한다.

## 안전장치 (필수)

- ❌ 무한 루프 금지 — max 5회 하드 상한.
- ❌ 진전 없는 반복 금지 — Match Rate가 2회 연속 정체면 중단.
- ❌ 목표 채우려 **테스트/설계를 조작하지 말 것** — 구현으로 메운다. 가짜 통과는 금지.
- 소진 후에도 목표 미달이면 **정직하게** 남은 갭과 이유를 보고(숨기지 않음).
