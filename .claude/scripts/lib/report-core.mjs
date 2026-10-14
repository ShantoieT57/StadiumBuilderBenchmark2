// report-core.mjs
//
// Shared building blocks for the two log-derived data generators
// (generate-build-cost-report.mjs and generate-build-effort.mjs): the ONE pricing table, the
// cache multipliers, the transcript-directory discovery, and the deduped usage-record reader.
//
// What each generator takes, so the boundary is explicit:
//   - BOTH import PRICING/rates() and discoverTranscriptDirs(). Those are the two places a
//     divergence changes the headline numbers — the price of a token, and which transcripts
//     count — so they must never be copied into a generator. They were, once: the two walks
//     drifted to different sibling-worktree rules and the reports disagreed on any build that
//     used a parallel worktree. Don't reintroduce a local copy.
//   - the effort generator also uses gatherUsageRecords(); the cost generator does NOT. It
//     needs more than usage per message (tool_use blocks, AskUserQuestion pairs, user-input
//     classification), so it keeps its own line-level walk over the dirs discovered here.
//     That is deliberate, not drift.
//
// Pure functions only — no argv parsing, no file writes, no process.exit — so both report
// generators can compose these however they need. Reads (the transcript store, and `git worktree
// list` to tell this project's worktrees from same-prefix siblings) are the exception, and are
// what these helpers exist to do.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tryGit } from './git.js';

// ---- exit codes ----
// Both generators fail for two very different reasons, and the caller has to tell them apart:
// there is no project to report on yet (STOP — every later step fails the same way), versus an
// optional input is missing (CONTINUE — the page renders and names the gap in Data quality).
// A distinct code makes that a deterministic check. It used to be a substring match on the error
// text, which had already drifted: the procedure quoted "No epics found at" while the effort
// generator printed "No epics at", so the gate silently missed half its cases.
export const EXIT_NO_PROJECT = 3;
export const EXIT_MISSING_INPUT = 1;

// ---- pricing (USD per 1M tokens). Cache read 0.1x input; cache write 1.25x (5m) / 2x (1h). ----
//
// There is NO pricing API — the Models API (`GET /v1/models`) returns context/output limits and
// a capability tree, but no rates. So this table is hand-maintained: verify any new model's
// prices via the `claude-api` skill (never from memory) and add it here when it shows up in the
// unknown-model warning.
//
// Hardcoding is also the *correct* choice, not just the only one: these reports price
// HISTORICAL token spend, so a run must use the rate that was in effect when the tokens were
// spent. A live lookup would silently re-price old reports whenever rates changed, so the same
// report would disagree with itself between runs.
//
// `promo` is optional, for time-boxed introductory pricing: `{ input, output, until }` (plus an
// optional `from`), where the bounds are EXCLUSIVE-end ISO instants. It applies only when the
// caller passes the spend timestamp to rates() — see the `at` parameter below.
export const CACHE_READ_MULT = 0.1, CACHE_WRITE_5M_MULT = 1.25, CACHE_WRITE_1H_MULT = 2;
export const PRICING = {
  'claude-fable-5':            { input: 10, output: 50, name: 'Fable 5' },
  'claude-mythos-5':           { input: 10, output: 50, name: 'Mythos 5' },
  'claude-opus-5':             { input: 5,  output: 25, name: 'Opus 5' },
  'claude-opus-4-8':           { input: 5,  output: 25, name: 'Opus 4.8' },
  'claude-opus-4-7':           { input: 5,  output: 25, name: 'Opus 4.7' },
  'claude-opus-4-6':           { input: 5,  output: 25, name: 'Opus 4.6' },
  // Sonnet 5 launched on introductory pricing of $2/$10, reverting to list on 2026-09-01.
  'claude-sonnet-5':           { input: 3,  output: 15, name: 'Sonnet 5',
                                 promo: { input: 2, output: 10, until: '2026-09-01T00:00:00Z' } },
  'claude-sonnet-4-6':         { input: 3,  output: 15, name: 'Sonnet 4.6' },
  'claude-haiku-4-5-20251001': { input: 1,  output: 5,  name: 'Haiku 4.5' },
  'claude-haiku-4-5':          { input: 1,  output: 5,  name: 'Haiku 4.5' },
};
export const unknownModels = new Set();

