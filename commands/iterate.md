---
name: iterate
description: behaviors.json의 unproven(증거 없는 통과 주장)이 0이 될 때까지 자동으로 보완→재분석을 반복. gap-detector로 갭을 찾고 tdd-driver/feature-builder로 메운 뒤 재분석. 최대 5회, 소진 시 Breaker(parked/BLOCKED) 판결.
argument-hint: ""
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

Gap 분석 → 보완 → 재분석을 **자동으로 반복**해 `behaviors.json`의 unproven(증거 없는 통과 주장)을 0으로 만든다. Match Rate는 참고 신호일 뿐 목표가 아니다.

## 루프 (최대 5회)

0. **회차 시작 SHA 기록** — `git rev-parse HEAD`로 BASE를 잡아둔다. 회차 끝에서 테스트 조작 검사에 쓴다.
1. **gap-detector** Task로 PLAN/DESIGN 대비 현재 구현 분석 → 판정 + ❌/⚠️ 목록.
2. **종료 조건 검사** — 아래 중 하나면 멈추고 **Breaker**로 넘어간다:
   - **`behaviors.json`의 unproven이 0** → 성공. 종료.
   - 5회 소진 → Breaker.
   - **같은 갭이 2회 연속 안 줄어듦** → Breaker (자동으로 못 메움).
3. ❌·⚠️ 항목을 보완: **계약/로직이면 tdd-driver(테스트 먼저), UI/조립이면 feature-builder**를 Task로. 갭이 "검증 부재"면 **test-writer**로 남는 테스트를 심고, UI 시안 불일치면 `visual-verify`로 대조한다.
4. **테스트 조작 검사 (필수)** — 회차에서 테스트 파일이 바뀌었는지 확인한다:
   ```bash
   git diff --name-only {BASE}..HEAD     # 커밋된 변경
   git status --porcelain                # 미커밋 변경
   ```
   두 목록을 합쳐 `hooks/lib/test-files.js`의 `isTestFile()` 기준으로 거른다.
   **테스트 파일이 바뀌었으면 그 회차의 점수를 무효로 하고 사람에게 보고한다.** 롤백하지는 않는다 — 정당한 테스트 추가일 수도 있으므로 판단은 사람이 한다.

   > 왜: "테스트를 조작하지 마라"는 지시만으로는 상당 비율로 악용된다. 검사가 규칙보다 강하다.
   > 단 **보완 단계에서 테스트를 새로 추가하는 것은 정상**이다(RED→GREEN). 무효 처리의 목적은
   > "기존 테스트를 통과하도록 고쳐 점수를 올리는 것"을 드러내는 데 있다. 보고에는 어떤 테스트가
   > 어떻게 바뀌었는지(추가/수정/삭제)를 함께 적는다.
5. 1로 돌아가 재분석.

## Breaker (종료 후 판결)

루프가 멈추면 **남은 갭을 하나하나 판결**한다. 조용히 넘어가지 않는다.

- **parked** — 지적이 틀렸거나 PLAN이 명시적으로 배제한 범위. → 근거를 `PROGRESS.md`에 기록하고 진행.
- **BLOCKED** — 진짜 갭이고 후속 작업이 이 위에 쌓인다. → 중단하고 **사용자에게 보고**.

> **"조용한 폐기 금지"** — 모든 판결(parked·BLOCKED)은 반드시 PROGRESS.md에 남긴다. 남은 ❌가 무시된 건지 판단된 건지 사용자가 알 수 있어야 한다.

## 회차 기록 (PROGRESS.md)

각 회차마다 `docs/{cycle}/PROGRESS.md`에 한 줄 append한다:
```
- {date} iterate#{N}: unproven X → Y (보완: …)
- {date} iterate#{N} BREAK: {id} parked(근거) / {id} BLOCKED(사용자 보고)
```
`matchRates`는 더 쓰지 않는다(상태 4필드 축소). 추이는 PROGRESS.md가 담고, 확정 판정은 behaviors.json이 담는다.

## 안전장치 (필수)

- ❌ 무한 루프 금지 — max 5회 하드 상한. (문헌상 3~5회에서 개선이 정체하고 이후는 사이클당 2~3% 미만)
- ❌ 진전 없는 반복 금지 — 2회 연속 정체면 중단.
- ❌ 목표 채우려 **테스트/설계를 조작하지 말 것** — 구현으로 메운다. **이 규칙은 4단계 검사로 뒷받침된다**(지시만으로는 지켜지지 않는다).
- ❌ **`passes: true`를 evidence 없이 쓰지 말 것** — `hooks/lib/behaviors.js`가 읽는 시점에 false로 강등하므로 점수에 반영되지 않는다. 실행하고 그 출력을 남겨라.
- 소진 후에도 목표 미달이면 **정직하게** 남은 갭과 이유를 보고(숨기지 않음).
