---
name: pr-description
description: 현재 git diff에서 PR 설명(요약·변경사항·테스트 플랜)을 팀 형식으로 생성한다. 사용자가 "PR 설명 써줘", "PR 본문 만들어줘", "PR 올릴 준비", "이거 뭐라고 설명하지"라고 하거나 브랜치 작업을 마무리할 때 사용. 외부에 게시하지 않고 초안만 출력한다.
argument-hint: "[base 브랜치, 기본 main]"
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

# PR Description

현재 브랜치의 변경분으로 PR 설명 초안을 만든다.

## 절차

1. base 브랜치(인자, 기본 `main`) 대비 `git diff <base>...HEAD --stat`과 커밋 로그 확인.
2. 아래 형식으로 채운다.

## 형식

```markdown
## 요약
<무엇을 왜 바꿨는지 1~3줄>

## 변경사항
- <핵심 변경 1>
- <핵심 변경 2>

## 테스트 플랜
- [ ] <검증 방법 1>
- [ ] <검증 방법 2>

## 참고
<관련 이슈/맥락, 없으면 생략>
```

## 규칙

- 사실만. diff에 없는 내용 추측해서 넣지 않음.
- 초안만 출력. **GitHub에 실제로 올리지 않는다** (게시는 사용자 승인 후 별도).
