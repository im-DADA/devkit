// 사용자 CLI 캐시는 읽기 전용이다. 실패는 목록/경고를 생략하고 설정 판정에 영향을 주지 않는다.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { warn } = require('./diag');
const { AGENTS } = require('./config-schema');
const { readModel, modelDriftMessage } = require('./agent-frontmatter');
const { normalizeClaudeCatalog, pickLatest, isStale, modelsAreDefault, catalogDriftMessage } = require('./model-catalog');
const { normalizeCodexCatalog } = require('./model-catalog-codex');
const MAX_CLAUDE_CATALOG_BYTES = 256 * 1024;
const MAX_CLAUDE_CATALOG_FILES = 16;
// ⚠ Claude와 **상한을 공유하지 않는다.** Codex 캐시는 실측 351,987B이고(`model_messages`에
// 긴 지시문 블롭이 들어 있다) 256KB를 공유하면 **항상 `unreadable`** 이 되어 기능이 통째로
// 죽는다. 실측의 약 6배를 둔다.
const MAX_CODEX_CATALOG_BYTES = 2 * 1024 * 1024;
const CODEX_CACHE = 'models_cache.json';

function catalogDir() {
  return path.join(os.homedir(), '.claude', 'cache', 'model-catalog');
}
function codexCatalogPath() {
  return path.join(os.homedir(), '.codex', CODEX_CACHE);
}
function failure(reason, source, detail, cli = 'claude') {
  return { ok: false, cli, reason, source, detail };
}
function report(result) {
  if (!result.ok && result.reason !== 'missing') warn(result.detail);
  return result;
}
function readCandidate(dir, name) {
  const source = path.join(dir, name);
  const fail = (reason, detail) => failure(reason, source, `Claude 모델 카탈로그${detail} — 카탈로그 없이 진행한다`);
  let body;
  try {
    // lstatSync다 — 심링크를 **따라가지 않는다**. 카탈로그를 심링크로 둔 사용자는
    // `unreadable`로 떨어져 폴백하지만, HOME 밖을 가리키는 링크를 훅이 따라 읽는 것보다 낫다.
    const stat = fs.lstatSync(source);
    if (!stat.isFile()) return fail('unreadable', `가 정규 파일이 아니다(${name})`);
    if (stat.size > MAX_CLAUDE_CATALOG_BYTES) return fail('unreadable', `가 너무 크다(${name}: ${stat.size}B, 상한 ${MAX_CLAUDE_CATALOG_BYTES}B)`);
    body = fs.readFileSync(source, 'utf8');
  } catch (error) {
    return fail('unreadable', `를 읽지 못했다(${name}: ${error.code})`);
  }
  let raw;
  try {
    raw = JSON.parse(body);
  } catch {
    // JSON 오류 메시지는 파일 본문을 포함하므로 진단에 싣지 않는다.
    return fail('invalid', `가 JSON 형식이 아니다(${name})`);
  }
  const parsed = normalizeClaudeCatalog(raw);
  if (!parsed) {
    const version = typeof raw?.version === 'number' ? raw.version : typeof raw?.version;
    return fail('invalid', `의 형식을 모른다(${name}: version=${version})`);
  }
  return { name, parsed };
}

/** HOME 기준 읽기 전용. missing은 침묵, 그 외 실패는 본문 없는 stderr 한 줄. throw하지 않는다. */
function readClaudeCatalog() {
  const dir = catalogDir();
  let names;
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return failure('missing', null, 'Claude 모델 카탈로그가 없다');
    return report(failure('unreadable', null, `Claude 모델 카탈로그 디렉터리를 읽지 못했다(${error.code}) — 카탈로그 없이 진행한다`));
  }
  if (!names.length) return failure('missing', null, 'Claude 모델 카탈로그가 없다');
  if (names.length > MAX_CLAUDE_CATALOG_FILES) {
    return report(failure('unreadable', null, `Claude 모델 카탈로그 파일이 너무 많다(${names.length}개, 상한 ${MAX_CLAUDE_CATALOG_FILES}) — 카탈로그 없이 진행한다`));
  }
  const results = names.map((name) => readCandidate(dir, name));
  const latest = pickLatest(results.filter((result) => result.parsed));
  if (!latest) return report(results[0]);
  const source = path.join(dir, latest.name);
  const { models, fetchedAt, staleAt } = latest.parsed;
  if (!models.length) return report(failure('empty', source, `Claude 모델 카탈로그에 모델이 0종이다(${latest.name}) — 카탈로그 없이 진행한다`));
  return { ok: true, cli: 'claude', source, fetchedAt, staleAt, stale: isStale(staleAt, Date.now()), models };
}

