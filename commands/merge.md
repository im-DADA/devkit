---
name: merge
description: 열린 PR을 스쿼시 머지하고 로컬을 정리 — 원격 브랜치 삭제, main 동기화까지. 로컬 브랜치 삭제만 확인받음.
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

# /merge

PR을 **스쿼시 머지**하고 로컬을 그 뒤 상태로 맞춘다. `/ship`이 내보내는 쪽이면 이건 받는 쪽이다.

인자로 PR 번호를 받는다(`/merge 12`). 없으면 열린 PR을 훑어서 정한다.

## 1. 선행 확인 — 여기서 멈출 수 있다

```bash
git status --porcelain
gh pr list --state open
```

- **작업 트리가 더러우면 멈춘다.** 뒤에서 `git checkout main`을 하는데, 커밋 안 된 변경이
  딸려 오거나 체크아웃이 실패한다. 무엇이 남았는지 보여주고 커밋할지 스태시할지 묻는다.
- **열린 PR이 0개면** 그대로 알리고 끝낸다.
- **인자가 없고 열린 PR이 2개 이상이면** 목록을 보여주고 어느 것인지 묻는다.
  하나뿐이면 그것으로 진행한다.
- `gh`가 없거나 인증이 안 됐으면 **원문 에러를 그대로** 보여준다. 번역하지 않는다.

## 2. 무엇을 머지하는지 보여준다

```bash
gh pr view <n> --json title,author,headRefName,baseRefName,additions,deletions,mergeable
gh pr checks <n>
```

제목 · 작성자 · 브랜치 · `+N/-M` · CI 상태를 **한 덩어리로 보고**한다.

⚠ 이건 게이트가 아니라 보고다. CI가 빨간색이어도 멈추지 않는다 — 다만 **빨간 상태를
말없이 넘기지는 않는다.** 실패한 체크가 있으면 그 사실을 결론 줄에 적는다.

diff를 읽고 판단해야 할 것 같으면 `/review`를 먼저 쓰라고 제안한다(자동으로 돌리지 않는다).

## 3. 스쿼시 머지

```bash
gh pr merge <n> --squash --delete-branch
```

- **커밋 메시지는 PR 제목을 그대로 쓴다.** Conventional Commits에 안 맞으면
  `--subject`로 고쳐서 넣는다 — 스쿼시 커밋은 main 히스토리에 영구히 남는다.
- ❌ `Co-Authored-By` 트레일러 금지.
- `--delete-branch`가 **원격** 브랜치를 지운다. 로컬은 안 지워진다(4번).
- 실패하면(충돌·권한·브랜치 보호) 원문 에러를 보여주고 멈춘다. 우회하지 않는다.

## 4. 로컬 정리

```bash
git checkout main && git pull
```

여기까지가 무프롬프트 구간이다. **로컬 브랜치 삭제는 여기서 멈추고 묻는다.**

⚠ 스쿼시 머지 후에는 `git branch -d`가 **반드시 실패한다.** 스쿼시는 새 커밋을 만들어서
git이 원래 브랜치를 조상으로 보지 않기 때문이다. 남는 선택지는 `-D`(강제)뿐인데,
그건 전역 규칙상 확인이 필요한 명령이다. `-d`를 먼저 시도해 실패를 보여주고 `-D`로
넘어가는 연출을 하지 말 것 — 결과를 알면서 실패를 연기하는 것은 근거를 만드는 게 아니다.

남은 로컬 브랜치 이름을 알리고 **"`git branch -D <branch>`로 지울까요?"** 한 번 묻는다.

## 5. 보고

머지된 PR 번호·제목, 새 main 해시, 지운/남은 브랜치를 줄 단위로 적는다.
**하지 못한 것이 있으면 그것도 적는다** — CI 실패를 넘기고 머지했다면 그 사실을 남긴다.

---

## 자동 모드에서 막히면

`gh pr merge`는 되돌리기 어렵고 외부로 나가는 행동이라 **자동 모드 분류기가 막을 수 있다**
(`Permission for this action was denied by the Claude Code auto mode classifier`).
매번 승인하기 싫으면 `~/.claude/settings.json`에 allow 규칙을 둔다 — narrow 규칙은
분류기보다 **먼저** 해석된다.

```json
{ "permissions": { "allow": ["Bash(gh pr merge:*)"] } }
```

반대로 머지 전에 꼭 한 번 확인받고 싶으면 같은 자리에 `"ask"`로 넣는다.
