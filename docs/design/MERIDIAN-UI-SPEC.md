# MERIDIAN — FluxNode Desktop UX/UI Specification

> Status: **Approved design direction** (selected from 5-direction exploration, 2026-07-09)
> This document is the **source of acceptance criteria** for the `feat/meridian-ui` effort.
> Review gate (Opus) derives AC from the numbered rules in each section.

**Product:** FluxNode, an AI-native desktop video editor (node-based generation + timeline editing)
**Users:** solo creators and hybrid editors who generate media with local AI pipelines (ComfyUI) and cut it into finished video
**Core job:** grow media in a node graph, pull it onto a timeline, cut, preview, export
**Targets:** 1440×900 and 1728×1117, keyboard-first, Tauri v2 + React 19 + Tailwind v4 + Zustand

---

## A. Product UX thesis

FluxNode's user lives in two mental models at once. The node graph is *production*: media does not exist yet, the user is describing how it comes into being. The timeline is *arrangement*: media exists, the user is deciding when it appears. Existing tools treat these as separate applications bolted together; the view switch is the wound: the moment you flip views, you lose the thread between "this clip" and "the graph that made it."

**Thesis: the unit of the interface is not the view, it is the lineage.** Every clip on the timeline was born somewhere in the graph; every graph output lands somewhere in time. The interface makes that thread visible, traversable, and manipulable, so "regenerate this shot with a different seed" is one gesture, not a context switch, a hunt, and a re-import.

Secondary theses:

1. **Time is the ground truth.** The playhead and the preview are never hidden, never occluded, never moved by navigation.
2. **Generation is asynchronous; the UI must be honest about waiting.** Waiting states are first-class objects with identity, progress, cancel, and a landing place. No bare spinners.
3. **The keyboard is the primary instrument.** JKL, in/out, ripple shortcuts on the timeline; equivalent fluency on the graph side.

## D. Selected direction: MERIDIAN (the sliding horizon)

- **Interaction metaphor:** a horizon line. Above: the sky where media is grown (node graph). Below: the ground where media is cut (timeline). The preview stage sits *on* the horizon and never moves. There is no view switch; the user **slides the horizon** (90/10 to 10/90, with detents). Lineage threads run through the horizon: select a clip and a luminous thread rises to the node that produced it; select a node and threads drop to every clip using its output.
- **Layout model:** three horizontal strata: graph (top), stage row (fixed-height center: job ledger + preview monitor + inspector), timeline (bottom). One primary vertical splitter (the horizon).
- **Navigation model:** no view tabs. `Tab` flips horizon emphasis between detents; `` ` `` peeks the opposite stratum; command palette (`Ctrl+K`) addresses everything.
- **Visual language:** existing identity, disciplined: near-black strata + hairlines; neon `#e0ff00` reserved exclusively for selection, active signal, and the playhead; phosphor ramp for lineage; Geist UI + Geist Mono data.
- **Motion language:** horizon slides 200ms ease-out-quart; threads draw 240ms tip-to-tail; job progress creeps along node borders; playhead motion is raw and unanimated.

## E. Information architecture

```
Project
├─ Graph
│  ├─ Node (generator / processor / adapter)     addressable: n1, n2, …
│  ├─ Wire (port → port)
│  └─ Output  ──┐
├─ Takes        │  every run of an Output = a Take (media + seed + params snapshot)
│  └─ Take  ◄───┘  addressable: n7.t3
├─ Timeline
│  ├─ Track (video / audio)
│  └─ Clip (references exactly one Take or imported Asset)   addressable: c1, c2, …
├─ Assets (imported, non-generated media)
├─ Jobs (running/queued generation + render work)
└─ Exports (presets + history)
```

The lineage relation `Clip → Take → Output → Node` is bidirectional and always one hop from the current selection.

**Surface map (one screen; everything else is a stratum, drawer, or overlay):**

- **Sky (graph stratum):** node canvas, node library drawer (left edge), Takes drawer per node output.
- **Horizon (stage row, fixed):** transport + preview monitor (center), context inspector (right), job ledger (left).
- **Ground (timeline stratum):** tracks, ruler, playhead, clip lane; asset strip docked at its left edge, collapsible.
- **Overlays:** command palette, export sheet, settings sheet, onboarding coach marks, toast rail (bottom-right).

Feature-folder mapping: `workflow` = sky; `preview` + `inspector` + `status` = horizon; `timeline` = ground; `workspace` = strata shell; `header` dissolves into stage row + window chrome.

## F. Main screen layout (1440×900 reference)

