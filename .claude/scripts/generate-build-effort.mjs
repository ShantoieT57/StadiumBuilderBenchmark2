// Generates the BUILD-EFFORT report — how long and how much each story cost to build,
// grouped by screen type AND rolled up to the feature (epic) level, for ONE project.
// Ground truth only:
//   - time  : per-story startedAt -> completedAt from generated-docs/epics/<slug>/state.json
//   - tokens: every transcript message (orchestrator + sub-agents) bucketed into the story
//             window containing its timestamp; priced with the shared report-core table.
//
// Story figures are measured. Feature/epic figures are those measured stories summed, plus a
// documented pro-rata share of the overhead that sits outside every story window (see UPLIFT
// below) — so an epic total can be compared with, and used to estimate, a whole feature.
//
//   node .claude/scripts/generate-build-effort.mjs [--rate=18.50] [--exclude=id,id]
//                                                              [--transcripts=DIR] [--project-root=DIR]
//
// Writes generated-docs/reports/build-effort-data.json — DATA ONLY, no page of its own.
//
// This used to render a standalone build-effort.html. It no longer does: the effort content is
// now the "Effort benchmarks" section of the maintainer build report, rendered by
// scripts/generate-build-report-html.js from this JSON. Keeping a second page meant the same
// tables existed in two renderers, so the two could disagree about the same project — the
// duplication this merge removed. The JSON stays the durable artifact (it also carries the
// per-story rows for future cross-project pooling); render new views from it, don't re-add a page.
//
// Completeness gate: if no sub-agent transcripts are found (e.g. an older log format that
// only kept the orchestrator), token cost is INCOMPLETE — `costComplete: false` tells the
// consumer to render time-only rather than printing wrong dollar figures.
//
// Inclusion rule: the same one the cost generator uses. Post-delivery reporting sessions are
// dropped (see the block below `--exclude`) so the two data files can't hand the same page two
// different build totals.
import fs from 'node:fs';
import path from 'node:path';
import { getProjectRoot } from './lib/project-root.js';
import {
  discoverTranscriptDirs, gatherUsageRecords, unknownModels,
  EXIT_NO_PROJECT as NO_PROJECT, EXIT_MISSING_INPUT as MISSING_INPUT,
} from './lib/report-core.mjs';

// ---- args ----
const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
  const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true];
}));
const RATE = parseFloat(args.rate) || null; // ZAR per USD; optional
if (args.exclude === true) console.warn('WARNING: --exclude needs a value like --exclude=id1,id2 — ignoring it (nothing excluded).');
const EXCLUDE = new Set((typeof args.exclude === 'string' ? args.exclude : '').split(',').map(s => s.trim()).filter(Boolean));
const PROJECT_ROOT = (typeof args['project-root'] === 'string') ? path.resolve(args['project-root']) : getProjectRoot();
const TRANSCRIPTS = (typeof args.transcripts === 'string') ? path.resolve(args.transcripts) : null;

// ---- post-delivery reporting sessions: excluded, exactly as the cost generator excludes them ----
// A session whose first deliberate input is a report/dashboard command is ABOUT the project, not
// part of the build. Its spend sits outside every story window, so counting it here would land it
// in `overheadCost` and inflate `costUplift` — and since running /build-report-maintainer creates
// one of these sessions every time, every "fully loaded" figure and the sizing calculator would
// creep upwards with each report run. It would also put a total on the maintainer page that
// contradicts the Cost & user involvement panel a few sections above it, which excludes them.
//
// The classification lives in generate-build-cost-report.mjs (it needs that script's full
// transcript-hygiene walk to find each session's first DELIBERATE input) and is published in the
// data file it writes — including any `--keep=<id>` override. build-report-procedure.md runs that
// generator immediately before this one, so the list is fresh. Absent (run standalone, or the cost
// generator failed), nothing is auto-excluded and `--exclude` still applies.
const postDeliveryExcluded = [];
try {
  const cost = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'generated-docs', 'reports', 'build-cost-data.json'), 'utf8'));
  for (const s of cost?.postDelivery?.sessions || []) {
    if (!s?.id || EXCLUDE.has(s.id)) continue;
    EXCLUDE.add(s.id);
    postDeliveryExcluded.push(s.id);
  }
} catch { /* no cost data alongside — carry on with --exclude only */ }

