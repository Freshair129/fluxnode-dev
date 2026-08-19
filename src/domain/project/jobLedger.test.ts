import { describe, expect, it } from 'vitest'
import type { ErrorCategory, RenderJob } from './types'
import {
  JOB_LEDGER_AUTO_CLEAR_MS,
  computeJobProgressRatio,
  computeQueuePosition,
  describeErrorCategory,
  formatElapsedSince,
  formatEtaRemaining,
  formatOrdinal,
  hasActiveRenderJobs,
  selectVisibleLedgerJobs,
  sortLedgerJobs,
} from './jobLedger'

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
    totalFrames: 100,
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

describe('jobLedger: formatOrdinal', () => {
  it('formats common cases', () => {
    expect(formatOrdinal(1)).toBe('1st')
    expect(formatOrdinal(2)).toBe('2nd')
    expect(formatOrdinal(3)).toBe('3rd')
    expect(formatOrdinal(4)).toBe('4th')
  })

  it('handles the 11-13 teen exception', () => {
    expect(formatOrdinal(11)).toBe('11th')
    expect(formatOrdinal(12)).toBe('12th')
    expect(formatOrdinal(13)).toBe('13th')
    expect(formatOrdinal(21)).toBe('21st')
    expect(formatOrdinal(22)).toBe('22nd')
    expect(formatOrdinal(23)).toBe('23rd')
    expect(formatOrdinal(111)).toBe('111th')
  })
})

describe('jobLedger: computeQueuePosition', () => {
  it('is 1-based and counts only queued jobs, in queue order', () => {
    const queue = [
      makeJob({ id: 'a', status: 'rendering' }),
      makeJob({ id: 'b', status: 'queued' }),
      makeJob({ id: 'c', status: 'paused' }),
      makeJob({ id: 'd', status: 'queued' }),
      makeJob({ id: 'e', status: 'queued' }),
    ]

    expect(computeQueuePosition(queue, 'b')).toBe(1)
    expect(computeQueuePosition(queue, 'd')).toBe(2)
    expect(computeQueuePosition(queue, 'e')).toBe(3)
  })

  it('returns null for non-queued or unknown jobs', () => {
    const queue = [makeJob({ id: 'a', status: 'rendering' }), makeJob({ id: 'b', status: 'queued' })]

    expect(computeQueuePosition(queue, 'a')).toBeNull()
    expect(computeQueuePosition(queue, 'missing')).toBeNull()
  })

  it('reflects reordering (moveRenderJob splices the queue array itself)', () => {
    const queue = [makeJob({ id: 'a', status: 'queued' }), makeJob({ id: 'b', status: 'queued' })]
    expect(computeQueuePosition(queue, 'a')).toBe(1)

    const reordered = [queue[1], queue[0]]
    expect(computeQueuePosition(reordered, 'a')).toBe(2)
    expect(computeQueuePosition(reordered, 'b')).toBe(1)
  })
})

describe('jobLedger: computeJobProgressRatio', () => {
  it('derives ratio from frame counts', () => {
    const job = makeJob({ id: 'a', status: 'rendering', currentFrame: 25, totalFrames: 100 })
    expect(computeJobProgressRatio(job)).toBe(0.25)
  })

  it('falls back to job.progress when totalFrames is unusable', () => {
    const job = makeJob({ id: 'a', status: 'rendering', currentFrame: 0, totalFrames: 0, progress: 40 })
    expect(computeJobProgressRatio(job)).toBe(0.4)
  })

  it('is always 1 for completed jobs regardless of frame data', () => {
    const job = makeJob({ id: 'a', status: 'completed', currentFrame: 3, totalFrames: 100 })
    expect(computeJobProgressRatio(job)).toBe(1)
  })

  it('clamps to [0, 1]', () => {
    const over = makeJob({ id: 'a', status: 'rendering', currentFrame: 150, totalFrames: 100 })
    expect(computeJobProgressRatio(over)).toBe(1)
  })
})

describe('jobLedger: formatElapsedSince / formatEtaRemaining', () => {
  it('formats elapsed as mm:ss under an hour', () => {
    const start = new Date('2026-01-01T00:00:00.000Z').getTime()
    const now = start + 134_000 // 2:14
    expect(formatElapsedSince('2026-01-01T00:00:00.000Z', now)).toBe('2:14')
  })

  it('formats elapsed as h:mm:ss past an hour', () => {
    const start = new Date('2026-01-01T00:00:00.000Z').getTime()
    const now = start + (3661 * 1000) // 1:01:01
    expect(formatElapsedSince('2026-01-01T00:00:00.000Z', now)).toBe('1:01:01')
  })

  it('reads "ETA pending" for null/non-positive seconds', () => {
    expect(formatEtaRemaining(null)).toBe('ETA pending')
    expect(formatEtaRemaining(0)).toBe('ETA pending')
    expect(formatEtaRemaining(-5)).toBe('ETA pending')
  })

  it('formats a positive ETA as "~<duration> left"', () => {
    expect(formatEtaRemaining(134)).toBe('~2:14 left')
  })
})