```
┌──────────────────────────────────────────────────────────────── 1440 ─┐
│ ⬤⬤⬤  FluxNode · ProjectName            (custom titlebar, 36px)  ─ □ ✕ │
├────────────────────────────────────────────────────────────────────────┤
│   SKY · node graph canvas                              height: flex    │
│   ┌────────┐        ┌────────┐      ┌────────┐        (default 38%)    │
│   │ n3     │═══════▶│ n7     │═════▶│ output │─┐                       │
│   └────────┘        └────────┘      └────────┘ ┆ lineage thread        │
╞═══════════════ HORIZON (drag to slide · Tab to flip) ══════════════════╡
│ ┌ JOB LEDGER ┐ ┌────── PREVIEW STAGE ──────┐ ┌──── INSPECTOR ────┐     │
│ │ n7 gen 62% │ │      (16:9 monitor)       │ │ Clip c14          │     │
│ │ n2 queued  │ │                           │ │ take n7.t3 · s41  │     │
│ └── 216px ───┘ └─ transport · timecode ────┘ └───── 288px ───────┘     │
├────────────────────────────────────────────────────────────────────────┤
│ ▍V1  │ c12     ││ c14≡ │ ┆◄ playhead   GROUND · timeline (default 34%) │
│  ruler ··|····|····|····|····|····|····|····|····|····|····|····|···   │
├──────────────────────────────────────────────────── status bar 28px ──┤
│ ⌨ hints · GPU 71% · ComfyUI ● connected · autosave ✓ · zoom 34%        │
└────────────────────────────────────────────────────────────────────────┘
```

**Rules (AC):**

1. Stage row height is fixed per density mode (comfortable 248px, compact 204px); only sky and ground trade space.
2. Horizon detents: 80/20, 62/38 (default generate), 38/62 (default edit), 20/80. Free drag between; `Tab` cycles the two defaults; `Shift+Tab` reverses.
3. Job ledger and inspector individually collapse to 40px rails (icons + progress ticks survive collapse).

## G. Component system

**Hierarchy:**

1. **Shell:** custom titlebar, strata container, horizon splitter, status bar.
2. **Regions:** GraphCanvas, StageRow (JobLedger, PreviewStage, Inspector), TimelinePanel, drawers (NodeLibrary, Takes, AssetStrip).
3. **Compound:** Node (header, ports, param rows, progress border), Clip (thumb filmstrip, trim handles, lineage dot), TrackHeader, TransportBar, JobChip, TakeCard, ExportSheet, CommandPalette, ContextMenu, Toast.
4. **Primitives (extend `src/components/`):** Button, IconButton, Badge, Menu, ConfirmDialog, PromptDialog; new: Field, Slider, ScrubbableNumber, SegmentedControl, Kbd, Meter, Thread.

**Spacing:** 4px base. Scale: `2, 4, 6, 8, 12, 16, 20, 24, 32, 48`. Panel gutter 8px (compact 6px). Inspector form grid: 96px label / flex value.

**Typography (fixed rem, ratio ~1.2):**

| Token | Size / line | Use |
|---|---|---|
| `text-xs` | 11/16 | port labels, badges, status bar |
| `text-sm` | 12.5/18 | param labels, track headers, menus |
| `text-base` | 14/20 | inspector values, dialogs, palette |
| `text-lg` | 17/24 | node titles, sheet headings |
| `text-xl` | 20/28 | empty-state headings, onboarding |
| `mono` | 12.5/18 Geist Mono, `tabular-nums` | timecode, seeds, addresses |

Fonts: Geist (400/500/600) + Geist Mono. Two families total; no display font.

**Icons:** 16px grid, 1.5px stroke, squared terminals, fills only for state dots. Every icon button has a tooltip carrying its shortcut.

**Density modes:** `comfortable` (default) / `compact`. Compact: rows 28→24px, stage row 248→204px, gutters 8→6px, timeline track 56→44px. Font sizes never change with density.

## H. Interaction and motion system

**Keyboard map (core, remappable via `shortcuts` feature):**

