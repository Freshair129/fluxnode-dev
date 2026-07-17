// FluxNode agent valid-plan benchmark runner.
// Usage: node run.mjs [--exe <path>] [--model <ollama tag>]
// Runs each prompt in prompts.json through `fluxnode --agent "<prompt>"` with
// FLUXNODE_AGENT_TRACE=1, parses the AGENT_TRACE JSONL from stderr, and scores
// the tool plan against the prompt's expectations. Writes results.json + RESULTS.md.

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

const EXE = argOf('--exe', 'D:/fluxnode-dev/src-tauri/target/debug/fluxnode.exe');
const MODEL = argOf('--model', 'qwen3.5:4b');
const MEDIA = path.join(HERE, 'media').replaceAll('\\', '/');
const FFMPEG_DIR = 'D:/fluxnode-dev/src-tauri/binaries';
const TIMEOUT_MS = 300_000;

const READ_ONLY = [
  'inspect_asset_path', 'asset_probe', 'load_project_state', 'load_recent_projects',
  'get_current_project_path', 'video_decode_frame', 'render_get_status', 'comfy_ping',
  'health_ping', 'load_app_preferences', 'transcribe',
];
const MUTATING = [
  'open_project_at_path', 'create_project_at_path', 'save_project_state',
  'save_project_state_as', 'autosave_project_state', 'mark_project_opened',
  'asset_generate_waveform', 'asset_generate_thumbnail', 'asset_copy_into_project',
  'render_cancel', 'render_pause', 'render_resume', 'save_app_preferences', 'synthesize',
];
const LONG_JOB = ['asset_generate_proxy', 'render_start', 'start_export_job', 'comfy_generate', 'generate_image'];
const VALID = new Set([...READ_ONLY, ...MUTATING, ...LONG_JOB]);
const WRITE_SET = new Set([...MUTATING, ...LONG_JOB]);

function runAgent(prompt) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(EXE, ['--agent', prompt], {
      env: {
        ...process.env,
        FLUXNODE_AGENT_TRACE: '1',
        FLUXNODE_BRAIN_MODEL: MODEL,
        FLUXNODE_FFMPEG_DIR: FFMPEG_DIR,
      },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut, ms: Date.now() - started });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + `\nspawn error: ${err}`, code: -1, timedOut, ms: Date.now() - started });
    });
  });
}

function parseTrace(stderr) {
  const events = [];
  for (const line of stderr.split(/\r?\n/)) {
    if (!line.startsWith('AGENT_TRACE ')) continue;
    try {
      events.push(JSON.parse(line.slice('AGENT_TRACE '.length)));
    } catch {
      /* ignore malformed lines */
    }
  }
  return events;
}

function matchRequirement(req, call) {
  if (call.name !== req.name) return false;
  const argsStr = JSON.stringify(call.arguments ?? {}).toLowerCase();
  for (const s of req.argsInclude ?? []) {
    if (!argsStr.includes(s.toLowerCase())) return false;
  }
  for (const [key, range] of Object.entries(req.argNumbers ?? {})) {
    const v = Number(call.arguments?.[key]);
    if (!Number.isFinite(v) || v < range.min || v > range.max) return false;
  }
  return true;
}

function score(spec, events, finalAnswer, timedOut) {
  const calls = events.filter((e) => e.event === 'tool_call');
  const reasons = [];

  const hallucinated = [...new Set(calls.map((c) => c.name).filter((n) => !VALID.has(n)))];
  if (hallucinated.length) reasons.push(`hallucinated tool(s): ${hallucinated.join(', ')}`);

  if (spec.forbidWrites) {
    const writes = [...new Set(calls.map((c) => c.name).filter((n) => WRITE_SET.has(n)))];
    if (writes.length) reasons.push(`attempted write tool(s) on a no-capability prompt: ${writes.join(', ')}`);
  }

  // Greedy-match each requirement to a distinct call, preserving order if asked.
  const used = new Set();
  const matchedIdx = [];
  for (const req of spec.required ?? []) {
    const idx = calls.findIndex((c, i) => !used.has(i) && matchRequirement(req, c));
    if (idx === -1) {
      reasons.push(`missing required call: ${req.name}(${(req.argsInclude ?? []).join(',')})`);
    } else {
      used.add(idx);
      matchedIdx.push(idx);
    }
  }
  if (spec.ordered && matchedIdx.length === (spec.required ?? []).length) {
    for (let i = 1; i < matchedIdx.length; i++) {
      if (matchedIdx[i] < matchedIdx[i - 1]) {
        reasons.push('required calls happened out of order');
        break;
      }
    }
  }

  if (timedOut) reasons.push(`timed out after ${TIMEOUT_MS / 1000}s`);
  if (!timedOut && !finalAnswer.trim()) reasons.push('no final answer produced');

  return { pass: reasons.length === 0, reasons, hallucinated, toolNames: calls.map((c) => c.name) };
}

