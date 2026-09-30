// 읽기 전용 보고 도구. 목록을 못 얻어도 폴백 JSON을 내고 exit 0을 유지한다.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { readClaudeCatalog } = require('../hooks/lib/model-catalog-io');
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
const out = {
  note: 'devkit · 목록과 대조만 낸다 — 허용/거부 판정은 하지 않는다',
  mode, cli: 'claude', ccVersion,
  claude: { status: 'unreadable', reason: null, source: null, fetchedAt: null, stale: false,
    models: [], belowVersion: [], choices: { primary: [], pinned: [] } },
  fallback: fallbackChoices(),
};
try {
  const catalog = readClaudeCatalog();
  out.claude.status = catalog.ok ? 'ok' : catalog.reason;
  out.claude.reason = catalog.ok ? null : catalog.detail;
  out.claude.source = catalog.source;
  if (catalog.ok) {
    const date = new Date(catalog.fetchedAt);
    out.claude.fetchedAt = catalog.fetchedAt !== null && Number.isFinite(date.getTime()) ? date.toISOString() : null;
    out.claude.stale = catalog.stale;
    out.claude.models = catalog.models;
    const { offered, belowVersion } = splitByVersion(catalog.models, ccVersion);
    out.claude.belowVersion = belowVersion.map(({ id, name, family, minVersion }) => ({ id, name, family, minVersion }));
    out.claude.choices = wizardChoices(offered);
  }
  if (mode === 'check') {
    const config = loadConfig();
    out.config = { path: configPath(), modelsDefault: modelsAreDefault(config) };
    out.agents = checkAssignments(config, catalog);
  }
} catch (error) {
  out.claude = { status: 'unreadable', reason: error.name, source: null, fetchedAt: null, stale: false,
    models: [], belowVersion: [], choices: { primary: [], pinned: [] } };
}
process.stdout.write(JSON.stringify(out) + '\n');
