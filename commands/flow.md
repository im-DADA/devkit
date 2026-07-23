---
name: flow
description: 기능 하나를 요구사항→설계→구현(TDD)→리뷰까지 한 흐름으로 오케스트레이션. 각 단계는 사이클 폴더 산출물(PLAN.md→DESIGN.md→코드→GAP.md→REPORT.md)을 다음으로 넘기고, 단계 사이에 사용자 확인 게이트를 둔다.
argument-hint: "<만들 기능 한 줄>"
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
  - Bash
  - Task
  - AskUserQuestion
---

# /flow

기능 하나를 **Plan → Design → Build → Review** 순서로 끝까지 몬다. 각 단계 끝에서 산출물을 보여주고 **다음으로 넘어갈지 사용자에게 확인**받는다(게이트). 인자(`$ARGUMENTS`)가 비면 무엇을 만들지 한 줄 물어보고 대기.

산출물은 모두 **사이클 폴더 `docs/{YYYY-MM-DD}-{slug}/`** 아래에 쌓고, 단계가 넘어갈 때마다 `.devkit/pdca-state.json`(`stage`/`status`/`nextAction`)을 갱신한다. 규약 상세는 RULES.md "PDCA 사이클".

## 1) Plan — 요구사항 확정 → `docs/{cycle}/PLAN.md`

- 진행 중인 사이클 폴더가 이미 있으면 `PLAN.md`를 Read해서 재사용(사용자에게 "이거 쓸까요?" 확인). 없으면 사이클 폴더를 새로 만든다.
- 기존 코드 탐색(Glob/Grep) 후, 모호한 지점을 **AskUserQuestion 2~4개**(엣지케이스·범위·데이터 형태)로 확정 → `docs/{cycle}/PLAN.md` 작성(목표·단계별 작업·건드릴 파일·리스크·검증 방법·범위 밖). 요구사항 인터뷰가 더 깊게 필요하면 `/spec`으로 `SPEC.md`를 보조로 둘 수 있다.
- 상태: `stage:"plan"`, `status:"awaiting-approval"`.
- **게이트**: PLAN 요약 보여주고 승인 대기.

## 2) Design — 설계 확정 → `docs/{cycle}/DESIGN.md`

- **architect 에이전트**를 Task로 띄워 `docs/{cycle}/PLAN.md` 기반 설계 → `docs/{cycle}/DESIGN.md`(접근법·트레이드오프·파일 계획·타입·behavior 매핑·**TDD로 고정할 계약**·리스크).
- 상태: `stage:"design"`, `status:"awaiting-approval"`.
- **게이트**: 설계·트레이드오프·열린 질문을 보여주고 승인 대기. 열린 질문 있으면 여기서 해소.

## 3) Build — 구현

- DESIGN의 "TDD로 고정할 계약"이 **있으면 tdd-driver**(테스트 먼저, RED-GREEN-REFACTOR), UI/조립 위주면 **feature-builder**를 Task로 띄운다. 둘 다 필요하면 로직→tdd-driver, 뷰→feature-builder 순.
- 테스트 러너가 없고 계약이 있으면 **멈추고** "테스트 셋업(vitest 등) 추가할까요?"를 먼저 묻는다(새 의존성 승인).
- 상태: `stage:"do"`, `status:"in-progress"`.
- **게이트**: 구현·테스트 결과 요약 보여주고 확인.

## 4) Gap — 설계대로 됐나 (완전성) + 자동 보완 — `docs/{cycle}/GAP.md`

- **필수 단계다.** 스킵하고 Report로 건너뛰지 않는다.
- **gap-detector**로 `docs/{cycle}/PLAN.md`·`DESIGN.md` 대비 구현 대조 → ✅/⚠️/❌ + **Match Rate**. 결과는 `docs/{cycle}/GAP.md`에 저장.
- **90% 미만이면 `/iterate`(자동 보완 루프)**를 돌린다 — 갭을 tdd-driver/feature-builder로 메우고 재분석을 목표 도달까지(최대 5회, 진전 없으면 중단). 사용자가 "수동으로 볼게" 하면 자동 루프 생략.
- 상태: `stage:"gap"`, `matchRates`에 회차별 점수 append.
- **게이트**: 최종 Match Rate·회차 추이·남은 갭 보여주고 확인.

## 5) Review — 코드 품질

- **code-reviewer 에이전트**를 Task로 띄워 변경분 리뷰(🔴 버그 / 🟡 컨벤션 / 🟢 nit, `file:line`).
- 🔴가 있으면 고칠지 물어보고, 반영 후 다시 리뷰.

## 6) Report — 완료 리포트 → `docs/{cycle}/REPORT.md`

- Gap을 통과했는지(`matchRates` 존재) 먼저 확인 — 비어 있으면 4)로 되돌아간다.
- **report-writer 에이전트**로 사이클 종합 → `docs/{cycle}/REPORT.md`(한 일·변경 파일·Match Rate 추이·테스트·남은 갭·배운 것).
- 상태: `stage:"report"`.
- "배운 것"에 규칙화할 게 있으면 `/improve`로 이어가라고 안내.

## 7) 마무리

- 사용자 확인 후 사이클 폴더를 `docs/archive/{YYYY-MM-DD}/{slug}/`로 이동. 상태를 `stage:"done"`, `status:"done"`으로 갱신.
- 산출물(PLAN/DESIGN/GAP/REPORT)과 남은 일 요약. 커밋은 하지 않고 "`/commit` 또는 `/ship`으로 마무리" 안내.

## 원칙

- **게이트를 건너뛰지 않는다** — 각 단계 승인 후 다음. 사용자가 "쭉 진행"이라고 하면 게이트를 줄일 수 있다.
- 각 단계는 **직전 산출물을 근거**로 한다(PLAN 없이 Design 금지, DESIGN 없이 Build 금지, GAP 없이 Report 금지).
- YAGNI — 요구 범위만. 스코프 크립 방지.
