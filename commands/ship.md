---
name: ship
description: 변경분을 출하 준비 — 리뷰 후 Conventional Commit 메시지와 PR 설명 초안 작성. 커밋/푸시 전 반드시 확인받음.
user-invocable: true
allowed-tools:
  - Bash
  - Read
  - Task
---

# /ship

변경분을 커밋/PR 낼 수 있게 준비한다. **실제 커밋·푸시·PR 생성은 사용자 승인 후에만.**

1. `git status` / `git diff`로 변경 확인.
2. code-reviewer 에이전트로 빠른 리뷰 → 🔴 버그 있으면 먼저 알리고 진행 여부 확인.
3. **Conventional Commit 메시지 초안** 작성:
   - `<type>(<scope>): <subject>` — 한국어 subject, 50자 이내, 마침표 X
   - ❌ `Co-Authored-By` 트레일러 붙이지 않음
4. **PR 설명 초안** (pr-description 스킬 형식) 작성.
5. 초안을 보여주고 **"이대로 커밋/푸시할까요?"** 물어본 뒤 대기. 승인 전엔 아무것도 실행하지 않음.
