---
name: commit
description: 변경분을 스테이징하고 Conventional Commit으로 커밋. 메시지는 diff 기반 자동 생성, Co-Authored-By 없음. 푸시는 하지 않음.
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

# /commit

현재 변경분을 커밋한다. (푸시는 하지 않음)

1. `git status` / `git diff`로 변경 확인.
2. 변경 성격 파악 → **Conventional Commit** 메시지 작성:
   - `<type>(<scope>): <subject>`
   - type: feat | fix | docs | style | refactor | perf | test | chore | ci | build | revert
   - subject: 한국어 OK, 50자 이내, 마침표 X
3. 성격이 뚜렷이 다른 변경이 섞였으면 **나눠서 커밋** 제안.
4. `git add` + `git commit`. 
   - ❌ **`Co-Authored-By` 트레일러 붙이지 않음.**
   - 현재 브랜치가 main/master면 커밋 전에 알리고 확인.
5. 커밋 결과(해시·메시지) 보고. **푸시는 사용자가 별도 요청 시에만.**
