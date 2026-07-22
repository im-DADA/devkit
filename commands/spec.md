---
name: spec
description: 구현 전에 엣지케이스·트레이드오프를 인터뷰해서 자체완결 SPEC.md 작성. 건드릴 파일·범위 밖·E2E 검증 단계 명시. 그다음 /tdd 또는 feature-builder로 실행.
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

코딩 전에 요구사항을 확정한다. "구현을 지켜보는 것보다 스펙을 정밀하게 만드는 게 더 이득."

1. 인자(`$ARGUMENTS`)가 비면 무엇을 만들지 한 줄 물어보고 대기.
2. 기존 코드 탐색 (Glob/Grep/Read) — 관련 파일·패턴·제약 파악.
3. **모호한 지점을 AskUserQuestion으로 2~4개** 질문: 엣지케이스, 트레이드오프, 범위 경계, 데이터 형태.
4. `SPEC.md` 작성 (프로젝트 루트 또는 `docs/`):
   - **목표** — 한 문단
   - **건드릴 파일** — 구체 경로 나열
   - **데이터/타입** — 입출력 형태
   - **동작(behavior) 목록** — 순서대로, 테스트 가능한 단위
   - **범위 밖** — 이번에 안 하는 것 (스코프 크립 방지)
   - **E2E 검증 단계** — 완성됐는지 확인하는 실제 방법
   - **완료 기준(DoD)**
5. "이 SPEC로 `/tdd` 또는 feature-builder에 넘기면 됨. **깨끗한 새 세션 권장.**" 안내.

과하게 크게 잡지 말 것 — 지금 필요한 범위만 (YAGNI).
