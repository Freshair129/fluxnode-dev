import { describe, expect, it } from 'vitest'
import type { RenderJob } from '../../../domain/project/types'
import { buildStatusBarSegments, isProjectDirty, summarizeJobs, type StatusBarSnapshot } from './segments'

function makeJob(overrides: Partial<RenderJob> = {}): RenderJob {
  return {
    id: 'job-1',
    name: 'Job 1',
    status: 'queued',
    progress: 0,
    currentFrame: 0,
    totalFrames: 100,
    createdAt: new Date().toISOString(),
    completedAt: null,
    estimatedTimeRemaining: null,
    errorCategory: null,
    lastError: null,
    failedFrame: null,
    resumeFromFrame: null,
    retryCount: 0,
    maxAutoRetries: 3,
    autoRetryScheduledFor: null,
    autoRetryReason: null,
    didFallbackResolution: false,
    originalResolution: null,
    computeMode: 'local',
    audioMode: 'muxed',
    audioSourceSummary: '',
    outputPath: '',
    manifestPath: null,
    outputFileSize: null,
    quotaUsageSummary: null,
    quotaResetAt: null,
    config: {
      format: { container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', quality: 'high' },
      resolution: { width: 1920, height: 1080 },
      frameRate: 30,
      range: 'full',
      denoising: false,
    },
    ...overrides,
  } as unknown as RenderJob
}

function baseSnapshot(overrides: Partial<StatusBarSnapshot> = {}): StatusBarSnapshot {
  return {
    computeMode: 'local',
    networkStatus: 'online',
    runtimeBackendOk: true,
    timelineZoom: 1,
    lastSavedAt: '2026-01-01T00:00:00.000Z',
    lastAutoSavedAt: '2026-01-01T00:00:00.000Z',
    projectUpdatedAt: '2026-01-01T00:00:00.000Z',
    queue: [],
    appUpdateStatus: 'idle',
    sharingConflictCount: 0,
    hasUnrecoverableError: false,
    hasRecoverableError: false,
    ...overrides,
  }
}

describe('isProjectDirty', () => {
  it('is dirty when never saved', () => {
    expect(isProjectDirty({ lastSavedAt: null, lastAutoSavedAt: null, projectUpdatedAt: new Date().toISOString() })).toBe(true)
  })

  it('is clean when the project was updated before the last save', () => {
    expect(
      isProjectDirty({
        lastSavedAt: '2026-01-01T00:05:00.000Z',
        lastAutoSavedAt: null,
        projectUpdatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toBe(false)
  })

  it('is dirty when the project was updated after the last save', () => {
    expect(
      isProjectDirty({
        lastSavedAt: '2026-01-01T00:00:00.000Z',
        lastAutoSavedAt: null,
        projectUpdatedAt: '2026-01-01T00:05:00.000Z',
      }),
    ).toBe(true)
  })

  it('uses the most recent of manual save and autosave', () => {
    expect(
      isProjectDirty({
        lastSavedAt: '2026-01-01T00:00:00.000Z',
        lastAutoSavedAt: '2026-01-01T00:10:00.000Z',
        projectUpdatedAt: '2026-01-01T00:05:00.000Z',
      }),
    ).toBe(false)
  })
})

describe('summarizeJobs', () => {
  it('reports zero jobs for an empty queue', () => {
    expect(summarizeJobs([])).toEqual({ totalCount: 0, frontJob: null, frontJobPercent: null, hasFailure: false })
  })

  it('surfaces the rendering job as front job with a percent', () => {
    const rendering = makeJob({ id: 'r1', status: 'rendering', currentFrame: 50, totalFrames: 100 })
    const queued = makeJob({ id: 'q1', status: 'queued' })
    const summary = summarizeJobs([queued, rendering])
    expect(summary.totalCount).toBe(2)
    expect(summary.frontJob?.id).toBe('r1')
    expect(summary.frontJobPercent).toBe(50)
    expect(summary.hasFailure).toBe(false)
  })

  it('never assigns a percent to a queued front job (M.5: no fake determinism)', () => {
    const summary = summarizeJobs([makeJob({ status: 'queued' })])
    expect(summary.frontJobPercent).toBeNull()
  })

  it('flags a failed job in the queue', () => {
    const summary = summarizeJobs([makeJob({ status: 'failed' })])
    expect(summary.hasFailure).toBe(true)
  })
})

describe('buildStatusBarSegments', () => {
  it('produces exactly one segment per known id, in order', () => {
    const segments = buildStatusBarSegments(baseSnapshot())
    expect(segments.map((segment) => segment.id)).toEqual([
      'compute',
      'connectivity',
      'autosave',
      'zoom',
      'jobs',
      'appUpdates',
      'workspace',
      'audio',
    ])
  })

  it('routes compute and connectivity segments to the connectivity drawer', () => {
    const segments = buildStatusBarSegments(baseSnapshot())
    const compute = segments.find((segment) => segment.id === 'compute')!
    const connectivity = segments.find((segment) => segment.id === 'connectivity')!
    expect(compute.action).toEqual({ kind: 'openDrawer', drawer: 'connectivity' })
    expect(connectivity.action).toEqual({ kind: 'openDrawer', drawer: 'connectivity' })
  })

  it('routes the jobs segment to the export sheet', () => {
    const segments = buildStatusBarSegments(baseSnapshot())
    expect(segments.find((segment) => segment.id === 'jobs')!.action).toEqual({ kind: 'openExportSheet' })
  })

  it('tones connectivity as warn when offline', () => {
    const segments = buildStatusBarSegments(baseSnapshot({ networkStatus: 'offline' }))
    expect(segments.find((segment) => segment.id === 'connectivity')!.tone).toBe('warn')
  })

  it('tones the jobs segment accent only while a job is actively rendering (M.2 accent discipline)', () => {
    const rendering = buildStatusBarSegments(baseSnapshot({ queue: [makeJob({ status: 'rendering' })] }))
    expect(rendering.find((segment) => segment.id === 'jobs')!.tone).toBe('accent')

    const queued = buildStatusBarSegments(baseSnapshot({ queue: [makeJob({ status: 'queued' })] }))
    expect(queued.find((segment) => segment.id === 'jobs')!.tone).toBe('neutral')
  })

  it('tones the jobs segment danger when any job has failed, even if the front job has not', () => {
    const segments = buildStatusBarSegments(
      baseSnapshot({ queue: [makeJob({ id: 'a', status: 'failed' }), makeJob({ id: 'b', status: 'queued' })] }),
    )
    expect(segments.find((segment) => segment.id === 'jobs')!.tone).toBe('danger')
  })

  it('marks autosave dirty and offers a save action when unsaved', () => {
    const segments = buildStatusBarSegments(baseSnapshot({ lastSavedAt: null, lastAutoSavedAt: null }))
    const autosave = segments.find((segment) => segment.id === 'autosave')!
    expect(autosave.label).toBe('Unsaved changes')
    expect(autosave.tone).toBe('warn')
    expect(autosave.action).toEqual({ kind: 'save' })
  })

  it('formats the zoom segment from the raw multiplier and focuses ground on activation', () => {
    const segments = buildStatusBarSegments(baseSnapshot({ timelineZoom: 2.5 }))
    const zoom = segments.find((segment) => segment.id === 'zoom')!
    expect(zoom.label).toBe('Zoom 2.5x')
    expect(zoom.action).toEqual({ kind: 'focusGround' })
  })

  it('tones app updates warn when available and danger on error', () => {
    const available = buildStatusBarSegments(baseSnapshot({ appUpdateStatus: 'update-available' }))
    expect(available.find((segment) => segment.id === 'appUpdates')!.tone).toBe('warn')

    const errored = buildStatusBarSegments(baseSnapshot({ appUpdateStatus: 'error' }))
    expect(errored.find((segment) => segment.id === 'appUpdates')!.tone).toBe('danger')
  })

  it('tones workspace warn when sync conflicts are queued', () => {
    const segments = buildStatusBarSegments(baseSnapshot({ sharingConflictCount: 2 }))
    expect(segments.find((segment) => segment.id === 'workspace')!.tone).toBe('warn')
  })

  it('tones audio danger for unrecoverable errors, warn for recoverable-only', () => {
    const danger = buildStatusBarSegments(baseSnapshot({ hasUnrecoverableError: true, hasRecoverableError: true }))
    expect(danger.find((segment) => segment.id === 'audio')!.tone).toBe('danger')

    const warn = buildStatusBarSegments(baseSnapshot({ hasRecoverableError: true }))
    expect(warn.find((segment) => segment.id === 'audio')!.tone).toBe('warn')
  })
})
