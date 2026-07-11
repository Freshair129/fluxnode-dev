# MASTER_PLAN — FluxNode: Beat-Palmier MVP

> Phase 0 deliverable (RWANG:MasterPlan). Status: **APPROVED by owner 2026-07-11** ("อนุมัติ", §10 gate cleared — remaining Phase 0 documents may now be generated). Scope anchors in §0 are binding; changes require an `ARCHITECTURE_CHANGE_REQUEST.md`.
>
> Owner inputs read in full: `MASTERPLAN.md` (product spec), `STATUS.md` (2026-07-09 baseline), `HANDOFF.md` (2026-07-06 agent-layer state), `docs/AI Copilot and Media Adapter Design.md`, `docs/AI Copilot Binary Setup.md`, competitive analysis of Palmier Pro (2026-07-11, sourced from palmier.io / GitHub / YC / third-party reviews; battle card + exec summary artifacts).

---

## 0. Mission & Competitive Frame

**Mission:** ship the fastest possible MVP that competes with Palmier Pro **only at a better level** — categorical wins on axes Palmier structurally cannot follow, parity on table stakes, honesty everywhere else.

**The bet (from the competitive analysis):** Palmier Pro = Swift/Metal, macOS-26-Apple-Silicon-only, timeline-only, cloud-credit generation (Veo/Kling/Seedance), no brain of its own (depends on the user's Claude/Codex/Cursor), no color/transitions/masking, generation metadata dies on NLE export, regenerated clips drift in duration. FluxNode = Tauri/Rust cross-platform, timeline ⟷ node graph, local-first agent layer already E2E-verified, media engine wired but **not yet shipping real local backends**.

**Definition of "better":** the MVP must (a) generate media locally at $0/clip where Palmier meters credits, (b) include an in-app offline copilot where Palmier requires external subscriptions, (c) make regeneration non-destructive and export-safe where Palmier documentedly loses metadata, and (d) run on Windows/Linux/macOS where Palmier runs on one OS generation. Cloud-SOTA generation quality is explicitly **not** a competition axis for this MVP (rejected: reselling cloud credits — it would erase our differentiation and margin; revisit post-MVP as optional BYO-key).

### Killer Features (frozen scope anchors)

| ID | Killer Feature | What ships | Why Palmier cannot follow |
|---|---|---|---|
| **KF-1** | **Zero-Credit Studio** — local on-GPU generation | Image gen (sd.cpp fast path + ComfyUI power path), TTS (piper), STT (whisper) surfaced in node graph + timeline insert; GpuArbiter evicts the brain during heavy jobs; unlimited regenerate, offline, $0/clip | Their revenue **is** metered cloud credits; they have no local backend layer, and refunding that architecture guts their business model |
| **KF-2** | **Built-in Offline Copilot** — batteries-included agent | In-app chat panel driving the existing 30-action registry via local Ollama (default `qwen3.5:4b`), tool-activity feed, propose→confirm flow for write actions; still exposes MCP for users who *do* have Claude/Cursor | Palmier ships **no brain** — it assumes the user already pays for Claude/Codex/Cursor; we work out of the box with zero accounts, zero internet |
| **KF-3** | **Regeneration-Safe Pipeline** — prompt-preserving, duration-locked regen + metadata round-trip | Every AI clip carries prompt/model/seed/params as node data; regenerate-in-place with a duration-lock policy (auto trim/pad) so downstream cuts never drift; NLE XML export writes a generation-metadata sidecar that re-imports losslessly | Attacks their two *documented* weaknesses (metadata loss on export, regen timing drift); requires clips-as-nodes semantics a timeline-only editor cannot represent |

**Structural moats reinforcing all three:** cross-platform (Win/Linux/macOS) and the node graph itself.

### Table-stakes parity (MVP must not lose on these)

- On-device transcription (whisper.cpp) → transcript-based media search. (Palmier has SigLIP-2 semantic search; transcript search is the MVP answer, embedding search is post-MVP.)
- NLE XML export (FCP7-XML dialect readable by Premiere/Resolve) — carrier for KF-3's sidecar.
- Editor capabilities we already have and Palmier lacks (transitions/effects via node graph, render resilience, undo/WAL) get *stated*, not rebuilt.

---

## 1. Roadmap (RWANG phases mapped to this project)

Reality shaping the roadmap: this is a **brownfield** project — the core editor is Implemented (per `STATUS.md`), the agent layer is E2E-verified headless, and deep design docs already exist. RWANG Phases 0–6 therefore **adopt-and-freeze** existing owner design wherever it is already decided (referencing, not rewriting), and only author net-new architecture for the MVP delta: media backend productization, copilot UI surface, regen pipeline, transcription/search, NLE export. This is the primary schedule accelerant: the doc phases target **~1 week total**, then implementation runs in 6 waves.

- **Phase 0 — Discovery (this phase):** freeze MVP scope = KF-1/2/3 + table stakes; bind domain docs; glossary; requirements. Explicitly OUT of MVP: in-process llama.cpp (Ollama suffices — kill the stub work), video-model local generation (image/audio first; video via ComfyUI power path only), embedding-based semantic search, cloud generation, mobile.
- **Phase 1 — System Architecture:** freeze module boundaries for the MVP delta on top of the existing crate/app structure (no re-architecture of what ships today).
- **Phase 2 — Contracts:** freeze the regen-metadata schema (node data + XML sidecar), agent-confirm event protocol, media-backend trait surface, transcript index format, NLE XML dialect.
- **Phase 3 — Multi-Agent Architecture:** freeze the build-time agent model (how implementation work is dispatched — see §12 micro-backlog policy) *and* the runtime copilot loop (already largely built; adopt-and-freeze).
- **Phase 4 — Implementation Specification:** per-module specs for the six waves; algorithms (duration-lock trim/pad, GPU eviction thresholds, transcript indexing); storage (sidecar files, model cache layout).
- **Phase 5 — QA:** test strategy per wave; acceptance criteria = the Beat-Palmier scorecard (§4 milestones); benchmark plan (gen latency/VRAM on the 3 hardware tiers already named in `MASTERPLAN.md` §11).
- **Phase 6 — Handoff & Task Decomposition:** the **micro backlog** — every task XS/S, single-responsibility, deterministic acceptance, `LOCAL_SAFE` majority (target **≥70% by count**) so local models execute most of it; queue consumable wave-by-wave.
- **Phase 7 — Implementation:** six waves (§3), each compiling/verified/reviewed before the next.

## 2. Dependency Graph

```
Phase 0 ──► 1 ──► 2 ──► 3 ──► 4 ──► 5 ──► 6 ──► 7 (waves W0…W5)

W0 Sidecar foundation ──► W2 KF-1 gen UI      (binaries must exist before gen UI E2E)
W0 ──► W3 transcription/search                 (whisper binary is the W3 engine)
W1 KF-2 copilot UI ──► W2 (agent drives gen)   (confirm-flow gates agent-triggered gen)
W2 + W3 ──► W4 KF-3 regen pipeline             (regen needs gen path; sidecar rides NLE export)
W1..W4 ──► W5 hardening/beta
External: Ollama runtime (user-installed; detected+guided) · BtbN ffmpeg builds (already wired) ·
whisper.cpp / piper / stable-diffusion.cpp release binaries (fetched, not committed) ·
SD model weights (downloader, never bundled) · GitHub Actions runners (CI proof on 3 OS)
```

**Critical path:** W0 → W2 → W4. Slack lives in W3 (can overlap W2) and W1 (can start immediately — no binary dependency).

## 3. Phase Breakdown & Deliverables

Domain slot binding (freezes with Phase 0 approval): **`22_<PIPELINE>` → `22_MEDIA_GENERATION_PIPELINE.md`**.

| Phase | Deliverables | Exit criteria |
|---|---|---|
| 0 | `MASTER_PLAN.md` (this), `PROJECT_SCOPE.md`, `PROJECT_GLOSSARY.md`, `SYSTEM_REQUIREMENTS.md`, `NON_FUNCTIONAL_REQUIREMENTS.md`, `ARCHITECTURE_PRINCIPLES.md` | MVP scope + killer features frozen; out-of-scope list frozen; domain titles bound; no ambiguity an implementer must resolve |
| 1 | `01_PROJECT_OVERVIEW` … `07_MODULE_MAP` | MVP-delta module boundaries frozen against the existing codebase; adopt-and-freeze notes for existing architecture |
| 2 | `08_INTERFACE_CONTRACTS` … `13_ERROR_MODEL` | Regen-metadata schema, confirm-flow events, backend traits, sidecar format, XML dialect all frozen |
| 3 | `14_AGENT_ARCHITECTURE` … `20_REVIEW_PIPELINE` | Build-time dispatch rules + runtime copilot loop frozen; capability profiles defined model-agnostically |
| 4 | `21_MODULE_SPECIFICATIONS`, `22_MEDIA_GENERATION_PIPELINE`, `23_ALGORITHMS`, `24_STORAGE`, `25_LOGGING_AND_TELEMETRY` | Every W0–W5 module spec'd: responsibilities, invariants, failure modes, examples |
| 5 | `26_TEST_STRATEGY` … `30_PERFORMANCE` | Beat-Palmier scorecard = acceptance criteria; benchmark matrix bound to hardware tiers |
| 6 | `31_IMPLEMENTATION_PLAN` … `38_FUTURE_EXTENSIONS` + `queue/IMPLEMENTATION_QUEUE.json` + `queue/PROJECT_GRAPH.json` | Micro backlog complete: all tasks XS/S, deterministic acceptance, ≥70% `LOCAL_SAFE`, wave-ordered, queue dispatchable |
| 7 | Working software per wave (below) | Each wave compiles, passes CI, verified per §5 checkpoints |

### Phase 7 waves (MVP implementation)

| Wave | Name | Ships | Feeds |
|---|---|---|---|
| W0 | Sidecar Foundation | whisper/piper/sd.cpp fetch scripts (per-OS, mirroring `fetch-ffmpeg.ps1`), flag verification against real binaries, model-downloader (SD weights, whisper models — never committed), CI proof on 3 OS, kill llama.cpp stub from scope | KF-1, table stakes |
| W1 | Copilot Surface | Chat panel in `src/features/copilot/` calling `agent_chat`, tool-activity feed, propose→confirm flow for Mutating/LongJob actions, model picker + Ollama health check + guided install, `--mcp` runtime-verified against a real client | KF-2 |
| W2 | Zero-Credit Studio | Generate-image node E2E via sd.cpp (fast) + ComfyUI (power), TTS/STT actions surfaced in UI, timeline insert of generated assets, GpuArbiter eviction verified under real VRAM pressure | KF-1 |
| W3 | Transcribe & Find | Whisper transcription job + UI, transcript store, transcript search across project media, 16 kHz ffmpeg pre-convert (closes HANDOFF TODO) | table stakes |
| W4 | Regen-Safe Pipeline | Regen metadata on clips/nodes, regenerate-in-place with duration-lock policy, NLE XML (FCP7) export + generation-metadata sidecar + lossless re-import | KF-3 |
| W5 | Beta Hardening | Cross-OS release proof (macOS/Linux bundle targets + fetch scripts), perf pass vs §11 tiers, onboarding for the three killer features, beta packaging + docs | ship |

## 4. Milestones

| ID | Milestone | Proof (deterministic where possible) | Target |
|---|---|---|---|
| M0 | Docs frozen (Phases 0–6 approved) | All RWANG docs approved; queue dispatchable | **+1 week** |
| M1 | Copilot in-app (W1) | Chat panel executes a read action and a confirmed write action E2E on all 3 OS dev builds | +2 weeks |
| M2 | First local generation (W0+W2) | Prompt → sd.cpp image lands on timeline with zero network, on Windows + one other OS; VRAM eviction observed | +4 weeks |
| M3 | Table stakes closed (W3) | A spoken phrase found via transcript search; project exports XML that opens in Resolve | +5 weeks |
| M4 | Beat-Palmier scorecard green (W4) | Regenerate a clip: duration locked, cuts intact; export→re-import round-trip preserves regen ability. **Scorecard:** ≥2 axes Strong-vs-Absent in our favor (local gen, offline copilot, regen safety), 0 axes Absent-vs-Strong against us on table stakes | +6 weeks |
| M5 | Public beta (W5) | Signed/notarized-or-documented builds for Win/macOS/Linux from the release workflow | **+8 weeks** |

## 5. Estimated Complexity

| Phase/Wave | Est. | Rationale |
|---|---|---|
| Phases 0–6 | **M** total | Brownfield adopt-and-freeze; most decisions exist in owner docs; net-new contracts are the real work (Phase 2 is the L inside the M) |
| W0 | M | Script + CI mechanics are known-shape (ffmpeg precedent); flag verification against real binaries is the unknown |
| W1 | M | UI panel + event stream; agent core already works |
| W2 | **L** | Real GPU behavior, model management, two backend paths, arbiter under pressure — the riskiest wave |
| W3 | S–M | whisper is well-trodden; search is an index + filter |
| W4 | M | Schema + deterministic trim/pad policy + XML dialect testing against Resolve/Premiere |
| W5 | M | Release-matrix debugging across 3 OS |

## 6. Risks

| Risk | L | I | Mitigation |
|---|---|---|---|
| Local gen quality disappoints vs cloud-SOTA expectations | M | H | Position KF-1 for iteration/b-roll/drafts; ComfyUI power path for quality; post-MVP optional BYO-key cloud; never demo head-to-head vs Veo |
| W2 GPU matrix pain (VRAM tiers, driver quirks) | H | M | Bind benchmarks to the 3 hardware tiers already in `MASTERPLAN.md` §11; sd.cpp small models first; arbiter degrades to CPU/brain-eviction |
| Sidecar flag assumptions wrong (HANDOFF gotcha) | M | M | W0 verifies against real binaries *before* any UI work depends on them |
| Model weights size/licensing | M | M | Downloader with checksums + license display; never bundle weights; document approved model list in Phase 2 |
| Palmier announces Windows port | L | H | Their Swift/Metal/CoreML stack makes it a rewrite; monitor quarterly (memory: competitor-palmier-pro); our speed is the real defense |
| Solo-owner bandwidth | H | H | This entire protocol: micro backlog, ≥70% LOCAL_SAFE, deterministic verification so local agents carry volume |
| Scope creep past killer features | M | H | Frozen out-of-scope list in Phase 0; ACR required to reopen |

## 7. Review Checkpoints

| Gate | Owner checks |
|---|---|
| Master Plan (now) | Killer features = the right 3? Out-of-scope list acceptable (esp. llama.cpp killed, video-gen via ComfyUI only)? 8-week target credible? |
| Phase 0 exit | Scope/glossary/requirements complete; nothing an implementer must decide |
| Phase 2 exit | Regen schema + XML dialect + confirm protocol reviewed against a real Resolve import test plan |
| Phase 6 exit | Backlog: every task XS/S with deterministic acceptance; LOCAL_SAFE ratio ≥70%; wave order respects §2 |
| Each W-exit | Wave's milestone proof (M1–M5) demonstrated, CI green on 3 OS |

---

## Appendix A — Micro-backlog policy & sample granularity (Phase 6 preview)

Full decomposition is a Phase 6 deliverable (`33_TASK_BREAKDOWN.md`, ~120–180 tasks projected). Binding policy now: single responsibility; XS/S only (split anything larger); deterministic acceptance (compiler/tests/schema/snapshot — never LLM-judged); explicit deps; `LOCAL_SAFE` ≥70% by count. Sample of the intended granularity:

- `LOCAL_SAFE` (Rust): whisper CLI arg-builder from a typed config struct + unit tests; SHA-256 checksum verifier for model downloads; sidecar JSON (de)serializer with schema tests; status-file parser for sd.cpp progress lines.
- `LOCAL_SAFE` (TS): FCP7-XML clip serializer (pure function + snapshots); transcript index insert/query functions; regen-metadata Zod schema + validators; duration-lock trim/pad calculator + property tests.
- `CLOUD_REQUIRED`: copilot panel information architecture; confirm-flow threat model; GpuArbiter eviction-threshold algorithm; XML dialect decisions against Resolve quirks.

## Appendix B — Rejected alternatives (logged per §5 operating principles)

- **Resell cloud models (match Palmier feature-for-feature):** rejected — erases differentiation, negative margin vs YC-funded rival, contradicts local-first thesis. Revisit only as post-MVP BYO-key.
- **In-process llama.cpp for MVP:** rejected — Ollama already runs llama.cpp out-of-process and is E2E-verified; the stub + CMake/libclang toolchain burden buys nothing user-visible. Post-MVP option for single-binary distribution.
- **Embedding-based semantic search in MVP:** rejected for scope — transcript search covers the dominant "find what was said" case; SigLIP-class visual search is a fast-follow.
- **Rewriting existing architecture docs into RWANG format wholesale:** rejected — adopt-and-freeze by reference; net-new writing only where the MVP delta lives.