/**
 * `~/.codex/models_cache.json` 하나만 읽는다 — 디렉터리 스캔이 아니라 **단일 파일**이라
 * Claude 쪽의 파일 개수 상한 로직이 필요 없다.
 *
 * Claude 리더와 같은 계약: throw하지 않고, `missing`은 침묵하며, 그 외 실패는 **본문 없는**
 * stderr 한 줄이고 설정 판정에 영향을 주지 않는다.
 */
function readCodexCatalog() {
  const source = codexCatalogPath();
  const fail = (reason, detail) => failure(reason, source, `Codex 모델 캐시${detail} — Codex 목록 없이 진행한다`, 'codex');
  let body;
  try {
    // lstatSync다 — 심링크·디렉터리가 여기서 걸린다(B8).
    const stat = fs.lstatSync(source);
    if (!stat.isFile()) return report(fail('unreadable', `가 정규 파일이 아니다(${CODEX_CACHE})`));
    if (stat.size > MAX_CODEX_CATALOG_BYTES) {
      return report(fail('unreadable', `가 너무 크다(${CODEX_CACHE}: ${stat.size}B, 상한 ${MAX_CODEX_CATALOG_BYTES}B)`));
    }
    body = fs.readFileSync(source, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return failure('missing', source, 'Codex 모델 캐시가 없다', 'codex');
    return report(fail('unreadable', `를 읽지 못했다(${CODEX_CACHE}: ${error.code})`));
  }
  let raw;
  try {
    raw = JSON.parse(body);
  } catch {
    // JSON 오류 메시지는 파일 본문을 포함하므로 진단에 싣지 않는다.
    return report(fail('invalid', `가 JSON 형식이 아니다(${CODEX_CACHE})`));
  }
  const parsed = normalizeCodexCatalog(raw);
  if (!parsed) return report(fail('invalid', `의 형식을 모른다(${CODEX_CACHE}: models=${typeof raw?.models})`));
  if (!parsed.models.length) return report(fail('empty', `에 모델이 0종이다(${CODEX_CACHE})`));
  // staleAt·stale은 고정값이다 — 캐시에 만료 시각 필드가 없다(§3.10·R4·O8).
  return { ok: true, cli: 'codex', source, fetchedAt: parsed.fetchedAt, staleAt: null, stale: false, models: parsed.models };
}

/** 읽지 못한 에이전트는 null. hooks만 복사된 플러그인에서도 거짓 드리프트를 내지 않는다. */
function readAgentModels(dir = path.join(__dirname, '..', '..', 'agents')) {
  const current = {};
  for (const name of AGENTS) {
    try {
      current[name] = readModel(fs.readFileSync(path.join(dir, `${name}.md`), 'utf8'));
    } catch {
      current[name] = null;
    }
  }
  return current;
}

/** 기본값이면 agents/카탈로그 IO가 모두 0. 비기본값에만 두 종류 안내를 이어 붙인다. */
function modelNotices(cfg) {
  if (modelsAreDefault(cfg)) return '';
  return modelDriftMessage(cfg, readAgentModels()) + catalogDriftMessage(cfg, readClaudeCatalog());
}
module.exports = { MAX_CLAUDE_CATALOG_BYTES, MAX_CLAUDE_CATALOG_FILES, MAX_CODEX_CATALOG_BYTES,
  catalogDir, codexCatalogPath, readClaudeCatalog, readCodexCatalog, readAgentModels, modelNotices };
