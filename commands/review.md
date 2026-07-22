---
name: review
description: 현재 git diff를 버그·보안·컨벤션 기준으로 리뷰. code-reviewer 에이전트에 위임하고 결과를 심각도별로 정리.
user-invocable: true
allowed-tools:
  - Bash
  - Read
  - Task
---

# /review

현재 변경분을 리뷰한다.

1. `git status`와 `git diff`(또는 스테이징 됐으면 `git diff --staged`)로 변경 범위 확인.
2. **code-reviewer 에이전트**를 띄워 리뷰 위임. 인자로 파일 경로가 주어지면 그 파일만.
3. 결과를 심각도별(🔴 버그 / 🟡 컨벤션 / 🟢 nit)로 정리해서 보고. 각 항목 `file:line` 포함.

수정은 하지 않는다 — 발견 사항만 보고하고, 고칠지는 사용자가 결정.
