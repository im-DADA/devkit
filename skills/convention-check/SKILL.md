---
name: convention-check
description: 코드가 팀 컨벤션을 따르는지 점검한다 — feature 구조(components/hooks/api), .tsx 로직 분리, 바퀴 재발명, 훅·핸들러·boolean 네이밍처럼 **린터가 못 잡는 항목**이 중심이다. 커밋·PR 직전이나, 사용자가 "컨벤션 맞아?", "규칙대로 짰나?", "구조 이거 맞아?", "리뷰 전에 한번 봐줘"라고 할 때 사용.
argument-hint: "[파일 또는 디렉토리 경로]"
user-invocable: true
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# Convention Check

대상 코드(인자로 경로, 없으면 `git diff` 변경분)가 팀 규칙을 따르는지 점검한다.

> 규칙 원문의 단일 소스는 플러그인 `RULES.md`다. 아래 체크리스트는 그 규칙의 실행 점검 항목이며, 규칙 자체가 바뀌면 `RULES.md`를 기준으로 삼는다.

## 체크리스트

각 항목을 Grep/Read로 확인하고 위반 위치를 `file:line`으로 보고:

1. **any 사용** — Grep `: any`, `as any`, `<any>` → 발견 시 `unknown` + 타입가드 제안
2. **에러 swallow** — 빈 `catch {}` 또는 `catch (e) {}`에서 재throw/전파 없음 → 위반
3. **console.log 잔존** — Grep `console.log` (테스트/의도적 로거 제외)
4. **파일 200줄 초과** — `wc -l`로 확인 → 분리 검토 대상
5. **feature 구조 이탈** — 신규 코드가 로직(상태·핸들러·페칭)을 `.tsx`에 직접 넣었는지. Next App Router면 **`views/`·`screens/`·`containers/` 층이 새로 생겼는지도 본다** — 화면 조립은 `app/**/page.tsx`가 직접 해야 하고, `page.tsx`가 `<XxxView />` 한 줄만 렌더하면 위반이다(기존 프로젝트가 이미 그 구조면 존중).
   - 함께 볼 것: `"use client"`가 `page.tsx`에 붙었는지 → 붙으면 `metadata`(서버 전용 export)를 못 쓴다. 경계는 폼·토글 조각에 긋는다.
6. **바퀴 재발명** — 새로 만든 유틸/훅과 유사한 기존 것이 있는지 Grep으로 대조
7. **.tsx 로직 혼입** — `.tsx` 파일 Grep `useState(`·`useEffect(`·`useReducer(`·`useMemo(`·`useCallback(`·`fetch(`·`axios` + 멀티라인 이벤트 핸들러 → 발견 시 커스텀 훅(`.ts`)으로 분리 제안. `.tsx`는 JSX+훅 호출만 허용.
8. **확장자** — 로직만 있고 JSX 없는 파일이 `.tsx`면 `.ts`로, JSX 있는데 `.ts`면 `.tsx`로
9. **네이밍 컨벤션** — 컴포넌트/타입 PascalCase, 변수/함수 camelCase, 훅 `use*`, 핸들러 `handle*`/`on*`, boolean `is*`/`has*`/`can*`/`should*`, 상수 UPPER_SNAKE, 파일·폴더 kebab-case(심볼명은 PascalCase 유지, 예 `user-card.tsx` → `UserCard`). 위반 예: 축약어(`btn`/`usr`), 부정 boolean(`isNotReady`), 타입 접두 `I`/`T`(`IUser`). Grep으로 대조 후 위치 보고.
10. **커밋 컨벤션** — (요청 시) 최근 커밋이 Conventional Commits + Co-Authored-By 없는지

## 출력

```
컨벤션 점검 결과
✅ 통과: 3/7
⚠️ 위반:
- any 사용 — src/x.ts:12 → unknown + narrowing
- console.log — src/y.ts:40 → 제거
```

위반 없으면 "전부 통과". 자동 수정하지 않고 보고만 — 고칠지는 사용자 결정.
