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

0. **하드 게이트 — behaviors.json 필수.** 사이클 폴더에 `behaviors.json`이 없으면 **여기서 중단**하고 "먼저 `/plan`의 behavior 목록 단계를 완료하라"고 안내한다. behaviors.json이 없으면 대조할 분모가 없어 Gap 자체가 무의미하다. (같은 판정을 `hooks/pdca-gate.js` 훅이 **강제한다** — `GAP.md` 쓰기 자체가 거부되므로 이 안내를 무시하고 진행할 수 없다.)
1. 사이클 폴더 확인 — `.devkit/pdca-state.json`의 `cycleId`(없으면 `docs/{YYYY-MM-DD}-{slug}/` 중 진행 중인 것). 근거 문서는 `docs/{cycle}/PLAN.md`·`DESIGN.md`(인자로 경로가 주어지면 그것), `SPEC.md`는 있으면 참고. 근거가 약하면 사용자에게 알린다. 규약 상세는 RULES.md "PDCA 사이클".
2. 사이클 폴더에 `behaviors.json`이 있으면 그것이 **대조의 분모**다. 항목을 사후에 늘리거나 줄이지 않는다.
3. **gap-detector 에이전트**를 Task로 띄워 대조 위임. 에이전트는 **테스트를 실제로 실행**해야 하며, 실행 없이 ✅를 준 항목이 있으면 그 판정을 신뢰하지 않는다.
   테스트 실행은 **커버리지를 함께 수집하는 형태**로 한다(1회 실행으로 화면 출력과 lcov를 둘 다 얻는다):
   ```
   node --test --experimental-test-coverage \
     --test-reporter=spec --test-reporter-destination=stdout \
     --test-reporter=lcov --test-reporter-destination=.devkit/lcov.info \
     test/*.test.mjs
   ```
   프로젝트의 러너가 다르면 **그 러너의 lcov를 `.devkit/lcov.info`로 떨군다.** 안 떨구면 커버리지 층은 안 돈다 — 이제 그 사실이 보고 헤더에 나온다("커버리지가 반영되지 않았다").

   | 러너 | `.devkit/lcov.info`를 어떻게 만드나 |
   |---|---|
   | **node:test** | `node --test --experimental-test-coverage --test-reporter=lcov --test-reporter-destination=.devkit/lcov.info test/*.test.mjs` — 위 명령 한 번으로 같이 나온다 |
   | **vitest** | `@vitest/coverage-v8`이 필요하다. lcov 리포터로 뽑아 `.devkit/lcov.info`에 둔다. **플래그 미실측** |
   | **pytest** | `pytest-cov`가 필요하다. lcov 리포터로 뽑아 `.devkit/lcov.info`에 둔다. **플래그 미실측** |
   | **go test** | `-coverprofile`은 lcov 포맷이 아니다 — 변환 도구를 거쳐 `.devkit/lcov.info`에 둔다. **도구·명령 미실측** |
   | **cargo** | `cargo-llvm-cov`가 필요하다. lcov로 뽑아 `.devkit/lcov.info`에 둔다. **플래그 미실측** |

   ⚠ **미실측** 표시는 "이 조합을 devkit이 직접 돌려본 적이 없다"는 뜻이다. 정확한 플래그는 그 러너 문서를 확인하고, 확인했으면 이 표를 고쳐라(두 문서 모두 — 드리프트는 테스트가 잡는다).

   ⚠ **검증 명령에 `| head`·`| tail`·`| grep`·`> /dev/null`을 붙이지 마라.** 봉인되는 것은 화면에 보이는 출력이라 파이프 한 번이면 **그 실행의 증거가 잘린 채 남는다**(실측: 14,920자 → 78자). 출력이 길어도 그대로 돌리고, 읽을 때만 눈으로 훑는다.
4. **evidence 적합성 검증** — 위 테스트 실행 **다음에** 돌린다(순서가 반대면 이번 실행이 receipt에 안 잡혀 전부 `no-cmd-match`가 된다):
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/verify-evidence.mjs"
   ```
   ⚠ 상대경로(`node scripts/…`)로 부르지 마라 — 이 스크립트는 **플러그인 안**에 있고 프로젝트 안에는 없다. `MODULE_NOT_FOUND`가 나면 세션 중 플러그인이 갱신돼 경로가 바뀐 것이니 `/reload-plugins` 후 다시 시도한다.
   `unresolved`는 **게이트**(>0이면 REPORT.md 쓰기가 훅에 차단된다). 나머지는 **보고**이니 GAP.md에 옮기되 사유별로 조치가 다르다:
   - `no-receipt`·`dead-branch`·`uncovered` — 그것만으로 ❌를 주지 않는다. 특히 **receipt 봉인 이전에 만들어진 evidence는 `no-receipt`가 대량으로 뜨는데 위조가 아니라 기록이 없는 것**이다.
   - `no-cmd-match` — **주장한 명령의 실행 기록이 없다. 위조일 수도, `cmd` 표기가 실제와 다를 수도 있다. 그 명령을 그대로 돌리고 다시 검증하라.** 위 면죄 문구가 여기 적용된다고 읽지 마라.
   - `uncited` — 그 명령은 돌렸는데 출력에 인용이 없다. 진짜 불일치이니 해당 항목을 지목한다.
5. 결과 정리: 항목별 ✅구현 / ⚠️부분 / ❌누락 / ➕설계밖 + **unproven 개수** + **unresolved 개수** + Match Rate(참고) + 다음 액션.
6. 결과를 `docs/{cycle}/GAP.md`로 저장. 재분석이면 회차를 덧붙여 추이가 남게 한다.
7. `.devkit/pdca-state.json` 갱신 — `stage:"gap"`(4필드 유지). `docs/{cycle}/PROGRESS.md`에 `- {date} gap: unproven N` 한 줄 append.
8. **통과 기준은 `unproven == 0`** — 증거(실행 흔적) 없는 통과 주장이 하나도 없어야 한다. 남아 있으면 `/iterate`로 보완 루프를 이어간다. 통과해야 **`/review`(필수 단계)** 로 진행한다 — REVIEW.md가 없으면 그 다음 REPORT.md 쓰기가 훅에 차단된다.

   > **Match Rate는 게이트가 아니다.** 자기 설계를 자기가 채점하면 점수가 인플레된다(실사용 관측: 40여 사이클 중 90% 미만 0건). 숫자가 몇이든 증거 없는 항목이 남아 있으면 통과가 아니고, 반대로 숫자가 낮아도 모든 항목에 증거가 있으면 그건 정직한 미완성이다.

수정은 하지 않는다 — 누락·불일치만 보고하고, 보완할지는 사용자가 결정.
