# Design

Visual system captured from `src/styles/index.css` (Tailwind v4 `@theme` tokens) and the shipped
components. Tokens are the source of truth; prefer `bg-surface`, `text-accent/…` utilities over
new hex values.

## Theme

Dark-only instrument panel. Near-black backgrounds, one neon accent reserved for live/active
state, blue reserved for cloud/compute context. No light mode.

## Color

| Role | Token | Value |
| --- | --- | --- |
| Background | `--color-bg` | `#0d0d0d` |
| Surface | `--color-surface` | `#1c1c1e` |
| Surface 2 (panels) | `--color-surface-2` | `#17181b` |
| Surface 3 | `--color-surface-3` | `#111214` |
| Panel (deep) | `--color-panel` | `#0d0e10` |
| Accent (neon) | `--color-accent` | `#e0ff00` |
| Accent soft (text on accent tints) | `--color-accent-soft` | `#f5ffd5` |
| Cloud blue | `--color-cloud` | `#3b82f6` |
| Success / Warn / Danger | | `#34d399` / `#fbbf24` / `#f87171` |
| Text primary / secondary / data | | `#ffffff` / `#a2abb6` / `#c8d1da` |
| Borders | subtle / default / hairline | `white/8%`, `white/10%`, `white/14%` |

Rules: accent = primary action, current selection, live state only. Cloud blue = cloud compute
context only. Semantic colors only for status. Footage areas (`#0c0d0f` monitor wells) stay
chroma-free.

## Typography

Inter (display) / Geist (body), falling back to Segoe UI / system-ui; neither is self-hosted yet.
Product register: fixed rem scale, tight ratio. UI labels 11-12px, body 13-14px, panel titles
12-13px semibold, timecodes mono `tabular-nums`. Uppercase + letter-spacing reserved for short
panel eyebrows (<=2 words).

## Spacing & Density

`--meridian-gutter` 8px (compact 6px), row height 28px (24px), timeline track 56px (44px),
switched by `data-density` on the shell root. Font sizes never change with density.

## Radii & Elevation

4 / 6 / 10px (`--radius-sm/md/lg`). Panels are flat surfaces separated by hairline borders -
panels never cast shadows; `--shadow-overlay` is for true overlays (menus, dialogs, toasts) only.
Semantic z scale: drawer 10 < thread 20 < sticky 30 < backdrop 40 < overlay 50 < toast 60 <
tooltip 70.

## Motion

`--ease-out-quart`, 120/200/240ms. Motion conveys state (selection, invalid-connection shake,
drawer slide); no orchestrated entrances. Global `prefers-reduced-motion` kill-switch exists.

## Components

- `Button`, `IconButton` (sm/md), `Badge`, `Kbd`, `Meter`, `Menu`/`MenuItem` (anchored),
  `ContextMenu` (pointer-positioned), `ConfirmDialog`, `PromptDialog`, `StatCard`.
- Command surfaces: `CommandPalette` (Ctrl+K) and `CommandMenuItem` rows are generated from
  `COMMAND_REGISTRY` so labels/shortcuts cannot drift.
- Focus: 2px accent outline, 3px offset, on every interactive element.

## Layout

App shell: slim top bar -> workspace -> 28px status bar. Workspace layouts:

- **Studio (default)**: media bin (left) / preview monitor + transport (center) / inspector
  (right), full-width timeline below a draggable splitter. Nodes workspace swaps the upper region
  for the workflow canvas. Familiar NLE grammar (CapCut/Premiere).
- **Strata (optional)**: MERIDIAN sky/ground stacked strata with horizon splitter and stage row
  (see `docs/design/MERIDIAN-UI-SPEC.md`).

Timeline is time-proportional: ruler with adaptive ticks, playhead spanning all lanes, clips
positioned at `startTime x zoom`, trim handles on selection, snapping to edges/playhead.
