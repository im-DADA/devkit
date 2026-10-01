// 읽기 전용 보고 도구. 목록을 못 얻어도 폴백 JSON을 내고 exit 0을 유지한다.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { readClaudeCatalog, readCodexCatalog } = require('../hooks/lib/model-catalog-io');
const { codexChoices } = require('../hooks/lib/model-catalog-codex');
const { detectClis, offerableClis } = require('../hooks/lib/cli-detect');
const { splitByVersion, wizardChoices, fallbackChoices, checkAssignments, modelsAreDefault } = require('../hooks/lib/model-catalog');
const { loadConfig, configPath } = require('../hooks/lib/config');

const args = process.argv.slice(2);
const mode = args.includes('--check') ? 'check' : 'list';
let ccVersion = null;
for (let i = 0; i < args.length; i += 1) {
  const value = args[i] === '--cc-version' ? args[i + 1]
    : args[i].startsWith('--cc-version=') ? args[i].slice('--cc-version='.length) : null;
  if (value !== null && value !== undefined) ccVersion = value.match(/\d+(\.\d+)+/)?.[0] ?? null;
}
// `--cc-version`과 같은 규약으로 받는다 — 한 파일 안에서 인자 형태가 갈리면 호출자가 헷갈린다.
const force = []; const unknownCli = [];
for (let i = 0; i < args.length; i += 1) {
  const value = args[i] === '--cli' ? args[i + 1]
    : args[i].startsWith('--cli=') ? args[i].slice('--cli='.length) : null;
  if (!value || value.startsWith('--')) continue;
  (['claude', 'codex'].includes(value) ? force : unknownCli).push(value);
}
/** 아직 못 읽은 CLI의 자리. status는 호출자가 덮는다. */
const emptyCli = () => ({ status: 'unreadable', reason: null, source: null, fetchedAt: null, stale: false,
  models: [], belowVersion: [], choices: { primary: [], pinned: [] } });
/** Codex 자리. `belowVersion`을 싣지 않는다 — Codex 캐시에 minVersion 개념이 없어서
 *  빈 배열을 보여주면 마법사가 "버전 미달 모델이 있다"로 오독할 수 있다. */
const emptyCodex = () => { const { belowVersion, ...rest } = emptyCli(); return rest; };
/** epoch ms → ISO. 숫자가 아니면 null (없는 값을 만들어 내지 않는다). */
const iso = (ms) => (Number.isFinite(ms) && Number.isFinite(new Date(ms).getTime()) ? new Date(ms).toISOString() : null);

const out = {
  note: 'devkit · 목록과 대조만 낸다 — 허용/거부 판정은 하지 않는다',
  mode, cli: 'claude', ccVersion,
  claude: emptyCli(),
  // clis.claude는 최상위 claude와 같은 내용이다 — 마법사가 `clis[cli]` 하나로 접근하게
  // 해서 지시문이 CLI별로 갈리지 않게 한다(갈리면 한쪽이 낡는다).
  clis: { claude: emptyCli(), codex: emptyCodex() },
  detected: null, offer: [],
  fallback: fallbackChoices(),
};
try {
  const detected = detectClis();
  out.detected = detected;
  out.offer = offerableClis(detected, { force });

  const codex = readCodexCatalog();
  out.clis.codex.status = codex.ok ? 'ok' : codex.reason;
  out.clis.codex.reason = codex.ok ? null : codex.detail;
  out.clis.codex.source = codex.source;
  if (codex.ok) {
    out.clis.codex.fetchedAt = iso(codex.fetchedAt);
    out.clis.codex.stale = codex.stale;   // 만료 시각 필드가 없어 항상 false다
    out.clis.codex.models = codex.models;
    out.clis.codex.choices = codexChoices(codex.models);
  }

  const catalog = readClaudeCatalog();
  out.claude.status = catalog.ok ? 'ok' : catalog.reason;
  out.claude.reason = catalog.ok ? null : catalog.detail;
  out.claude.source = catalog.source;
  if (catalog.ok) {
    out.claude.fetchedAt = iso(catalog.fetchedAt);
    out.claude.stale = catalog.stale;
    out.claude.models = catalog.models;
    // 버전 미달도 선택지에 **남긴다** — 가족 alias는 CC가 하위 세대로 내려주고(2026-10-01 실측:
    // 2.1.278에서 `--model opus` → Opus 5), id 고정은 고르면 CC가 400으로 막으며 `Run 'claude update'`를
    // 스스로 안내한다. splitByVersion은 **belowVersion 산출(표기·안내용)에만** 쓴다 — offered는 쓰지 않는다.
    const { belowVersion } = splitByVersion(catalog.models, ccVersion);
    out.claude.belowVersion = belowVersion.map(({ id, name, family, minVersion }) => ({ id, name, family, minVersion }));
    out.claude.choices = wizardChoices(catalog.models);
  }
  out.clis.claude = out.claude;
  if (mode === 'check') {
    const config = loadConfig();
    out.config = { path: configPath(), modelsDefault: modelsAreDefault(config) };
    out.agents = checkAssignments(config, catalog);
  }
} catch (error) {
  // 보고 도구는 작업을 막지 않는다 — 스스로 터져도 폴백 JSON과 exit 0을 지킨다.
  out.claude = { ...emptyCli(), reason: error.name };
  out.clis = { claude: { ...emptyCli(), reason: error.name }, codex: { ...emptyCodex(), reason: error.name } };
  if (out.detected === null) out.offer = [];
}
if (unknownCli.length) {
  // 조용히 무시하면 사용자는 오타를 모른다. 보고 도구이므로 stderr 한 줄로만 알리고 exit 0을 지킨다.
  process.stderr.write(`[devkit] · --cli 값을 모른다(${unknownCli.join(', ')}) — claude·codex만 받는다\n`);
}
process.stdout.write(JSON.stringify(out) + '\n');
