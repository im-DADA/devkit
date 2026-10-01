// Codex 모델 캐시(`~/.codex/models_cache.json`)를 **Claude와 같은 정규화 shape**으로 옮긴다.
//
// 설계: docs/2026-09-30-wizard-slim-multi-cli/DESIGN.md §4.1·§4.2·§3.9
//
// ⚠ **이 파일은 아무것도 require하지 않는다.** `isObject`·`stringOrNull`·`modelList` 세 줄을
// `model-catalog.js`에서 복제했다. DRY를 어기는 대가로 얻는 것 둘: ① fs 봉인 테스트(CX5)가
// 전이 논증 없이 자명해진다 ② Claude 정규화 모듈이 Codex 경로의 의존이 되지 않는다.
// 복제한 세 줄은 동어반복이라 낡을 여지가 없다.
//
// ⚠ **버전·신선도 게이트가 Claude 쪽과 비대칭이다.** Codex 캐시의 최상위 키는
// `fetched_at`·`etag`·`client_version`·`identity`·`models`뿐이고 — 스키마 버전 필드도,
// 만료 시각 필드도 **찾지 못했다**(2026-09-30 실측). `client_version`은 캐시를 만든 CLI
// 버전이지 캐시 스키마 버전이므로 게이트로 쓰면 CLI가 올라갈 때마다 목록이 통째로 죽는다.
// 그래서 shape 검사만 하고 `version: null`·`staleAt: null`로 고정한다(§3.10·R4·O8).
//
// 어느 함수도 어떤 입력에도 throw하지 않는다.

const CODEX_VISIBLE = 'list';
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const stringOrNull = (value) => typeof value === 'string' ? value : null;
const modelList = (models) => Array.isArray(models) ? models.filter((m) => isObject(m) && typeof m.id === 'string') : [];

/** `supported_reasoning_levels[]` → `effortOptions[]`. 표시명(label)이 캐시에 없어 null이다. */
function effortOptionsOf(raw) {
  if (!isObject(raw) || !Array.isArray(raw.supported_reasoning_levels)) return [];
  return raw.supported_reasoning_levels
    .filter((level) => isObject(level) && typeof level.effort === 'string')
    .map((level) => ({
      // Claude의 effort_options에는 문장 설명이 없다 — `description`은 **Codex 쪽에만 있는
      // 선택 키**이고, `ultra`가 무엇인지 한 줄로 보여줄 수 있는 유일한 출처다(§4.1).
      id: level.effort, label: null, recommended: false, description: stringOrNull(level.description),
    }));
}

/**
 * shape 밖(객체 아님 · `models` 배열 아님 · 항목에 문자열 `slug` 없음) → `null`.
 * 유효한 빈 배열은 `null`이 아니라 `models: []` — **부재와 0종은 다르다.**
 */
function normalizeCodexCatalog(raw) {
  if (!isObject(raw) || !Array.isArray(raw.models)) return null;
  if (raw.models.some((m) => !isObject(m) || typeof m.slug !== 'string')) return null;
  const fetchedAt = Date.parse(stringOrNull(raw.fetched_at) ?? '');
  return {
    cli: 'codex', version: null,
    fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : null,
    staleAt: null,
    models: raw.models.map((m) => {
      const options = effortOptionsOf(m);
      const efforts = options.map((option) => option.id);
      // 마법사가 이 값을 **기본 선택**으로 쓴다 — 목록 밖 값을 기본 포커스로 두면
      // 선택지에 없는 것을 권하는 상태가 된다(§4.2).
      const recommended = stringOrNull(m.default_reasoning_level);
      const recommendedEffort = recommended !== null && efforts.includes(recommended) ? recommended : null;
      return {
        id: m.slug, name: stringOrNull(m.display_name),
        // Codex 캐시에 대응 필드가 없는 축은 만들어 넣지 않는다: 가족 alias·섹션 묶음·비용
        // 경고·최소 버전·빠른 선택 표식이 전부 없다(§4.1).
        family: null, section: null,
        efforts,
        effortOptions: options.map((option) => ({ ...option, recommended: option.id === recommendedEffort })),
        recommendedEffort,
        description: stringOrNull(m.description),
        notice: null, quickSelect: false, minVersion: null,
        hidden: m.visibility !== CODEX_VISIBLE,
      };
    }),
  };
}

/**
 * hidden을 뺀 **단일 목록**. 키 집합은 `wizardChoices`의 Choice와 같다 — 마법사가
 * `clis[cli].choices` 하나로 두 CLI를 다룰 수 있어야 한다(§3.6).
 * `pinned`는 항상 빈 배열이다: Codex에는 `section`·`family`가 없어 "이전 버전" 묶음이
 * 성립하지 않는다(R9). 입력(캐시) 순서를 보존하고 `priority`는 쓰지 않는다(O3 — 정렬 방향 미확인).
 * ⚠ 입력은 **`normalizeCodexCatalog`의 출력**이다. 타입 강제(문자열 아닌 name·description)는
 *   정규화가 이미 했으므로 여기서 다시 막지 않는다 — 계약 밖 값은 그대로 흐른다.
 */
function codexChoices(models) {
  const primary = modelList(models).filter((m) => !m.hidden).map((model) => ({
    value: model.id, label: model.name ?? model.id, id: model.id, family: null,
    efforts: Array.isArray(model.efforts) ? model.efforts : [],
    minVersion: null,
    description: model.description ?? null, notice: null,
    effortOptions: Array.isArray(model.effortOptions) ? model.effortOptions : [],
    recommendedEffort: model.recommendedEffort ?? null,
  }));
  return { primary, pinned: [] };
}

module.exports = { CODEX_VISIBLE, normalizeCodexCatalog, codexChoices };