// ---- screen-type taxonomy (edit here to tune classification) ----
// First matching rule wins, so order = priority. Titles come from the story's Playwright
// spec filename. Deliberately title-based, never the epic slug (an epic named "…-export"
// must not tag its listing stories as Export).
const TAXONOMY = [
  { cat: 'Auth / app-shell / infra',  short: 'infra',   re: /bff|proxy|gateway|session|sign ?in|app shell|shell|nav guard|permission|badge|timeout/ },
  { cat: 'Export',                    short: 'export',  re: /export|csv/ },
  { cat: 'Upload / create form',      short: 'form',    re: /upload/ },
  { cat: 'Record action',             short: 'action',  re: /approve|reject|retry|cancel|submit|delete|create|edit|update/ },
  { cat: 'Listing / table page',      short: 'listing', re: /table|overview|filter|search|sort|paginat|card list|\blist\b/ },
  { cat: 'Detail / summary view',     short: 'detail',  re: /summary|detail|validation error|banner|audit|note|state|view/ },
];
const OTHER = { cat: 'Other', short: 'other' };
const classify = title => (TAXONOMY.find(t => t.re.test(title.toLowerCase())) || OTHER).cat;
const SHORT = Object.fromEntries([...TAXONOMY, OTHER].map(t => [t.cat, t.short]));

// ---- stories (time) from epic state files + titles from spec filenames ----
const epicsDir = path.join(PROJECT_ROOT, 'generated-docs', 'epics');
// Same condition and same wording as the cost generator's — one project state should not be
// described two ways by two scripts the orchestrator runs back to back.
if (!fs.existsSync(epicsDir)) {
  console.error('No epics found at generated-docs/epics/ — the workflow has not created an epic yet; nothing to report.');
  process.exit(NO_PROJECT);
}
function specTitles() {
  const dir = path.join(PROJECT_ROOT, 'app-frontend', 'e2e'); const map = {};
  if (!fs.existsSync(dir)) return map;
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^epic-(.+)-story-(\d+)-(.+)\.spec\.ts$/);
    if (m) map[`${m[1]}|${m[2]}`] = m[3].replace(/-/g, ' ');
  }
  return map;
}
const titles = specTitles();
const stories = [];
// How many stories each epic DECLARES, timed or not. The loop below keeps only stories with
// usable timestamps, so `stories.length` per epic is a coverage figure, not the epic's size —
// and an epic measured from 2 of its 8 stories must not be presented as a measured epic.
const epicStoryTotals = new Map();
for (const slug of fs.readdirSync(epicsDir)) {
  const sf = path.join(epicsDir, slug, 'state.json');
  if (!fs.existsSync(sf)) continue;
  let st; try { st = JSON.parse(fs.readFileSync(sf, 'utf8')); } catch { continue; }
  const epicName = st.epic?.name || slug;
  const declared = Object.entries(st.stories || {});
  epicStoryTotals.set(slug, declared.length);
  for (const [n, s] of declared) {
    const a = s.startedAt ? new Date(s.startedAt).getTime() : NaN;
    const b = s.completedAt ? new Date(s.completedAt).getTime() : NaN;
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    const title = titles[`${slug}|${n}`] || `story ${n}`;
    stories.push({ epic: slug, epicName, n, title, start: a, end: b, min: (b - a) / 60000, cat: classify(title), cost: 0, tokens: 0, calls: 0 });
  }
}
// Not a "no project" case: epics exist, they just have no timed stories yet (a build in its first
// story, or one predating the timestamps). The maintainer page drops this section and says so, so
// the caller continues — hence MISSING_INPUT, not NO_PROJECT.
if (!stories.length) { console.error('No stories with start/complete timestamps found — nothing to report.'); process.exit(MISSING_INPUT); }
stories.sort((x, y) => x.start - y.start);

