import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RenderJob } from '../../domain/project/types'
import { prefersReducedMotion } from '../../domain/project/horizon'
import { JobChip, type JobChipProps } from './JobChip'

/**
 * This repo's vitest config runs in the default node environment (no jsdom/testing-library — see
 * useKeyboardShortcuts.test.ts for the same constraint). `renderToStaticMarkup` needs no DOM:
 * React runs `useState` initializers during SSR (so it captures the mount-time flashing tone that
 * BLOCKING-1 broke) and emits real `aria-hidden` attributes (so it captures the volatile-span
 * hiding that BLOCKING-2 broke). `useEffect` does NOT run under SSR, which is exactly why these
 * two static-analysis-only defects slipped through the round-1 tests — this file closes that gap.
 */
vi.mock('../../domain/project/horizon', () => ({ prefersReducedMotion: vi.fn(() => false) }))

afterEach(() => {
  vi.mocked(prefersReducedMotion).mockReset()
  vi.mocked(prefersReducedMotion).mockReturnValue(false)
})

function makeJob(overrides: Partial<RenderJob> & Pick<RenderJob, 'id' | 'status'>): RenderJob {
  return {
    name: overrides.id,
    config: {
      outputPath: 'out.mp4',
      format: { container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', quality: 'high' },
      resolution: { width: 1920, height: 1080 },
      frameRate: 30,
      range: 'full',
      useProxy: false,
      denoising: false,
      metadata: { title: null, comment: null },
    },
    format: 'mp4',
    progress: 0,
    computeMode: 'local',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    outputPath: 'out.mp4',
    manifestPath: null,
    currentFrame: 0,
    totalFrames: 240,
    completedAt: null,
    estimatedTimeRemaining: null,
    outputFileSize: null,
    errorCategory: null,
    lastError: null,
    failedFrame: null,
    resumeFromFrame: null,
    quotaResetAt: null,
    quotaUsageSummary: null,
    retryCount: 0,
    maxAutoRetries: 0,
    lastRetryAt: null,
    autoRetryReason: null,
    autoRetryScheduledFor: null,
    didFallbackResolution: false,
    originalResolution: null,
    audioMode: 'muted',
    audioSourceSummary: 'none',
    outputRevealedAt: null,
    ...overrides,
  }
}

function renderChip(job: RenderJob, overrides: Partial<JobChipProps> = {}): string {
  const noop = () => {}
  return renderToStaticMarkup(
    <JobChip
      job={job}
      now={Date.parse('2026-01-01T00:02:14.000Z')}
      queuePosition={null}
      isHovered={false}
      onHoverChange={noop}
      onCancel={noop}
      onPause={noop}
      onResume={noop}
      onRetry={noop}
      onReveal={noop}
      canReveal={false}
      {...overrides}
    />,
  )
}

describe('JobChip: BLOCKING-1 — completed landing flash fires on mount', () => {
  // JobChip mounts a FRESH CompletedChip on every rendering→completed transition, so its job is
  // already 'completed' at mount. The regression: guarding the flash against an already-completed
  // status made it dead code. A chip mounting in 'completed' MUST render in the flashing (accent)
  // tone, then settle — this asserts the mount tone the old code never reached.
  it('renders a completed chip in the flashing accent tone at mount', () => {
    const markup = renderChip(makeJob({ id: 'done', status: 'completed', completedAt: '2026-01-01T00:02:14.000Z' }))

    expect(markup).toContain('data-meridian-jobchip="completed"')
    expect(markup).toContain('data-meridian-jobchip-flashing="true"')
    // Flashing uses the accent tone; the settled state uses the success tone (asserted below).
    expect(markup).toContain('border-accent/25')
    expect(markup).not.toContain('border-success/25')
  })

  it('starts settled (no flash) under prefers-reduced-motion — spec H "reduced-motion: none"', () => {
    vi.mocked(prefersReducedMotion).mockReturnValue(true)

    const markup = renderChip(makeJob({ id: 'done', status: 'completed', completedAt: '2026-01-01T00:02:14.000Z' }))

    expect(markup).toContain('data-meridian-jobchip="completed"')
    expect(markup).not.toContain('data-meridian-jobchip-flashing')
    // Settled: success tone, never the accent flash tone.
    expect(markup).toContain('border-success/25')
    expect(markup).not.toContain('border-accent/25')
  })
})

describe('JobChip: BLOCKING-2 — volatile per-tick text is aria-hidden', () => {
  // The ledger <aside> is aria-live="polite"; the 1 Hz `now` tick feeds these spans. Un-hidden,
  // they turn the polite region into a per-second announcement backlog (K.3 wants transitions,
  // not a running clock). Each volatile span authors `aria-hidden` first, so the SSR output places
  // it immediately after `<span `.
  it('hides the queued elapsed clock from the polite live region', () => {
    const markup = renderChip(
      makeJob({ id: 'q', status: 'queued', createdAt: '2026-01-01T00:00:00.000Z' }),
      { queuePosition: 2 },
    )

    // The static position text stays announceable...
    expect(markup).toContain('2nd in line')
    // ...but the elapsed clock is wrapped in an aria-hidden span.
    expect(markup).toMatch(/<span aria-hidden="true"[^>]*> · [^<]*elapsed<\/span>/)
  })

  it('hides the rendering percent and frame/ETA counters from the polite live region', () => {
    const markup = renderChip(
      makeJob({
        id: 'r',
        status: 'rendering',
        currentFrame: 96,
        totalFrames: 240,
        progress: 40,
        estimatedTimeRemaining: 134,
      }),
    )

    // Percent readout is aria-hidden.
    expect(markup).toMatch(/<span aria-hidden="true"[^>]*>40%<\/span>/)
    // Frame counter + ETA line is aria-hidden.
    expect(markup).toMatch(/<span aria-hidden="true"[^>]*>96\/240 frames/)
  })

  it('keeps the determinate progress meter present (not the hidden text) as the accessible progress', () => {
    const markup = renderChip(
      makeJob({ id: 'r', status: 'rendering', currentFrame: 96, totalFrames: 240 }),
    )

    // Meter is role=progressbar with a real aria-valuenow — the accessible progress signal that
    // survives hiding the volatile text (M.5: determinate, never a bare spinner).
    expect(markup).toContain('role="progressbar"')
    expect(markup).toContain('aria-valuenow="40"')
  })
})
