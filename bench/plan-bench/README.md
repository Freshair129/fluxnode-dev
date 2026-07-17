# Agent Valid-Plan Benchmark

Measures whether the local agent brain produces a **valid tool plan** — the right tool(s), the
right arguments, and correct behavior on gated writes and no-capability traps — rather than just
whether it emits fluent text. Answers the beta-scoping question: *is the 4B local brain good
enough to drive a propose-then-confirm copilot?*

## What it checks

20 prompts across 5 difficulty tiers, run through `fluxnode --agent "<prompt>"` with
`FLUXNODE_AGENT_TRACE=1` (a stderr `AGENT_TRACE {json}` line per loop event, added in
`src-tauri/src/brain/mod.rs`). Each run is scored against `prompts.json`:

| Tier | What it exercises |
|---|---|
| T1 | single read-only tool call |
| T2 | argument extraction (incl. a 5-arg call) |
| T3 | multi-step read chain + synthesis |
| T4 | gated write proposal (no `--allow-writes`; the model must propose, not force) |
| T5 | trap — no matching tool exists; the model must decline, not hallucinate one |

A run **passes** only if every required call is present with matching args, no write tool fired
on a T5 trap, and no tool name outside the registry was invented.

## Run it

```sh
# Prereqs: Ollama running with the model; fluxnode.exe built; ffmpeg sidecar available.
./make-media.sh                                   # regenerate test fixtures (media/ is gitignored)
node run.mjs                                       # one pass  -> results.json + RESULTS.md
node run.mjs --model <ollama-tag>                  # try another brain
for i in 1 2 3; do node run.mjs; cp results.json results.multi$i.json; done
node aggregate.mjs results.multi*.json             # stable N-run rates -> STABLE.md + stable.json
```

`run.mjs` env: `FLUXNODE_BRAIN_MODEL` (default `qwen3.5:4b`), `FLUXNODE_FFMPEG_DIR`, and the
`--exe` / `--model` flags. Single-trial numbers are noisy on a 4B model — **aggregate ≥3 runs**;
`aggregate.mjs` flags any prompt that isn't 0% or 100% as flaky.

## Latest result

`qwen3.5:4b`, 3-run aggregate: **95% (57/60)**, dead consistent per run, **0 hallucinated tools
in 100 runs**. Every tier 100% except T4, whose only miss is `t4-save` — a deterministic headless
artifact (no project open, so the model correctly declines and offers to open one), not a model
failure. See `STABLE.md`.
