// 카탈로그는 선택지와 경고만 만든다. 설정의 허용/거부 판정과 IO는 이 층 밖이다.
const { DEFAULTS, AGENTS } = require('./config-schema');
const { EFFORTS } = require('./agent-frontmatter');
const CLAUDE_CATALOG_VERSION = 2;
// 설정에 적힌 글자와 **같은 값**을 상태 이름으로 쓴다 — 새 어휘를 만들면 사용자가
// `--check` 출력과 설정 파일을 연결하지 못한다. export하지 않는다(테스트가 import해
// 비교하면 자기참조가 되어 상수를 고치는 것만으로 초록이 유지된다 — D24 ①).
const INHERIT = 'inherit';
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const stringOrNull = (value) => typeof value === 'string' ? value : null;
const modelList = (models) => Array.isArray(models) ? models.filter((m) => isObject(m) && typeof m.id === 'string') : [];

/**
 * effort 선택지를 표시 정보까지 뽑는다. `thinking.type`이 'effort'가 아니면 빈 배열(Haiku 등).
 * `recommended`는 카탈로그가 배지로 표시하는 권장값 — 모델마다 다르다(opus-5-5는 medium, opus-4-7은 xhigh).
 */
function effortOptionsOf(raw) {
  if (!isObject(raw) || raw.thinking?.type !== 'effort' || !Array.isArray(raw.thinking.effort_options)) return [];
  return raw.thinking.effort_options
    .filter((option) => isObject(option) && typeof option.id === 'string')
    .map((option) => ({
      id: option.id,
      label: stringOrNull(option.name),
      recommended: /recommended/i.test(stringOrNull(option.badge?.message) ?? ''),
    }));
}

/** shape 밖은 null, 유효한 빈 models는 빈 목록. IO 없이 JSON 입력을 처리한다. */
function normalizeClaudeCatalog(raw) {
  if (!isObject(raw) || raw.version !== CLAUDE_CATALOG_VERSION) return null;
  const models = raw.catalog?.config?.models;
  if (!Array.isArray(models) || models.some((m) => !isObject(m) || typeof m.id !== 'string')) return null;
  return {
    cli: 'claude', version: CLAUDE_CATALOG_VERSION,
    fetchedAt: Number.isFinite(raw.fetchedAt) ? raw.fetchedAt : null,
    staleAt: Number.isFinite(raw.staleAt) ? raw.staleAt : null,
    models: models.map((m) => {
      const options = effortOptionsOf(m);
      return {
        id: m.id, name: stringOrNull(m.name), family: stringOrNull(m.short_name)?.toLowerCase() ?? null,
        section: stringOrNull(m.section),
        // efforts는 string[]를 유지한다 — 멤버십 판정(effortStatusFor)과 기존 계약이 여기 걸려 있다.
        // 표시용 정보는 effortOptions·recommendedEffort로 따로 싣는다.
        efforts: options.map((option) => option.id),
        effortOptions: options,
        recommendedEffort: options.find((option) => option.recommended)?.id ?? null,
        description: stringOrNull(m.description),
        // CC가 직접 쓰는 비용 경고다. 마법사의 "절약/최대"가 근거로 삼는 유일한 값이라 버리지 않는다.
        notice: stringOrNull(m.notice?.text),
        quickSelect: m.quick_select === true, minVersion: stringOrNull(m.min_claude_code_version), hidden: false,
      };
    }),
  };
}

/** 점 구분 숫자열만 비교한다. prerelease 등 모르는 표기는 null, 누락 세그먼트는 0. */
function compareVersion(a, b) {
  if (![a, b].every((v) => typeof v === 'string' && /^\d+(\.\d+)*$/.test(v))) return null;
  const left = a.split('.').map(BigInt); const right = b.split('.').map(BigInt);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    if ((left[i] ?? 0n) < (right[i] ?? 0n)) return -1;
    if ((left[i] ?? 0n) > (right[i] ?? 0n)) return 1;
  }
  return 0;
}

/** 버전 미상은 필터하지 않는다. minVersion 미상도 제시 대상으로 남긴다. */
function splitByVersion(models, ccVersion) {
  const offered = []; const belowVersion = [];
  for (const model of modelList(models)) {
    (compareVersion(ccVersion, model.minVersion) === -1 ? belowVersion : offered).push(model);
  }
  return { offered, belowVersion };
}

/** hidden은 선택지에서만 제외한다. main의 중복 가족은 그 가족 전부 id로 제시한다. */
function wizardChoices(models) {
  const visible = modelList(models).filter((m) => !m.hidden);
  const primary = []; const pinned = [];
  for (const model of visible) {
    const isMain = model.section === 'main';
    const hasUniqueFamily = typeof model.family === 'string'
      && visible.filter((m) => m.section === 'main' && m.family === model.family).length === 1;
    (isMain ? primary : pinned).push({
      value: isMain && hasUniqueFamily ? model.family : model.id, label: model.name ?? model.id,
      id: model.id, family: model.family ?? null, efforts: Array.isArray(model.efforts) ? model.efforts : [],
      minVersion: model.minVersion ?? null,
      // 이름만 보여주면 사용자가 무엇을 고르는지 모른다(2026-09-30 실사용에서 드러남).
      description: model.description ?? null, notice: model.notice ?? null,
      effortOptions: Array.isArray(model.effortOptions) ? model.effortOptions : [],
      recommendedEffort: model.recommendedEffort ?? null,
    });
  }
  return { primary, pinned };
}