// ---- tokens: bucket transcript records into story windows ----
// Epics can be built in parallel (separate branches/worktrees), so story windows OVERLAP and a
// message's timestamp may sit inside several of them. Attributing it to the first match would
// dump all concurrent spend on whichever story started earliest — and at the feature level that
// silently drains one epic into another. With N stories genuinely in flight at that instant the
// logs can't say which one a message served, so the cost is split evenly across the matches and
// the ambiguous share is tracked so the report can flag it.
const { dirs } = discoverTranscriptDirs(PROJECT_ROOT, TRANSCRIPTS);
const { records, sawSubagents, sawEstimatedPricing } = gatherUsageRecords(dirs, EXCLUDE);
let overheadCost = 0, overheadTokens = 0, totalCost = 0, ambiguousCost = 0;
for (const r of records) {
  totalCost += r.cost;
  const hits = stories.filter(st => r.ts >= st.start && r.ts < st.end);
  if (!hits.length) { overheadCost += r.cost; overheadTokens += r.tokens; continue; }
  if (hits.length > 1) ambiguousCost += r.cost;
  for (const s of hits) { s.cost += r.cost / hits.length; s.tokens += r.tokens / hits.length; s.calls++; }
}
// Which stories ran concurrently with a story from a DIFFERENT epic — the case that makes a
// per-feature figure soft, as opposed to two stories of the same epic overlapping.
for (const s of stories) {
  s.parallel = stories.some(o => o !== s && o.epic !== s.epic && o.start < s.end && s.start < o.end);
}
// Completeness is coverage-based, not "does a subagents dir exist": per-story cost is only
// trustworthy if MOST stories actually got token records bucketed into them. A build whose
// sub-agent transcripts weren't captured (old log format) leaves nearly every story at $0,
// even if some unrelated session in the store has a subagents dir. Below the threshold we
// render time-only rather than publish wrong dollar figures.
const COST_COVERAGE_MIN = 0.6;
const storiesWithCost = stories.filter(s => s.cost > 0).length;
const costCoverage = stories.length ? storiesWithCost / stories.length : 0;
const costComplete = sawSubagents && dirs.length > 0 && costCoverage >= COST_COVERAGE_MIN;
const inStoryCost = stories.reduce((a, s) => a + s.cost, 0);

// ---- aggregate per category ----
const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const sum = a => a.reduce((x, y) => x + y, 0);

// ---- the two uplift factors that turn measured story figures into whole-feature figures ----
//
// Only ~⅓ of a build's spend lands inside story windows; the rest is scaffolding that a feature
// still causes (PLAN, epic-end E2E + fix cycles, PR/merge) or shares (INTAKE, epic decomposition).
// Ground truth can't split that per epic — in a single-session build the overhead messages sit
// between story windows with nothing tying them to one epic, and epics built in parallel
// worktrees overlap in time. So it is allocated pro-rata to measured story cost, which is the
// honest, stated approximation: bigger epics pull more scaffolding.
//
//   costUplift = total spend / in-story spend      -> marginal cost x costUplift = fully loaded
//   timeUplift = summed epic elapsed / summed story minutes
//                (measures the gaps BETWEEN stories inside an epic; PLAN and epic-end aren't
//                 timestamped, so this is a floor on elapsed time, not the whole calendar cost)
const costUplift = inStoryCost > 0 ? totalCost / inStoryCost : 0;

const catOrder = ['Listing / table page', 'Record action', 'Upload / create form', 'Detail / summary view', 'Export', 'Auth / app-shell / infra', 'Other'];
const cats = {};
for (const s of stories) (cats[s.cat] ||= []).push(s);
const categories = catOrder.filter(c => cats[c]).map(c => {
  const g = cats[c];
  const medCost = median(g.map(s => s.cost));
  return {
    cat: c, short: SHORT[c], n: g.length,
    medMin: median(g.map(s => s.min)), meanMin: mean(g.map(s => s.min)),
    medCost, medLoadedCost: medCost * costUplift, medTokens: median(g.map(s => s.tokens)),
  };
});

