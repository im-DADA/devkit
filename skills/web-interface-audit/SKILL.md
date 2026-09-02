---
name: web-interface-audit
description: UI 코드를 Vercel Web Interface Guidelines(규칙 100+개)로 감사한다 — 접근성·포커스·폼·애니메이션·타이포·i18n·터치 타깃·안티패턴을 file:line으로 지적한다. 사용자가 "UI 리뷰해줘", "접근성 봐줘", "이 화면 문제 없나", "웹 표준 맞나", "UX 점검"이라고 하거나, 화면을 만든 뒤 커밋·PR 전에 사용. 미감이 아니라 **지킬 수 있는 규칙**만 본다.
argument-hint: "[파일 또는 glob 패턴, 없으면 변경분]"
user-invocable: true
allowed-tools:
  - WebFetch
  - Read
  - Grep
  - Glob
  - Bash
---

# /web-interface-audit

UI 코드를 **Vercel Web Interface Guidelines**로 감사한다.

출처: <https://github.com/vercel-labs/web-interface-guidelines> (MIT).
규칙 본문은 이 저장소에 **복사해 두지 않는다** — 원격에서 매번 새로 받는다. 규칙이 갱신되면
그대로 따라오고, 오래된 사본이 정본 행세를 하는 일이 없다.

## 1. 규칙을 받는다

```
https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
```

WebFetch로 받는다. 약 190줄 · 규칙 100여 개이고 카테고리는 다음과 같다:

```
Accessibility · Focus States · Forms · Animation · Typography
Content Handling · Images · Performance · Navigation & State
Touch & Interaction · Safe Areas & Layout · Dark Mode & Theming
Locale & i18n · Hydration Safety · Hover States · Content & Copy
Anti-patterns
```

⚠ **받지 못하면 조용히 넘어가지 마라.** 네트워크 차단·URL 변경으로 실패할 수 있다.
그때는 "규칙을 받지 못해 감사하지 않았다"고 **명시하고 멈춘다.** 기억나는 규칙으로
대충 보는 것이 제일 나쁘다 — 사용자는 감사받은 줄 안다.

## 2. 대상을 정한다

- 인자가 있으면 그 파일/패턴.
- 없으면 **이번 변경분**을 본다: `git diff --name-only HEAD` 중 `.tsx`·`.jsx`·`.vue`·`.svelte`·`.html`.
- 변경분이 없으면 어느 파일을 볼지 묻는다. 레포 전체를 훑지 마라 — 남의 코드까지 지적하면
  그 보고는 통째로 무시된다(devkit이 검증 보고를 차분으로 좁힌 것과 같은 이유).

## 3. 지적한다

받은 규칙 문서가 지정하는 출력 형식(`file:line`)을 따른다. 형식을 새로 만들지 마라.

- **규칙에 있는 것만 지적한다.** "이게 더 예뻐 보인다"는 이 스킬의 일이 아니다.
- 각 지적에 **어느 규칙인지** 밝힌다. 근거 없는 지적은 반박할 수 없어서 무시된다.
- 고칠 수 없는 것(외부 라이브러리 내부 등)은 지적하지 말고 넘어간다.

## 다른 층과의 관계 — 겹치지 않는다

| | 보는 것 |
|---|---|
| **이 스킬** | 지킬 수 있는 **보편 규칙** — 접근성·성능·i18n·안티패턴. 도메인 무관 |
| `frontend-design`(Anthropic 공식) | **미감·독창성** — 템플릿 같지 않게 |
| `DESIGN.md` + `/design-md` | **이 프로젝트의 스타일 결정** — 색·타이포·Don't |
| `convention-check` | **코드 구조** — feature 폴더·`.tsx` 로직 분리·네이밍 |

넷은 서로 다른 층이라 같이 쓴다. 이 스킬이 "가운데 정렬이 촌스럽다"고 하지 않고,
`DESIGN.md`가 "`aria-label`이 없다"고 하지 않는다.

## 안 하는 것

- ❌ 규칙을 이 저장소에 복사해 두지 않는다(스냅샷이 정본을 이긴다).
- ❌ 지적을 대신 고쳐주지 않는다 — 무엇을 고칠지는 사람이 정한다. 요청하면 그때 고친다.
- ❌ 미감 판단을 섞지 않는다.
