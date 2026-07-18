import type { ReactNode } from 'react'
import { Pause, Play, SkipBack, SkipForward, StepBack, StepForward } from 'lucide-react'
import { useProjectStore } from '../../store/project-store'
import { formatTimecode } from './timecode'

function TransportButton({
  label,
  onClick,
  children,
  emphasis = false,
}: {
  label: string
  onClick: () => void
  children: ReactNode
  emphasis?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={
        emphasis
          ? 'inline-flex h-9 w-9 items-center justify-center rounded-full bg-accent text-black transition hover:brightness-95'
          : 'inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-text-data transition hover:bg-white/8 hover:text-white'
      }
    >
      {children}
    </button>
  )
}

/**
 * Studio-layout transport strip mounted directly under the preview monitor (CapCut/Premiere
 * grammar: playback controls belong to the monitor, not the timeline). Timecode is
 * current / total at the project frame rate; J/K/L shuttle stays available through the global
 * shortcuts and is advertised in the title of the play control.
 */
export function TransportBar() {
  const playbackState = useProjectStore((state) => state.ui.playbackState)
  const playbackRate = useProjectStore((state) => state.ui.playbackRate)
  const playhead = useProjectStore((state) => state.project.timeline.playhead)
  const frameRate = useProjectStore((state) => state.project.settings.frameRate)
  const timelineEnd = useProjectStore((state) =>
    state.project.timeline.tracks.reduce(
      (end, track) => track.clips.reduce((clipEnd, clip) => Math.max(clipEnd, clip.startTime + clip.duration), end),
      0,
    ),
  )
  const togglePlayback = useProjectStore((state) => state.togglePlayback)
  const setPlayhead = useProjectStore((state) => state.setPlayhead)
  const movePlayhead = useProjectStore((state) => state.movePlayhead)

  const fps = frameRate > 0 ? frameRate : 30
  const frameStep = 1 / fps
  const isPlaying = playbackState !== 'paused'

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-hairline bg-surface-3 px-3 py-1.5">
      <p aria-live="polite" className="w-32 shrink-0 font-mono text-xs tabular-nums text-text-data">
        {formatTimecode(playhead, fps)}
        <span className="text-text-secondary"> / {formatTimecode(timelineEnd, fps)}</span>
      </p>

      <div className="flex items-center gap-1">
        <TransportButton label="Go to start (Home)" onClick={() => setPlayhead(0)}>
          <SkipBack size={15} aria-hidden="true" />
        </TransportButton>
        <TransportButton label="Previous frame (Left arrow)" onClick={() => movePlayhead(-frameStep)}>
          <StepBack size={15} aria-hidden="true" />
        </TransportButton>
        <TransportButton
          label={isPlaying ? `Pause (Space) — playing ${playbackRate}x` : 'Play (Space). J/K/L shuttles.'}
          emphasis
          onClick={togglePlayback}
        >
          {isPlaying ? <Pause size={16} aria-hidden="true" /> : <Play size={16} className="translate-x-px" aria-hidden="true" />}
        </TransportButton>
        <TransportButton label="Next frame (Right arrow)" onClick={() => movePlayhead(frameStep)}>
          <StepForward size={15} aria-hidden="true" />
        </TransportButton>
        <TransportButton label="Go to end (End)" onClick={() => setPlayhead(timelineEnd)}>
          <SkipForward size={15} aria-hidden="true" />
        </TransportButton>
      </div>

      <p className="w-32 shrink-0 text-right font-mono text-xs tabular-nums text-text-secondary">
        {isPlaying ? `${playbackState} ${playbackRate}x` : `${fps} fps`}
      </p>
    </div>
  )
}
