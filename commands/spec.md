---
name: spec
description: 선택적 보조 — 요구사항 인터뷰가 필요할 때 엣지케이스·트레이드오프를 물어 docs/{cycle}/SPEC.md 작성. 사이클 1단계는 /plan의 PLAN.md다.
argument-hint: "<만들 기능 한 줄>"
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
  - AskUserQuestion
---

# /spec

**선택적 보조 단계다.** 사이클의 1단계 문서는 `/plan`이 만드는 `PLAN.md`이고, 요구사항 인터뷰가 특별히 필요할 때만 SPEC을 덧붙인다. 규약 상세는 RULES.md "PDCA 사이클".

1. 인자(`$ARGUMENTS`)가 비면 무엇을 만들지 한 줄 물어보고 대기.
2. 기존 코드 탐색 (Glob/Grep/Read) — 관련 파일·패턴·제약 파악.
3. **모호한 지점을 AskUserQuestion으로 2~4개** 질문: 엣지케이스, 트레이드오프, 범위 경계, 데이터 형태.
4. `docs/{cycle}/SPEC.md` 작성 (사이클 폴더가 아직 없으면 `/plan`으로 먼저 만든다):
   - **목표** — 한 문단
   - **건드릴 파일** — 구체 경로 나열
   - **데이터/타입** — 입출력 형태
   - **동작(behavior) 목록** — 순서대로, 테스트 가능한 단위
   - **범위 밖** — 이번에 안 하는 것 (스코프 크립 방지)
   - **E2E 검증 단계** — 완성됐는지 확인하는 실제 방법
   - **완료 기준(DoD)**
5. "이 SPEC로 `/tdd` 또는 feature-builder에 넘기면 됨. **깨끗한 새 세션 권장.**" 안내.

과하게 크게 잡지 말 것 — 지금 필요한 범위만 (YAGNI).
