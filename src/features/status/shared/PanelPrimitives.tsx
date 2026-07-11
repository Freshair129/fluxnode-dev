import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { ComponentType } from 'react'

/**
 * Shared presentational primitives extracted verbatim from the pre-item-9 `SystemPanels.tsx`
 * (unchanged rendering/markup) so every drawer, the export sheet, and the diagnostics panel can
 * keep the same visual language without re-deriving it. See MERIDIAN-ORCHESTRATION.md item 9.
 */

export function PanelHeading({
  icon: Icon,
  title,
}: {
  icon: ComponentType<{ size?: number; className?: string }>
  title: string
}) {
  return (
    <div className="flex items-center gap-3">
      <Icon size={18} className="text-[#e0ff00]" />
      <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-white">{title}</h3>
    </div>
  )
}

export function StatusPill({ label, tone }: { label: string; tone: 'ok' | 'warn' }) {
  const Icon = tone === 'ok' ? CheckCircle2 : AlertTriangle
  const classes =
    tone === 'ok'
      ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-50'
      : 'border-amber-300/20 bg-amber-500/10 text-amber-50'

  return (
    <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs uppercase tracking-[0.2em] ${classes}`}>
      <Icon size={14} />
      {label}
    </div>
  )
}

export function InspectorCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.25rem] border border-white/8 bg-black/20 p-4">
      <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">{label}</p>
      <p className="mt-3 text-sm leading-6 text-white">{value}</p>
    </div>
  )
}