describe('jobLedger: describeErrorCategory', () => {
  // Advisory 5: exhaustively cover all 12 ErrorCategory values so a newly-added category without
  // a label (the ERROR_CATEGORY_LABELS map would return undefined) fails this test instead of
  // silently rendering a blank cause line in a FailedChip.
  const ALL_CATEGORIES: ErrorCategory[] = [
    'comfy_connection',
    'comfy_execution',
    'cloud_network',
    'cloud_auth',
    'cloud_quota',
    'asset_missing',
    'asset_corrupt',
    'render_failed',
    'disk_full',
    'memory_pressure',
    'gpu_oom',
    'internal',
  ]

  it('maps every one of the 12 categories to a distinct, non-empty label', () => {
    const labels = ALL_CATEGORIES.map((category) => describeErrorCategory(category))

    for (const label of labels) {
      expect(label).toBeTruthy()
      expect(typeof label).toBe('string')
    }

    // Distinct: no two categories collapse to the same cause line.
    expect(new Set(labels).size).toBe(ALL_CATEGORIES.length)
  })

  it('uses the specific label for representative categories', () => {
    expect(describeErrorCategory('gpu_oom')).toBe('GPU out of memory')
    expect(describeErrorCategory('cloud_quota')).toBe('Cloud quota exceeded')
  })

  it('falls back to a generic label when the category is null', () => {
    expect(describeErrorCategory(null)).toBe('Render failed')
  })
})

describe('jobLedger: sortLedgerJobs', () => {
  it('orders by relevance: rendering > queued > paused > failed/cancelled > completed', () => {
    const completed = makeJob({ id: 'completed', status: 'completed' })
    const failed = makeJob({ id: 'failed', status: 'failed' })
    const paused = makeJob({ id: 'paused', status: 'paused' })
    const queued = makeJob({ id: 'queued', status: 'queued' })
    const rendering = makeJob({ id: 'rendering', status: 'rendering' })
    const cancelled = makeJob({ id: 'cancelled', status: 'cancelled' })

    const sorted = sortLedgerJobs([completed, failed, paused, queued, rendering, cancelled])

    expect(sorted.map((job) => job.id)).toEqual(['rendering', 'queued', 'paused', 'failed', 'cancelled', 'completed'])
  })

  it('is stable within a priority tier', () => {
    const jobs = [
      makeJob({ id: 'q1', status: 'queued' }),
      makeJob({ id: 'q2', status: 'queued' }),
      makeJob({ id: 'q3', status: 'queued' }),
    ]

    expect(sortLedgerJobs(jobs).map((job) => job.id)).toEqual(['q1', 'q2', 'q3'])
  })
})

describe('jobLedger: selectVisibleLedgerJobs', () => {
  it('keeps queued/rendering/paused/failed jobs unconditionally', () => {
    const queue = [
      makeJob({ id: 'a', status: 'rendering' }),
      makeJob({ id: 'b', status: 'queued' }),
      makeJob({ id: 'c', status: 'paused' }),
      makeJob({ id: 'd', status: 'failed' }),
    ]

    const visible = selectVisibleLedgerJobs(queue, { now: Date.now(), hoveredJobIds: new Set() })
    expect(visible.map((job) => job.id).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('drops a completed job once autoClearMs has elapsed since completedAt', () => {
    const completedAt = '2026-01-01T00:00:00.000Z'
    const queue = [makeJob({ id: 'a', status: 'completed', completedAt })]

    const stillVisible = selectVisibleLedgerJobs(queue, {
      now: Date.parse(completedAt) + JOB_LEDGER_AUTO_CLEAR_MS - 1,
      hoveredJobIds: new Set(),
    })
    expect(stillVisible).toHaveLength(1)

    const cleared = selectVisibleLedgerJobs(queue, {
      now: Date.parse(completedAt) + JOB_LEDGER_AUTO_CLEAR_MS + 1,
      hoveredJobIds: new Set(),
    })
    expect(cleared).toHaveLength(0)
  })

  it('hover pins a completed job past its auto-clear window', () => {
    const completedAt = '2026-01-01T00:00:00.000Z'
    const queue = [makeJob({ id: 'a', status: 'completed', completedAt })]

    const pinned = selectVisibleLedgerJobs(queue, {
      now: Date.parse(completedAt) + JOB_LEDGER_AUTO_CLEAR_MS + 10_000,
      hoveredJobIds: new Set(['a']),
    })
    expect(pinned).toHaveLength(1)
  })
})

describe('hasActiveRenderJobs', () => {
  it.each(['queued', 'rendering', 'paused'] as const)('treats a %s job as still needing watching', (status) => {
    expect(hasActiveRenderJobs([makeJob({ id: 'a', status })])).toBe(true)
  })

  it.each(['completed', 'failed', 'cancelled'] as const)('treats a %s job as finished', (status) => {
    expect(hasActiveRenderJobs([makeJob({ id: 'a', status })])).toBe(false)
  })

  it('is false for an empty queue', () => {
    expect(hasActiveRenderJobs([])).toBe(false)
  })

  it('is true when any one job in a mixed queue is still active', () => {
    expect(
      hasActiveRenderJobs([makeJob({ id: 'a', status: 'completed' }), makeJob({ id: 'b', status: 'queued' })]),
    ).toBe(true)
  })
})