// rates(model[, at]) -> { in, out, read, w5m, w1h, estimated }
//
// `at` is the epoch-ms timestamp of the spend being priced. Pass it whenever you know it: it
// selects the rate that was in effect at that moment. Omit it and you get LIST price — a caller
// that doesn't know when the tokens were spent must not be handed promotional rates.
//
// `estimated` is true when the model isn't in the table and Opus-tier pricing was substituted.
// Callers should surface that in the report rather than presenting the figure as exact.
export function rates(model, at) {
  let p = PRICING[model];
  let estimated = false;
  if (!p) { unknownModels.add(model); p = PRICING['claude-opus-4-8']; estimated = true; }
  let { input, output } = p;
  if (p.promo && at != null) {
    const from = p.promo.from ? Date.parse(p.promo.from) : -Infinity;
    const until = Date.parse(p.promo.until);
    if (at >= from && at < until) { input = p.promo.input; output = p.promo.output; }
  }
  return {
    in: input, out: output,
    read: input * CACHE_READ_MULT, w5m: input * CACHE_WRITE_5M_MULT, w1h: input * CACHE_WRITE_1H_MULT,
    estimated,
  };
}

// The transcript-store folder name for an absolute path: every non-alphanumeric char becomes a
// dash. Separator-agnostic, so `C:\Git\app` and the `C:/Git/app` git prints both slugify alike.
function slugifyPath(p) {
  return p.replace(/[^a-zA-Z0-9]/g, '-');
}

// Decides whether a transcript dir that extends this project's slug is really one of its
// worktrees rather than a separate project that happens to share the prefix.
//
// Ask git, which knows exactly: `worktree list` names every checkout of THIS repo, so a listed
// sibling is proof of membership and an unlisted one is a different project whatever it is named.
//
// Only the LAST path segment is compared. The same directory reaches this code in up to three
// forms — the caller's `projectRoot`, git's canonicalised output, and the cwd Claude Code
// slugified when it created the transcript dir — and on Windows those differ by 8.3 short names
// (`TANIAL~1` vs `TaniaLeipoldt`), drive-letter case, and resolved symlinks. Matching whole paths
// looks stricter but fails on any of those and silently drops a real worktree, which is the data
// loss this discovery exists to prevent. The final segment is the part all three agree on, and
// the caller has already established that `d` starts with `slug + '-'`, so pairing that prefix
// with a git-confirmed suffix identifies the directory exactly.
//
// When git can't answer — not installed, not a repo, or a `--transcripts` snapshot taken against
// a path that no longer exists — fall back to the one worktree shape the workflow documents,
// `<project>-plan-<epicSlug>`. That keeps parallel-plan worktrees working without readmitting
// every same-prefix project, since `-plan-` is a far less likely thing to name a checkout than
// the `-QA` / `-copy` / `-upsidedown` suffixes people actually use.
function worktreeMatcher(projectRoot, slug) {
  const listed = tryGit(projectRoot, 'worktree', 'list', '--porcelain');
  if (listed) {
    const base = path.basename(projectRoot);
    const accepted = new Set();
    for (const l of listed.split('\n')) {
      if (!l.startsWith('worktree ')) continue;
      const wtBase = path.basename(l.slice('worktree '.length).trim().replace(/[\\/]+$/, ''));
      // Siblings only: a worktree elsewhere on disk has a slug that doesn't extend this one, so
      // the caller's prefix test has already excluded its transcript dir.
      if (!wtBase.toLowerCase().startsWith(base.toLowerCase() + '-')) continue;
      accepted.add((slug + slugifyPath(wtBase.slice(base.length))).toLowerCase());
    }
    return (d) => accepted.has(d.toLowerCase());
  }
  const planPrefix = (slug + '-plan-').toLowerCase();
  return (d) => d.toLowerCase().startsWith(planPrefix);
}