const { prompts } = JSON.parse(await readFile(path.join(HERE, 'prompts.json'), 'utf8'));
await mkdir(path.join(HERE, 'logs'), { recursive: true });

console.log(`exe:   ${EXE}`);
console.log(`model: ${MODEL}`);
console.log(`media: ${MEDIA}\n`);

// Warmup (loads the model into VRAM; not scored).
console.log('warmup...');
const warm = await runAgent('Reply with the single word: ready');
console.log(`warmup done in ${(warm.ms / 1000).toFixed(1)}s\n`);

const results = [];
for (const spec of prompts) {
  const prompt = spec.prompt.replaceAll('{{MEDIA}}', MEDIA);
  process.stdout.write(`[${spec.id}] ... `);
  const run = await runAgent(prompt);
  const events = parseTrace(run.stderr);
  const finalAnswer = run.stdout.trim();
  const s = score(spec, events, finalAnswer, run.timedOut);
  results.push({
    id: spec.id,
    tier: spec.tier,
    lang: spec.lang ?? 'en',
    prompt,
    pass: s.pass,
    reasons: s.reasons,
    toolCalls: events.filter((e) => e.event === 'tool_call').map((e) => ({ name: e.name, arguments: e.arguments })),
    toolResults: events.filter((e) => e.event === 'tool_result').map((e) => ({ name: e.name, ok: e.ok, result: e.result })),
    finalAnswer,
    durationMs: run.ms,
    timedOut: run.timedOut,
    exitCode: run.code,
  });
  await writeFile(
    path.join(HERE, 'logs', `${spec.id}.log`),
    `PROMPT: ${prompt}\n\n--- STDOUT ---\n${run.stdout}\n--- STDERR ---\n${run.stderr}\n`,
  );
  console.log(`${s.pass ? 'PASS' : 'FAIL'} (${(run.ms / 1000).toFixed(1)}s)${s.pass ? '' : ' — ' + s.reasons.join('; ')}`);
}

const byTier = {};
for (const r of results) {
  byTier[r.tier] ??= { pass: 0, total: 0 };
  byTier[r.tier].total++;
  if (r.pass) byTier[r.tier].pass++;
}
const total = results.length;
const passed = results.filter((r) => r.pass).length;
const thai = results.filter((r) => r.lang === 'th');
const summary = {
  model: MODEL,
  overall: { pass: passed, total, rate: +(passed / total).toFixed(3) },
  byTier: Object.fromEntries(
    Object.entries(byTier).map(([t, v]) => [t, { ...v, rate: +(v.pass / v.total).toFixed(3) }]),
  ),
  thai: { pass: thai.filter((r) => r.pass).length, total: thai.length },
  hallucinationPrompts: results.filter((r) => r.reasons.some((x) => x.startsWith('hallucinated'))).map((r) => r.id),
  avgDurationSec: +(results.reduce((a, r) => a + r.durationMs, 0) / total / 1000).toFixed(1),
};

await writeFile(path.join(HERE, 'results.json'), JSON.stringify({ summary, results }, null, 2));

const tierNames = {
  1: 'T1 single read-only call',
  2: 'T2 arg extraction',
  3: 'T3 multi-step chain',
  4: 'T4 gated write proposal',
  5: 'T5 trap / no matching tool',
};
let md = `# Agent Valid-Plan Benchmark — ${MODEL}\n\n`;
md += `Overall valid-plan rate: **${passed}/${total} (${Math.round((passed / total) * 100)}%)** · avg ${summary.avgDurationSec}s/prompt\n\n`;
md += `| Tier | Pass | Rate |\n|---|---|---|\n`;
for (const [t, v] of Object.entries(summary.byTier)) {
  md += `| ${tierNames[t] ?? t} | ${v.pass}/${v.total} | ${Math.round(v.rate * 100)}% |\n`;
}
md += `\nThai prompts: ${summary.thai.pass}/${summary.thai.total}\n\n## Per-prompt\n\n`;
md += `| ID | Tier | Result | Tools called | Time | Notes |\n|---|---|---|---|---|---|\n`;
for (const r of results) {
  md += `| ${r.id} | ${r.tier} | ${r.pass ? '✅' : '❌'} | ${r.toolCalls.map((c) => c.name).join(' → ') || '(none)'} | ${(r.durationMs / 1000).toFixed(1)}s | ${r.reasons.join('; ')} |\n`;
}
await writeFile(path.join(HERE, 'RESULTS.md'), md);

console.log('\n=== SUMMARY ===');
console.log(JSON.stringify(summary, null, 2));
