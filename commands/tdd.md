---
name: tdd
description: TDD 레드-그린-리팩터 루프로 기능 구현. 테스트 먼저 작성 → 실패 확인(RED) → 최소 구현 → 통과 확인(GREEN) → 리팩터를 behavior마다 반복. tdd-driver 에이전트에 위임.
argument-hint: "<구현할 기능 설명>"
user-invocable: true
allowed-tools:
  - Bash
  - Read
  - Task
---

# /tdd

인자로 받은 기능을 **TDD로** 구현한다.

1. 인자(`$ARGUMENTS`)가 비었으면 무엇을 만들지 한 줄 물어보고 대기.
2. **tdd-driver 에이전트**에 위임 — 레드-그린-리팩터 루프 실행:
   - 기능을 behavior 목록으로 쪼갬 → 사용자에게 목록 확인
   - behavior마다: 실패 테스트 작성 → 실행(RED 확인) → 최소 구현 → 실행(GREEN 확인) → 리팩터
   - **매 단계 테스트 실제 실행**, 결과 추측 금지
3. 각 사이클 결과를 요약 보고. behavior 다 끝나면 전체 요약.

원하면 사이클 하나씩 끊어서(사용자 확인 후 다음) 진행할 수도 있음 — 요청 시.
