import type { ComponentType } from 'react'

export interface StatCardProps {
  icon?: ComponentType<{ size?: number; className?: string }>
  label: string
  value: string
  note?: string
}

/**
 * Canonical "icon + label + value (+ note)" status card. Covers what used to
 * be duplicated as `MetricCard` (PreviewPanel) and `StatusCard` (WorkflowView).
 */
export function StatCard({ icon: Icon, label, value, note }: StatCardProps) {
  return (
    <div className="rounded-[1.25rem] border border-white/8 bg-black/20 p-4">
      <div className="flex items-center gap-3">
        {Icon ? <Icon size={18} className="text-accent" aria-hidden="true" /> : null}
        <p className="text-[11px] uppercase tracking-[0.22em] text-text-secondary">{label}</p>
      </div>
      <p className="mt-3 text-sm font-medium text-white">{value}</p>
      {note ? <p className="mt-2 break-all text-xs leading-5 text-[#9ca3af]">{note}</p> : null}
    </div>
  )
}
