export type BadgeTone = 'default' | 'warn' | 'danger' | 'success'

const TONE_CLASSES: Record<BadgeTone, string> = {
  default: 'border-white/10 bg-black/20 text-white/90',
  warn: 'border-amber-300/20 bg-amber-500/10 text-amber-50',
  danger: 'border-red-400/20 bg-red-500/10 text-red-100',
  success: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-50',
}

/** Small non-interactive status pill. Was duplicated as a local component per feature file. */
export function Badge({ label, tone = 'default' }: { label: string; tone?: BadgeTone }) {
  return <span className={`rounded-full border px-3 py-1 text-xs ${TONE_CLASSES[tone]}`}>{label}</span>
}