// ---- transcript directory discovery ----
// Standard store is ~/.claude/projects/<slug>/, where slug = the project's absolute path
// with every non-alphanumeric char replaced by '-'. Sibling dirs whose slug extends this one
// can also belong to this project: the workflow creates each parallel worktree as a SIBLING
// directory (`git worktree add ../<project>-plan-<epicSlug>`), which slugifies to
// `<slug>-<suffix>` — a SINGLE dash before the suffix, so an earlier `--` rule matched no real
// worktree at all.
//
// But "extends the slug" alone does NOT mean "is part of this project": `stadium-8`,
// `stadium-8-QA` and `stadium-8-upsidedown` are three separate checkouts sitting next to each
// other, and the first one's slug is a prefix of the other two. Taking every single-dash match
// folded whole unrelated projects into the totals — and because that spend lands outside every
// story window, it inflates the effort report's costUplift, which MULTIPLIES the "fully loaded"
// figures and the sizing calculator. Over-counting is not the lesser evil when the number is a
// ratio someone quotes a client.
//
// So a sibling has to prove it belongs, via `worktreeMatcher` above. This only ever narrows what
// the previous rule accepted, so the data loss that rule fixed stays fixed.
//
// Pass `transcriptsOverride` (a directory holding `<slug>/`) to read a copied snapshot
// instead of the live store.
export function discoverTranscriptDirs(projectRoot, transcriptsOverride) {
  const slug = slugifyPath(projectRoot);
  const projectsRoot = transcriptsOverride || path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(projectsRoot)) return { dirs: [], slug, projectsRoot };
  const dirs = [];
  const primary = path.join(projectsRoot, slug);
  if (fs.existsSync(primary)) dirs.push(primary);
  const isWorktree = worktreeMatcher(projectRoot, slug);
  for (const d of fs.readdirSync(projectsRoot)) {
    if (d === slug || !d.startsWith(slug + '-')) continue;
    if (!isWorktree(d)) continue;
    try { if (fs.statSync(path.join(projectsRoot, d)).isDirectory()) dirs.push(path.join(projectsRoot, d)); } catch { /* skip */ }
  }
  // Fallback: if the override dir directly contains the .jsonl files (single-project snapshot
  // whose folder name isn't the slug), treat it as the one transcript dir.
  if (!dirs.length && transcriptsOverride) {
    const sub = fs.readdirSync(projectsRoot).filter(f => fs.statSync(path.join(projectsRoot, f)).isDirectory());
    for (const s of sub) dirs.push(path.join(projectsRoot, s));
  }
  return { dirs, slug, projectsRoot };
}

// ---- usage records, deduped by message id, across orchestrator + all sub-agents ----
// Returns { records:[{ts, model, cost, tokens, sessionId, agent, main, estimated}], sawSubagents,
// sawEstimatedPricing }.
// `sawSubagents` lets a caller detect the incomplete-log case (no sub-agent transcripts
// captured) and degrade gracefully instead of reporting wrong cost.
// `sawEstimatedPricing` is true when any record's model was missing from PRICING and was priced
// at Opus-tier rates — the report must say so rather than presenting the total as exact.
// Each record is priced at the rate in effect at ITS OWN timestamp, so a run that spans a
// price change (or the end of a promotional window) is costed correctly on both sides of it.
export function gatherUsageRecords(dirs, excludeIds = new Set()) {
  const files = [];
  let sawSubagents = false;
  for (const dir of dirs) {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      const sid = f.replace(/\.jsonl$/, '');
      if (excludeIds.has(sid)) continue;
      files.push({ file: path.join(dir, f), sessionId: sid, agent: 'orchestrator', main: true });
      const subDir = path.join(dir, sid, 'subagents');
      if (!fs.existsSync(subDir)) continue;
      for (const sf of fs.readdirSync(subDir)) {
        if (!sf.endsWith('.jsonl')) continue;
        sawSubagents = true;
        let agent = 'subagent';
        const metaFile = path.join(subDir, sf.replace(/\.jsonl$/, '.meta.json'));
        if (fs.existsSync(metaFile)) { try { agent = JSON.parse(fs.readFileSync(metaFile, 'utf8')).agentType || agent; } catch { /* keep default */ } }
        files.push({ file: path.join(subDir, sf), sessionId: sid, agent, main: false });
      }
    }
  }
  const byId = new Map();
  for (const { file, sessionId, agent, main } of files) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.type !== 'assistant' || o.message?.model === '<synthetic>' || !o.message?.usage) continue;
      const id = o.message?.id || o.uuid;
      const u = o.message.usage, cc = u.cache_creation;
      const w5 = cc ? (cc.ephemeral_5m_input_tokens || 0) : (u.cache_creation_input_tokens || 0);
      const w1 = cc ? (cc.ephemeral_1h_input_tokens || 0) : 0;
      const inp = u.input_tokens || 0, cr = u.cache_read_input_tokens || 0, out = u.output_tokens || 0;
      const ts = o.timestamp ? new Date(o.timestamp).getTime() : null;
      // Price at the spend's own timestamp — see rates() on why `at` matters.
      const ra = rates(o.message.model, ts);
      const cost = (inp * ra.in + out * ra.out + cr * ra.read + w5 * ra.w5m + w1 * ra.w1h) / 1e6;
      byId.set(id, { ts, model: o.message.model, cost, tokens: inp + cr + w5 + w1 + out, sessionId, agent, main, estimated: ra.estimated });
    }
  }
  const records = [...byId.values()].filter(r => r.ts);
  return { records, sawSubagents, sawEstimatedPricing: records.some(r => r.estimated) };
}
