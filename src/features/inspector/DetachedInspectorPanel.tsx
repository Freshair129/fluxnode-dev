import { InspectorContent } from './InspectorContent'

/**
 * The popped-out inspector window (`Ctrl+Shift+P`-style detach, spec J.5's sibling for the
 * inspector organ). MERIDIAN item 3 extracted the actual selection-editor body into
 * `InspectorContent` so the same markup renders here AND docked in the stage row's
 * `StageInspector` rail — this file now only owns the detached-window chrome (heading, card
 * shell) around it.
 */
export function DetachedInspectorPanel() {
  return (
    <section className="rounded-[1.75rem] border border-white/10 bg-[#111214] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
      <p className="text-[11px] uppercase tracking-[0.28em] text-text-secondary">Detached Inspector</p>
      <h2 className="mt-2 text-2xl font-semibold text-white">Selection properties</h2>
      <div className="mt-5">
        <InspectorContent />
      </div>
    </section>
  )
}