- Transport: `Space`, `J/K/L`, `←/→` frame, `Shift+←/→` 10-frame, `I/O`, `Home/End`.
- Edit: `B` blade, `V` select, `W/Q` ripple trim, `Del` ripple delete, `Shift+Del` lift.
- Horizon: `Tab` flip, `` ` `` peek-hold, `Ctrl+↑/↓` nudge 10%.
- Lineage: `F` follow thread from selection, `Shift+F` open Takes drawer.
- Graph: arrows walk nodes along wires, `Enter` edits first param, `G` regenerate, `Shift+G` regenerate with new seed.
- Global: `Ctrl+K` palette, `Ctrl+E` export, `Ctrl+,` settings, `Escape` closes topmost overlay only.

**Command palette:** one input, three result classes in one ranked list: commands, objects by address or name (`c14`, `n7.t3`), and verbs with arguments (`gen n7 seed 41`). Fuzzy match, recent-first tiebreak, inline `Kbd` hints.

**Required states (AC — every surface ships all of these):**

| State | Graph node | Timeline clip | Preview | Job ledger |
|---|---|---|---|---|
| Empty | dashed drop-target "Add a generator (N)" | lane hint "Drag a take here, or press F from a node" | slate + "No frame under playhead" | "No jobs. G regenerates the selected node." |
| Loading | determinate progress creeps along node border | thumbnail skeleton shimmer | last frame held, 40% dim, timecode blinking | JobChip: meter + ETA + cancel |
| Active | border accent, thread lit | selection outline, handles visible | playing | chip pulse 1/s |
| Error | border danger + badge; inline log excerpt (never modal) | red hatch if take missing; "Relink / Regenerate" in context menu | red outline + reason line | danger chip with Retry/Logs |
| Success | 400ms accent flash on output port, thread pulses to landed clip | landing shimmer once | unchanged | "landed" entry, auto-clear 8s, hover pins |
| Long-running | loading + ETA; queued shows position | n/a | n/a | ledger is source of truth; taskbar mirrors front job |

**Pointer states (AC — all interactive elements):**

- **Hover:** background lifts one surface step (150ms); never accent. Honest cursors (`col-resize`, `ew-resize`, `grab/grabbing`).
- **Focus:** 2px accent outline at 3px offset (existing global rule kept). Focus ≠ selection visually.
- **Selected:** 1.5px accent outline; multi-select shows count in inspector header.
- **Disabled:** 40% opacity, no hover, tooltip explains why.
- **Drag:** source ghosts 50%; 1:1 preview follows cursor; valid targets show 1.5px inset accent ring; invalid targets show nothing.
- **Drop:** timeline drops magnetic (playhead, edges, marks; `Alt` disables snap); graph drops onto a wire splice in. Invalid drop plays existing snapback shake.
- **Context menu:** everywhere, generated from the command registry, shortcut shown on every row; last group is always the lineage jump ("Reveal in graph / timeline").

**Motion tokens:** `fast 120ms`, `base 200ms`, `draw 240ms`, all `cubic-bezier(0.165, 0.84, 0.44, 1)`. Only transform/opacity (+ stroke-dashoffset for threads). Playhead/scrub never eased. `prefers-reduced-motion`: threads instant, horizon snaps, shakes become a static danger tint.

## I. Visual design tokens

Extends the existing `@theme` in `src/styles/index.css`; existing tokens unchanged. **Accent means "signal is live or selected," nothing else.** Glassmorphism is retired; depth = surface ramp + hairlines.

```css
@theme {
  /* Surfaces (existing) */
  --color-bg: #0d0d0d;            /* ground stratum */
  --color-surface: #1c1c1e;       /* raised: chips, menus, palette */
  --color-surface-2: #17181b;     /* stage row */
  --color-surface-3: #111214;     /* sky stratum */
  --color-panel: #0d0e10;         /* drawers, inspector wells */

  /* Brand (existing) + phosphor ramp (new) */
  --color-accent: #e0ff00;
  --color-accent-soft: #f5ffd5;
  --color-phosphor: #aeca2a;      /* lineage threads, take dots */
  --color-phosphor-dim: #5a6a1c;  /* thread at rest */
  --color-cloud: #3b82f6;         /* remote/cloud affordances only */

  /* Semantic (existing) */
  --color-success: #34d399;
  --color-warn: #fbbf24;
  --color-danger: #f87171;

  /* Text (existing) + data tier (new) */
  --color-text-primary: #ffffff;
  --color-text-secondary: #a2abb6;
  --color-text-data: #c8d1da;

  /* Borders (existing) + hairline (new) */
  --color-border-subtle: rgba(255,255,255,0.08);
  --color-border: rgba(255,255,255,0.10);
  --color-hairline: rgba(255,255,255,0.14);

  /* Motion — named --ease-out-quart, NOT --ease-out, to avoid clobbering
     Tailwind v4's built-in `ease-out` utility (item-1 review decision) */
  --ease-out-quart: cubic-bezier(0.165,0.84,0.44,1);
  --dur-fast: 120ms; --dur-base: 200ms; --dur-draw: 240ms;

  /* Radii — sm/md/lg naming; -s/-l would collide with Tailwind side
     utilities `rounded-s` / `rounded-l` (item-1 review decision) */
  --radius-sm: 4px; --radius-md: 6px; --radius-lg: 10px;

  /* Z scale (semantic) */
  --z-drawer: 10; --z-thread: 20; --z-sticky: 30;
  --z-overlay-backdrop: 40; --z-overlay: 50; --z-toast: 60; --z-tooltip: 70;
}
```

Contrast (AC): `text-secondary` ≥ 4.5:1 on every surface it appears on; accent never used for text on light chips; semantic colors ≥ 4.5:1 on their surfaces.

Shadows: one token, `shadow-overlay: 0 8px 24px rgba(0,0,0,0.5)`, only on floating overlays. Panels never cast shadows. No border + large-shadow pairs.

## J. Desktop behavior rules

1. Custom titlebar (Tauri `decorations: false`), full-width drag region, double-click maximizes, Windows snap respected. Minimum window 1024×640.
2. Resize: stage row fixed-height; sky/ground split remaining height by horizon ratio. Below 1200px width: inspector overlays instead of docking. Below 720px height: horizon locks to last-emphasized stratum, the other collapses to a 32px peek strip; `Tab` still flips.
3. Panel sizes + horizon ratio persist per project.
4. All splitters keyboard-operable: focusable, arrows = 8px, `Shift+arrows` = 40px, `Enter` cycles detents.
5. `Ctrl+Shift+P` pops preview into a second borderless window; stage row collapses to transport-only.
6. Taskbar progress mirrors front job; title shows dirty state (`● ProjectName`); Explorer file drops land as Assets (ground) or source nodes (sky); native file dialogs only.
7. Nothing blocks: export/generation never modal-lock. Only modals: destructive confirms + first-run onboarding.

## K. Accessibility

1. Full keyboard operability: splitters, graph traversal, trimming, and drag alternatives via palette verbs.
2. Focus always visible; never suppressed; visually distinct from selection.
3. Landmarks per stratum; palette = combobox/listbox; ledger `aria-live="polite"`, errors `assertive`.
4. Lineage thread is decoratively redundant: same relation always available as text + menu action. No color-only information; state dots pair with shape (●/▲/■).
5. `tabular-nums` for numerics; min text 11px; min hit target 24×24 even compact.
6. `prefers-reduced-motion` honored; `prefers-contrast: more` bumps hairlines to 0.24 alpha, disables phosphor-dim.

## L. Implementation notes

1. **Strata shell:** CSS grid rows `auto minmax(0,var(--sky)) auto minmax(0,var(--ground)) auto`; horizon drag writes one CSS variable via rAF, no React re-render during drag; ratio persisted in the `workspace` Zustand slice.
2. **Timeline:** virtualize clips by visible range; ruler/waveforms on canvas; playhead is a transform-only overlay driven by rAF outside React state (`useSyncExternalStore` for timecode readout only).
3. **Lineage thread:** one full-viewport SVG overlay at `--z-thread`, `pointer-events: none`; endpoints resolved from a rect registry both panels write to; cubic path through the stage row edge; `stroke-dashoffset` draw-in. Off-screen endpoint terminates in an edge pill ("n7 ▲") that clicks/`F`-jumps.
4. **Command registry:** single source `{ id, title, verb, args?, shortcut, scope, run() }` consumed by palette, context menus, shortcut handler, and the headless `--mcp` Action registry. Menu/palette/shortcut parity is automatic.
5. **Jobs:** Rust owns the queue; progress over a Tauri channel ≤10Hz; chips subscribe individually; `window.set_progress_bar` for taskbar.
6. **Overlays:** native `<dialog>` + popover API (no stacking-context clipping).
7. **Density:** `data-density` attribute on the shell; spacing via CSS variables.
8. **Migration:** reuses `features/` per Section E. New builds: horizon shell (replaces view switching in `workspace`) and thread overlay + rect registry. Everything else restyles existing components.

## M. Anti-generic guardrails (review-blocking defects)

1. Horizon must be more than a tab switch: mixed states must be useful (threads, drag-across-horizon).
2. No accent creep: `#e0ff00` only on selection / live signal / playhead. Primary buttons are white-on-surface.
3. Nodes: fixed 3-tier anatomy (title, ≤4 promoted params, ports); wires route orthogonally in lanes.
4. Stage row holds exactly three organs (ledger, monitor, inspector). New features = drawers, palette verbs, or inspector sections.
5. No indeterminate-only spinners: JobChip must show determinate progress or queue position + elapsed.
6. Every empty state names the key that fixes it.
7. Detents wherever splitters exist; "Reset layout" in palette; per-project persistence.
8. Signature must survive grayscale: horizon, threads, mono data tier carry identity, not color.
9. Palette verbs must also exist as direct manipulation or menu path unless expert accelerators by design.
10. One motion event per user action; success flashes one-shot ≤400ms; app fully legible with reduced motion.