// ---- roll up to the feature (epic) level ----
// An epic IS the feature in this workflow, so this is the level a new feature gets estimated at.
const byEpic = new Map();
for (const s of stories) {
  let e = byEpic.get(s.epic);
  if (!e) byEpic.set(s.epic, e = { slug: s.epic, name: s.epicName, rows: [], mix: {} });
  e.rows.push(s);
  e.mix[s.cat] = (e.mix[s.cat] || 0) + 1;
}
const epics = [...byEpic.values()].map(e => {
  const start = Math.min(...e.rows.map(s => s.start)), end = Math.max(...e.rows.map(s => s.end));
  const marginalCost = sum(e.rows.map(s => s.cost));
  // An epic lands here on the strength of ONE timed story, so `stories` (timed) can be a
  // fraction of `storiesTotal` (declared) — mid-build, or on a project whose older stories
  // predate the timestamps. `timeComplete` is what lets the page tell a measurement from an
  // undercount: every figure below is summed over timed stories only.
  const storiesTotal = epicStoryTotals.get(e.slug) ?? e.rows.length;
  return {
    slug: e.slug, name: e.name, stories: e.rows.length,
    storiesTotal, timeComplete: e.rows.length >= storiesTotal,
    mix: catOrder.filter(c => e.mix[c]).map(c => ({ cat: c, short: SHORT[c], n: e.mix[c] })),
    buildMinutes: sum(e.rows.map(s => s.min)), medStoryMin: median(e.rows.map(s => s.min)),
    elapsedMinutes: (end - start) / 60000, start, end,
    tokens: sum(e.rows.map(s => s.tokens)),
    marginalCost, loadedCost: marginalCost * costUplift,
    parallel: e.rows.some(s => s.parallel),
  };
}).sort((a, b) => a.start - b.start);
const timeUplift = sum(epics.map(e => e.buildMinutes)) > 0
  ? sum(epics.map(e => e.elapsedMinutes)) / sum(epics.map(e => e.buildMinutes)) : 1;

// Benchmark figures for sizing a NEW feature: the per-type medians above, plus what a typical
// epic in this project looked like as a top-down sanity check on any bottom-up estimate.
//
// Only FULLY timed epics qualify. A partially timed epic's buildMinutes/marginalCost cover a
// subset of its stories, so folding it in drags the "typical feature" median below any real
// feature — and that median is what the sizing calculator quotes. Mid-build there may be no
// complete epic at all, in which case a rough benchmark beats none, and `epicsMeasured` tells
// the page how many features the figure actually rests on.
const timedEpics = epics.filter(e => e.timeComplete);
const benchEpics = timedEpics.length ? timedEpics : epics;
const benchmarks = {
  costUplift, timeUplift,
  epicsMeasured: benchEpics.length,
  partialEpics: epics.length - timedEpics.length,
  typicalEpic: {
    // Rounded: a story COUNT, and an even number of epics makes the raw median a half —
    // "3.5 stories" is not a benchmark anyone can size against.
    stories: Math.round(median(benchEpics.map(e => e.storiesTotal))),
    buildMinutes: median(benchEpics.map(e => e.buildMinutes)),
    elapsedMinutes: median(benchEpics.map(e => e.elapsedMinutes)),
    marginalCost: median(benchEpics.map(e => e.marginalCost)),
    loadedCost: median(benchEpics.map(e => e.loadedCost)),
  },
};

