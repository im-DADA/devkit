---
name: review
description: 현재 git diff를 버그·보안·컨벤션 기준으로 리뷰. code-reviewer 에이전트에 위임하고, 사이클이 진행 중이면 결과를 docs/{cycle}/REVIEW.md로 남긴다.
user-invocable: true
allowed-tools:
  - Bash
  - Read
  - Write
  - Task
---

# /review

현재 변경분을 리뷰한다. **GAP과 REPORT 사이의 필수 단계다** — REVIEW.md가 없으면 `/report`가 열리지 않는다.

1. `git status`와 `git diff`(또는 스테이징 됐으면 `git diff --staged`)로 변경 범위 확인.
2. **code-reviewer 에이전트**를 Task로 띄워 리뷰 위임. 인자로 파일 경로가 주어지면 그 파일만.
3. **사이클 활성 여부로 분기한다** — (a) `.devkit/pdca-state.json`에 `cycleId`가 있고 `docs/{cycleId}/`가 실제로 있거나, **또는** (b) 인자·대화 컨텍스트로 진행 중인 사이클 폴더 `docs/{YYYY-MM-DD}-{slug}/`가 특정되면 활성으로 보고 아래 4~5로, **어느 쪽으로도 사이클을 특정할 수 없으면(비활성) 3-b로**.
   - (b)를 두는 이유: REPORT.md 차단은 경로 기반이라 상태 파일과 무관하게 걸린다. `.devkit/`는 gitignore 대상이므로 새 클론·다른 머신에서는 사이클 폴더만 있고 상태 파일이 없는 상태가 정상이다. 생산 조건이 상태 파일에만 걸려 있으면 그때 `/review`가 REVIEW.md를 만들지 않아 `/report`가 영영 열리지 않는다(생산과 차단은 같은 근거를 써야 한다).

   3-b. 반환 본문을 **보고만** 하고 끝낸다. `REVIEW.md`를 만들지 않고 상태 파일도 건드리지 않는다 — `/review`는 사이클 밖에서 쓰는 단독 리뷰 도구이기도 하다.

4. 에이전트가 반환한 **REVIEW.md 본문을 그대로** `docs/{cycle}/REVIEW.md`에 Write한다. 요약하거나 재작성하지 않는다(반환 텍스트가 산출물의 정본이다). 재리뷰면 파일을 덮지 말고 `(2회차)` 섹션을 덧붙여 추이가 남게 한다.
5. `docs/{cycle}/PROGRESS.md`에 `- {date} review: 🔴 N · 🟡 N` 한 줄 append. `.devkit/pdca-state.json`을 `stage:"review"`로 갱신(4필드 유지).
6. 결과를 심각도별(🔴 버그·보안 / 🟡 컨벤션 / 🟢 nit)로 정리해서 보고. 각 항목 `file:line` 포함.

수정은 하지 않는다 — 발견 사항만 보고하고, 고칠지는 사용자가 결정. **🔴가 남은 채로 `/report`로 넘어가면 REPORT의 "남은 갭"에 그대로 적는다**(리뷰를 무르게 해서 통과시키지 않는다).
