// Aggregate multiple benchmark result files into stable per-prompt pass rates.
// Usage: node aggregate.mjs results.multi1.json results.multi2.json ...
// Writes STABLE.md + stable.json. Flags flaky prompts (0 < rate < 1) — the ones
// where a single-trial number would mislead.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node aggregate.mjs <results.json> [<results.json> ...]');
  process.exit(1);
}

const runs = [];
for (const f of files) {
  runs.push(JSON.parse(await readFile(path.isAbsolute(f) ? f : path.join(HERE, f), 'utf8')));
}
const N = runs.length;
const model = runs[0].summary?.model ?? 'unknown';

// Group by prompt id across runs.
const byId = new Map();
for (const run of runs) {
  for (const r of run.results) {
    if (!byId.has(r.id)) byId.set(r.id, { id: r.id, tier: r.tier, lang: r.lang, attempts: [] });
    byId.get(r.id).attempts.push({ pass: r.pass, reasons: r.reasons, tools: r.toolCalls.map((c) => c.name) });
  }
}

const prompts = [...byId.values()].map((p) => {
  const passes = p.attempts.filter((a) => a.pass).length;
  return {
    ...p,
    passes,
    runs: p.attempts.length,
    rate: +(passes / p.attempts.length).toFixed(3),
    flaky: passes > 0 && passes < p.attempts.length,
  };
});

const tierAgg = {};
let totalPass = 0;
let totalRuns = 0;
for (const p of prompts) {
  tierAgg[p.tier] ??= { passes: 0, runs: 0 };
  tierAgg[p.tier].passes += p.passes;
  tierAgg[p.tier].runs += p.runs;
  totalPass += p.passes;
  totalRuns += p.runs;
}

const perRunOverall = runs.map((r) => r.summary.overall.rate);
const flaky = prompts.filter((p) => p.flaky);

const stable = {
  model,
  runs: N,
  files,
  overall: { passes: totalPass, runs: totalRuns, rate: +(totalPass / totalRuns).toFixed(3) },
  perRunOverallRates: perRunOverall,
  byTier: Object.fromEntries(
    Object.entries(tierAgg).map(([t, v]) => [t, { ...v, rate: +(v.passes / v.runs).toFixed(3) }]),
  ),
  flakyPrompts: flaky.map((p) => ({ id: p.id, rate: p.rate, passes: p.passes, runs: p.runs })),
  alwaysFail: prompts.filter((p) => p.passes === 0).map((p) => p.id),
};

await writeFile(path.join(HERE, 'stable.json'), JSON.stringify({ stable, prompts }, null, 2));

const tierNames = {
  1: 'T1 single read-only call',
  2: 'T2 arg extraction',
  3: 'T3 multi-step chain',
  4: 'T4 gated write proposal',
  5: 'T5 trap / no matching tool',
};
let md = `# Agent Valid-Plan Benchmark — STABLE (${N} runs) — ${model}\n\n`;
md += `Aggregate valid-plan rate: **${totalPass}/${totalRuns} (${Math.round(stable.overall.rate * 100)}%)** across ${N} runs.\n`;
md += `Per-run overall rates: ${perRunOverall.map((r) => Math.round(r * 100) + '%').join(' · ')}\n\n`;
md += `| Tier | Pass/Runs | Rate |\n|---|---|---|\n`;
for (const [t, v] of Object.entries(stable.byTier)) {
  md += `| ${tierNames[t] ?? t} | ${v.passes}/${v.runs} | ${Math.round(v.rate * 100)}% |\n`;
}
md += `\n## Per-prompt stability\n\n| ID | Tier | Rate | Passes | Note |\n|---|---|---|---|---|\n`;
for (const p of prompts.sort((a, b) => a.rate - b.rate || String(a.id).localeCompare(b.id))) {
  const note = p.passes === 0 ? 'ALWAYS FAILS' : p.flaky ? 'flaky' : 'stable';
  md += `| ${p.id} | ${p.tier} | ${Math.round(p.rate * 100)}% | ${p.passes}/${p.runs} | ${note} |\n`;
}
md += `\n**Flaky** (single-trial numbers unreliable): ${flaky.length ? flaky.map((p) => p.id).join(', ') : 'none'}\n`;
md += `**Always fails**: ${stable.alwaysFail.length ? stable.alwaysFail.join(', ') : 'none'}\n`;
await writeFile(path.join(HERE, 'STABLE.md'), md);

console.log(JSON.stringify(stable, null, 2));