const result = {
  generatedAt: new Date().toISOString(),
  project: PROJECT_ROOT,
  projectName: (() => { try { const h = fs.readFileSync(path.join(PROJECT_ROOT, 'generated-docs', 'project.md'), 'utf8').split('\n').find(l => /^#\s+/.test(l)); return h ? h.replace(/^#\s+/, '').trim() : ''; } catch { return ''; } })(),
  costComplete, rate: RATE,
  // Session ids dropped because the cost generator flagged them as post-delivery reporting runs.
  // Recorded so the maintainer page's totals can be shown to rest on the same inclusion rule as
  // its Cost & user involvement panel.
  postDeliveryExcluded,
  totals: {
    stories: stories.length,
    epics: epics.length,
    buildMinutes: stories.reduce((a, s) => a + s.min, 0),
    medMinutes: median(stories.map(s => s.min)),
    inStoryCost, overheadCost, totalCost,
    overheadShare: totalCost ? overheadCost / totalCost : 0,
    fullyLoadedPerStory: stories.length ? totalCost / stories.length : 0,
    fullyLoadedPerEpic: epics.length ? totalCost / epics.length : 0,
    medCost: median(stories.map(s => s.cost)),
  },
  attribution: {
    ambiguousCost,
    ambiguousShare: inStoryCost ? ambiguousCost / inStoryCost : 0,
    parallelEpics: epics.filter(e => e.parallel).map(e => e.slug),
  },
  benchmarks,
  categories,
  epics,
  stories: stories.map(s => ({ epic: s.epic, n: s.n, title: s.title, cat: s.cat, min: s.min, tokens: s.tokens, cost: s.cost })),
  // Non-empty means a model wasn't in the pricing table and was costed at Opus-tier rates, so the
  // dollar figures are estimates. The report banners this rather than presenting them as exact.
  unknownModels: [...unknownModels],
  pricingEstimated: !!sawEstimatedPricing,
};

const outDir = path.join(PROJECT_ROOT, 'generated-docs', 'reports');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'build-effort-data.json'), JSON.stringify(result, null, 2));

// ---- console summary ----
console.log(JSON.stringify({
  stories: result.totals.stories,
  epics: result.totals.epics,
  medMinutesPerStory: +result.totals.medMinutes.toFixed(1),
  costComplete,
  totalCostUsd: +totalCost.toFixed(2),
  inStoryCostUsd: +inStoryCost.toFixed(2),
  overheadSharePct: +(result.totals.overheadShare * 100).toFixed(0),
  fullyLoadedPerStoryUsd: +result.totals.fullyLoadedPerStory.toFixed(2),
  costUplift: +costUplift.toFixed(2),
  timeUplift: +timeUplift.toFixed(2),
  postDeliverySessionsExcluded: postDeliveryExcluded,
  ambiguousSharePct: +(result.attribution.ambiguousShare * 100).toFixed(0),
  parallelEpics: result.attribution.parallelEpics,
  typicalEpic: `${benchmarks.typicalEpic.stories} stories / ${benchmarks.typicalEpic.buildMinutes.toFixed(0)}min build${costComplete ? ' / $' + benchmarks.typicalEpic.loadedCost.toFixed(2) + ' loaded' : ''}`,
  byType: categories.map(c => `${c.cat}: ${c.medMin.toFixed(0)}min${costComplete ? ' / $' + c.medCost.toFixed(2) + ' marginal / $' + c.medLoadedCost.toFixed(2) + ' loaded' : ''} (n=${c.n})`),
  byEpic: epics.map(e => `${e.slug}: ${e.stories} stories / ${e.buildMinutes.toFixed(0)}min build / ${e.elapsedMinutes.toFixed(0)}min elapsed${costComplete ? ' / $' + e.marginalCost.toFixed(2) + ' marginal / $' + e.loadedCost.toFixed(2) + ' loaded' : ''}`),
  unknownModels: result.unknownModels,
}, null, 1));
if (!costComplete) console.warn('WARNING: no sub-agent transcripts found — token cost is INCOMPLETE; report shows build time only.');
// Overlap is reported whatever its source, but the CAUSE differs and only the cross-epic case
// softens a per-feature figure — so never name parallel features when there are none to name.
if (result.attribution.ambiguousShare > 0.05) console.warn(`NOTE: ${(result.attribution.ambiguousShare * 100).toFixed(0)}% of story spend fell inside overlapping story windows (${result.attribution.parallelEpics.length ? `features built in parallel: ${result.attribution.parallelEpics.join(', ')}` : 'all within a single feature'}) — split evenly across the stories in flight, so per-feature splits are approximate.`);
if (unknownModels.size) console.warn('WARNING: unknown models priced as Opus 4.8 — add them to PRICING in report-core.mjs: ' + [...unknownModels].join(', '));
console.log('written generated-docs/reports/build-effort-data.json');
