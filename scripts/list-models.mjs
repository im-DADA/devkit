// 읽기 전용 보고 도구. 목록을 못 얻어도 폴백 JSON을 내고 exit 0을 유지한다.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { readClaudeCatalog, readCodexCatalog } = require('../hooks/lib/model-catalog-io');
const { codexChoices } = require('../hooks/lib/model-catalog-codex');
const { detectClis, offerableClis } = require('../hooks/lib/cli-detect');
const { splitByVersion, wizardChoices, fallbackChoices, checkAssignments, modelsAreDefault } = require('../hooks/lib/model-catalog');
const { loadConfig, configPath } = require('../hooks/lib/config');
const { mergeMode } = require('../hooks/lib/merge-mode');
const { basePlan, modelPlan, GROUPS, acceptCodexModel } = require('../hooks/lib/setup-plan');
const { stagesPlan } = require('../hooks/lib/setup-plan-tiers');
const { DEFAULTS, AGENTS } = require('../hooks/lib/config-schema');

const args = process.argv.slice(2);
let mergeArg = null; let mergeSeen = false;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] !== '--merge' && !args[i].startsWith('--merge=')) continue;
  const value = args[i] === '--merge' ? args[i + 1] : args[i].slice('--merge='.length);
  if (value && !value.startsWith('--')) { mergeArg = value; mergeSeen = true; }
}
// `--check`가 `--plan`보다 **먼저**다 — 둘 다 주면 check이고 plan 키는 생기지 않는다.
const mode = args.includes('--check') ? 'check'
  : args.includes('--merge') || args.some((a) => a.startsWith('--merge=')) ? 'merge'
  : args.includes('--plan') ? 'plan' : 'list';
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
let codexModelArg = null;
let codexModelSeen = false;   // 플래그가 왔다는 사실과 **값을 얻었다**는 사실은 다르다
for (let i = 0; i < args.length; i += 1) {
  if (args[i] !== '--codex-model' && !args[i].startsWith('--codex-model=')) continue;
  codexModelSeen = true;
  const value = args[i] === '--codex-model' ? args[i + 1] : args[i].slice('--codex-model='.length);
  if (value && !value.startsWith('--')) codexModelArg = value;
}
let agentArg = null;   // `--cc-version`·`--cli`과 같은 규약(공백형·`=`형)
for (let i = 0; i < args.length; i += 1) {
  const value = args[i] === '--agent' ? args[i + 1]
    : args[i].startsWith('--agent=') ? args[i].slice('--agent='.length) : null;
  if (value && !value.startsWith('--')) agentArg = value;
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
if (mode === 'merge') {
  // 본체는 `hooks/lib/merge-mode.js`다 — 이 파일이 200줄을 넘겨서 걷어냈고, 그쪽은
  // `INTEGRITY.sha256` 범위라 해시 안전망도 생긴다(2026-10-02 REPORT가 찾은 규칙 위반).
  const r = mergeMode({ note: out.note, mergeSeen, mergeArg });
  process.stdout.write(JSON.stringify(r.json) + '\n');
  if (r.diagnostic) process.stderr.write(r.diagnostic);
} else {
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
if (mode === 'plan') {
  // 기존 try **밖**이다. `설정 범위` 문항은 카탈로그 없이도 정적으로 만들 수 있으므로,
  // 카탈로그 실패가 문항을 통째로 지우면 안 된다(B14).
  try {
    const meta = (cli) => ({ status: out.clis[cli].status, reason: out.clis[cli].reason,
      fetchedAt: out.clis[cli].fetchedAt, stale: out.clis[cli].stale === true });
    const known = agentArg !== null && Object.prototype.hasOwnProperty.call(DEFAULTS.models, agentArg);
    // ⚠ `custom`은 아래 `model`이 **쓰기 전에** 선언돼야 한다 — 뒤에 두면 TDZ 에러가
    //   catch에 먹혀 폴백으로 조용히 떨어진다(2026-10-02에 실제로 그랬다).
    const custom = acceptCodexModel(codexModelArg);
    // ⚠ `byCli`를 **먼저** 만든다 — CLI 문항을 낼지 판정하려면 "그 CLI가 모델 문항을 낼 수
    //   있나"를 알아야 한다. 순서를 되돌리면 감지만 보고 물어 **막다른 길**이 생긴다(Gap 5회차).
    const byCli = !known ? null : Object.fromEntries(['claude', 'codex'].map((cli) => [cli,
      out.offer.some((o) => o.cli === cli && o.offered === true)
        ? modelPlan({ agent: agentArg, cli, choices: out.clis[cli].choices, meta: meta(cli), ccVersion,
          customModel: custom })
        : null]));
    const cliPlan = !known ? null
      : modelPlan({ agent: agentArg, cli: null, choices: null, meta: null, ccVersion, offer: out.offer,
        codexHasModels: byCli.codex !== null && byCli.codex.rounds.length > 0 });
    const model = !known ? null : {
      agent: agentArg,
      group: GROUPS.writesFiles.includes(agentArg) ? 'writesFiles' : 'returnsBody',
      cliRound: cliPlan.rounds[0] ?? null,
      byCli,
      // 못 쓰는 CLI의 사유를 여기 싣는다 — 안 실으면 `byCli[cli] === null`이 침묵이 된다.
      notes: cliPlan.notes,
    };
    const metaOf = (cli) => ({ status: out.clis[cli].status, reason: out.clis[cli].reason,
      fetchedAt: out.clis[cli].fetchedAt, stale: out.clis[cli].stale === true });
    const usable = (cli) => (out.offer.some((o) => o.cli === cli && o.offered === true)
      ? { choices: out.clis[cli].choices, meta: metaOf(cli) } : null);
    out.plan = { path: configPath(), ...basePlan({ offer: out.offer,
      codexChoices: out.clis.codex.choices, cfg: loadConfig(), customModel: custom }),
    defaults: DEFAULTS, model,
    // `--codex-model`로 받은 이름. 받아들일 수 없으면 null이고 키도 안 생긴다.
    custom: custom === null ? null : { model: custom, build: `codex:${custom}` },
    stages: stagesPlan({ offer: out.offer, byCli: { claude: usable('claude'), codex: usable('codex') },
      ccVersion, customModel: custom }) };
  } catch (error) {
    // 도달 입력을 찾지 못한 최후 방어선이다(IX11과 같은 상태). 그래도 exit 0과 폴백 JSON은 지킨다.
    out.plan = { path: null, rounds: [], notes: [`문항을 만들지 못했다(${error.name}) — 설정 파일을 직접 고친다`],
      patches: {}, current: null, defaults: DEFAULTS, model: null, custom: null, stages: null };
  }
  if (codexModelSeen && out.plan.custom === null) {
    // 거부된 값의 **원문을 싣지 않는다** — 진단 한 줄을 위조할 수 있다.
    process.stderr.write('[devkit] · --codex-model 값을 받아들이지 않았다 — Codex 모델 이름이어야 한다'
      + '(값 없음·빈 값·공백 포함·inherit·Claude 기본 배분 이름은 받지 않는다)\n');
  } else if (agentArg !== null && out.plan.model === null) {
    // 조용히 무시하면 사용자는 오타를 모른다. `--cli`의 선례대로 stderr 한 줄, exit 0은 지킨다.
    // 거부된 값의 **원문을 싣지 않는다** — 진단 한 줄을 위조할 수 있고, 아는 이름 목록만으로 충분하다.
    process.stderr.write('[devkit] · --agent 값을 모른다 — 단계 문항을 싣지 않는다'
      + ` (아는 이름: ${AGENTS.join(', ')})\n`);
  }
}
}
if (unknownCli.length) {
  // 조용히 무시하면 사용자는 오타를 모른다. 보고 도구이므로 stderr 한 줄로만 알리고 exit 0을 지킨다.
  process.stderr.write(`[devkit] · --cli 값을 모른다(${unknownCli.join(', ')}) — claude·codex만 받는다\n`);
}
if (mode !== 'merge') process.stdout.write(JSON.stringify(out) + '\n');