/** id 우선 정확 일치. hidden도 멤버십에는 포함한다. */
function matchModel(value, models) {
  if (typeof value !== 'string' || value === '') return null;
  const list = modelList(models);
  if (list.some((m) => m.id === value)) return 'id';
  return list.some((m) => m.family === value) ? 'family' : null;
}
function isCatalogIdShape(value) {
  return typeof value === 'string' && /^claude-[a-z0-9-]{1,60}$/.test(value);
}
function classifyModel(value, models) {
  // 세션 모델을 따라가는 값은 카탈로그 대조 대상이 아니다. 오타 모델명·Codex 모델과 같은
  // `unjudged` 칸에 뭉개지면 사용자가 "판정 못 한 것"과 "일부러 비운 것"을 구분할 수 없다.
  // ⚠ `matchModel`보다 **먼저** 본다 — 카탈로그에 같은 이름이 생겨도 판정이 흔들리지 않는다.
  if (value === INHERIT) return INHERIT;
  return matchModel(value, models) ?? (isCatalogIdShape(value) ? 'absent' : 'unjudged');
}

/** 정수 effort와 대상 모델 미상은 판정하지 않는다. */
function effortStatusFor(effort, model) {
  if (typeof effort !== 'string' || !model || !Array.isArray(model.efforts)) return 'unjudged';
  if (!model.efforts.length) return 'none';
  return model.efforts.includes(effort) ? 'ok' : 'unsupported';
}

/** AGENTS 순서 8행. 가족의 effort는 main에서 유일한 모델일 때만 대조한다. */
function checkAssignments(cfg, catalog) {
  const models = catalog?.ok === true ? modelList(catalog.models) : [];
  return AGENTS.map((agent) => {
    const assignment = isObject(cfg?.models?.[agent]) ? cfg.models[agent] : DEFAULTS.models[agent];
    const { model, effort } = assignment;
    // 카탈로그가 없어도 `inherit`은 `inherit`이다 — 이 판정은 설정만으로 성립한다.
    const modelStatus = model === INHERIT ? INHERIT
      : catalog?.ok === true ? classifyModel(model, models) : 'unjudged';
    const matches = models.filter((m) => modelStatus === 'id' ? m.id === model
      : modelStatus === 'family' && m.section === 'main' && m.family === model);
    const matched = modelStatus === 'id' ? matches[0] : matches.length === 1 ? matches[0] : null;
    return { agent, model, effort, modelStatus, effortStatus: effortStatusFor(effort, matched),
      matched: matched?.id ?? null, efforts: matched?.efforts ?? null };
  });
}

/** session-start의 기존 직렬화 비교를 유지한다. 직렬화 불가 입력은 기본값이 아니다. */
function modelsAreDefault(cfg) {
  try {
    return JSON.stringify(cfg?.models) === JSON.stringify(DEFAULTS.models);
  } catch {
    return false;
  }
}

/** 기본값/빈 카탈로그/alias는 침묵. 경고는 설정의 없는 id만 포함하며 재적용을 권하지 않는다. */
function catalogDriftMessage(cfg, catalog) {
  if (!isObject(cfg?.models) || modelsAreDefault(cfg) || catalog?.ok !== true) return '';
  const models = modelList(catalog.models);
  if (!models.length) return '';
  const absent = AGENTS.filter((agent) => isCatalogIdShape(cfg.models[agent]?.model)
    && !models.some((m) => m.id === cfg.models[agent].model));
  if (!absent.length) return '';
  return [
    '', '',
    `⚠ 에이전트 모델이 이 머신의 Claude Code 카탈로그에 없다 (${absent.map((agent) => `${agent}: ${cfg.models[agent].model}`).join(' · ')}) — 이 에이전트는 호출 즉시 model_not_found(HTTP 404)로 종료된다.`,
    '  다시 고르기: `/kit setup` (모델 단계가 카탈로그의 현재 목록을 보여준다)  ·  Claude Code가 안내하는 behavesAs/modelOverrides 매핑으로 의도한 값이면 이 경고는 오탐이다.',
  ].join('\n');
}
function fallbackChoices() {
  return { models: [...new Set(Object.values(DEFAULTS.models).map((m) => m.model))], efforts: [...EFFORTS] };
}
function isStale(staleAt, now) {
  return Number.isFinite(staleAt) && Number.isFinite(now) && now > staleAt;
}

/** fetchedAt 최대, 동률이면 name 사전순. 입력 배열은 바꾸지 않는다. */
function pickLatest(items) {
  if (!Array.isArray(items)) return null;
  const timestamp = (item) => Number.isFinite(item.parsed?.fetchedAt) ? item.parsed.fetchedAt : 0;
  return items.filter((item) => isObject(item) && typeof item.name === 'string').sort((a, b) =>
    timestamp(b) - timestamp(a) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))[0] ?? null;
}
module.exports = { CLAUDE_CATALOG_VERSION, normalizeClaudeCatalog, compareVersion, splitByVersion,
  wizardChoices, matchModel, isCatalogIdShape, classifyModel, effortStatusFor, checkAssignments,
  modelsAreDefault, catalogDriftMessage, fallbackChoices, isStale, pickLatest };
