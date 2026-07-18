# Product

## Register

product

## Users

Solo creators and small studio editors making short-form and mid-form video. They already know
CapCut (phone/desktop) or Premiere Pro; many are Thai-speaking creators working long sessions on
mid-range Windows machines. They open FluxNode to cut footage fast, and reach for the AI node
graph only when a clip needs generative work. On any given screen the primary task is editing the
timeline; everything else is support.

## Product Purpose

FluxNode is an AI-native desktop video editor (Tauri + React + Rust): a familiar timeline NLE
fused with a node-based AI/VFX pipeline. Success = a CapCut-fluent user can import media, cut a
sequence, and export within their first session without reading docs, while a pro user keeps
Premiere-grade depth (tracks, trimming, proxies, shortcuts, node graph) one click away.

## Brand Personality

Precise, fast, quietly powerful. A dark instrument panel, not a marketing page. The neon accent
(#e0ff00) signals live/active state, never decoration.

## Anti-references

- Demo-ware chrome: walls of labeled pill buttons, explanatory paragraphs inside working panels,
  metric cards where a monitor should be. The tool must not explain itself mid-task.
- Novel spatial metaphors as the default shell (the sky/ground "strata" horizon). Power users may
  opt in; the default must read instantly to a CapCut/Premiere user.
- Glassmorphism-everywhere and glow-heavy surfaces that compete with the user's footage.

## Design Principles

1. **The footage is the interface.** Chrome stays near-black and quiet; the preview monitor and
   timeline get the pixels. Nothing may outshine the user's own frames.
2. **Earned familiarity.** Media bin left, monitor center, inspector right, timeline bottom.
   Standard affordances (drag, trim handles, playhead ruler, snapping) behave exactly as they do
   in the tools users already know.
3. **One obvious next action.** Empty states point to Import. Selection drives the inspector.
   Export is always visible top-right.
4. **Depth on demand.** Pro controls (tracks, proxies, nodes, density) exist but never crowd the
   first-session path. The node graph is a workspace tab, not a second world.
5. **State over speech.** Communicate through highlight, position, and badges - not sentences.

## Accessibility & Inclusion

WCAG AA contrast on all text (>=4.5:1 body, >=3:1 large). Full keyboard operability (roving focus
on tracks/clips, focus-visible rings, registry-backed shortcuts with a cheat sheet). Honors
`prefers-reduced-motion`. UI copy in English; docs in Thai.
