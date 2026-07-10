/**
 * Pure, dependency-free status bar logic (MERIDIAN item 9 — "dissolve SystemPanels into the 28px
 * status bar + drawers"). Derives the bar's segment list from primitive snapshot values (never the
 * live store or DOM), so segment content, tone, and routing can be unit tested directly — mirrors
 * the existing split between pure math (`domain/project/horizon.ts`, `domain/project/jobLedger.ts`)
 * and the store-wired components that consume it.
 *
 * See docs/design/MERIDIAN-UI-SPEC.md section F (wireframe: "GPU 71% · ComfyUI ● connected ·
 * autosave ✓ · zoom 34%") and the item-9 brief's destination map: "compute mode · connectivity ·
 * autosave/dirty state · timeline zoom · a live job summary. Each segment is a real <button> that
 * opens the drawer that owns it."
 *
 * Two documented deviations from a literal "every segment opens a drawer" reading (no drawer owns
 * either concept):
 *  - `autosave`'s action is `save` (calls `saveProject` directly) — clicking it saves now rather
 *    than opening a status view of a fact already printed on the segment itself.
 *  - `zoom`'s action is `focusGround` — it focuses the ground (timeline) stratum, where the real
 *    zoom controls (TimelineView's "Zoom +/-" toolbar buttons) live, rather than opening a drawer
 *    that would just duplicate the same number.
 * `connectivity`/`compute` both route to the `connectivity` drawer (which absorbs the old
 * "Connectivity" SystemPanels section); `jobs` routes to the export sheet (`Ctrl+E`), which
 * absorbs the old "Export queue" section.
 */
import type { RenderJob } from '../../../domain/project/types'
import { computeJobProgressRatio, sortLedgerJobs } from '../../../domain/project/jobLedger'

export type StatusDrawerId = 'connectivity' | 'appUpdates' | 'workspace' | 'audio'

export type StatusBarAction =
  | { kind: 'openDrawer'; drawer: StatusDrawerId }
  | { kind: 'openExportSheet' }
  | { kind: 'save' }
  | { kind: 'focusGround' }

export type StatusBarTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent'

export interface StatusBarSegment {
  id: string
  label: string
  ariaLabel: string
  tone: StatusBarTone
  action: StatusBarAction
}

export interface StatusBarSnapshot {
  computeMode: 'local' | 'cloud'
  networkStatus: 'online' | 'offline'
  /** Closest available proxy for "ComfyUI reachability" (spec F) — this codebase has no dedicated
   *  ComfyUI ping; `runtimeHealth.status === 'ok'` was already the signal the old Connectivity
   *  section keyed its "Backend" pill off of. */
  runtimeBackendOk: boolean
  timelineZoom: number
  lastSavedAt: string | null
  lastAutoSavedAt: string | null
  projectUpdatedAt: string
  queue: readonly RenderJob[]
  appUpdateStatus: 'idle' | 'checking' | 'up-to-date' | 'update-available' | 'error'
  sharingConflictCount: number
  hasUnrecoverableError: boolean
  hasRecoverableError: boolean
}

/** True when the project has edits newer than the last manual/auto save (or was never saved). */
export function isProjectDirty(
  snapshot: Pick<StatusBarSnapshot, 'lastSavedAt' | 'lastAutoSavedAt' | 'projectUpdatedAt'>,
): boolean {
  const savedTimestamps = [snapshot.lastSavedAt, snapshot.lastAutoSavedAt]
    .filter((value): value is string => value !== null)
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value))

  if (savedTimestamps.length === 0) {
    return true
  }

  const updatedAt = Date.parse(snapshot.projectUpdatedAt)
  if (!Number.isFinite(updatedAt)) {
    return false
  }

  return updatedAt > Math.max(...savedTimestamps)
}

export interface JobSummary {
  totalCount: number
  frontJob: RenderJob | null
  /** Only populated while the front job is actively `rendering` (M.5: never a bare percent for a queued job). */
  frontJobPercent: number | null
  hasFailure: boolean
}

/** Job summary for the status bar's live segment — reuses the ledger's own relevance sort so the
 *  bar's "front job" always agrees with the job ledger's top row. */
export function summarizeJobs(queue: readonly RenderJob[]): JobSummary {
  const sorted = sortLedgerJobs(queue)
  const frontJob = sorted[0] ?? null
  const hasFailure = queue.some((job) => job.status === 'failed')
  const frontJobPercent =
    frontJob && frontJob.status === 'rendering' ? Math.round(computeJobProgressRatio(frontJob) * 100) : null

  return { totalCount: queue.length, frontJob, frontJobPercent, hasFailure }
}

/**
 * Builds the ordered list of status bar segments (left to right). Accent (M.2) is reserved for the
 * jobs segment while a job is actively rendering — the one genuinely "live" signal on this bar.
 * Every other tone is neutral/ok/warn/danger (semantic, not accent).
 */
export function buildStatusBarSegments(snapshot: StatusBarSnapshot): StatusBarSegment[] {
  const dirty = isProjectDirty(snapshot)
  const jobs = summarizeJobs(snapshot.queue)
  const connectivityOk = snapshot.networkStatus === 'online' && snapshot.runtimeBackendOk

  return [
    {
      id: 'compute',
      label: `Compute · ${snapshot.computeMode === 'local' ? 'Local' : 'Cloud'}`,
      ariaLabel: `Compute mode: ${snapshot.computeMode}. Opens the connectivity drawer.`,
      tone: 'neutral',
      action: { kind: 'openDrawer', drawer: 'connectivity' },
    },
    {
      id: 'connectivity',
      label: snapshot.networkStatus === 'online' ? 'Online' : 'Offline',
      ariaLabel: `Connectivity: ${snapshot.networkStatus}${connectivityOk ? '' : ', runtime degraded'}. Opens the connectivity drawer.`,
      tone: connectivityOk ? 'ok' : 'warn',
      action: { kind: 'openDrawer', drawer: 'connectivity' },
    },
    {
      id: 'autosave',
      label: dirty ? 'Unsaved changes' : 'Autosave ✓',
      ariaLabel: dirty ? 'Project has unsaved changes. Saves the project now.' : 'Project autosaved. Saves the project now.',
      tone: dirty ? 'warn' : 'neutral',
      action: { kind: 'save' },
    },
    {
      id: 'zoom',
      label: `Zoom ${snapshot.timelineZoom.toFixed(1)}x`,
      ariaLabel: `Timeline zoom ${snapshot.timelineZoom.toFixed(1)}x. Focuses the timeline.`,
      tone: 'neutral',
      action: { kind: 'focusGround' },
    },
    {
      id: 'jobs',
      label:
        jobs.totalCount === 0
          ? 'No jobs'
          : `${jobs.totalCount} job${jobs.totalCount === 1 ? '' : 's'}${jobs.frontJobPercent !== null ? ` · ${jobs.frontJobPercent}%` : ''}`,
      ariaLabel:
        jobs.totalCount === 0
          ? 'No render jobs. Opens the export sheet.'
          : `${jobs.totalCount} render job${jobs.totalCount === 1 ? '' : 's'}${jobs.frontJob ? `, front job ${jobs.frontJob.status}` : ''}. Opens the export sheet.`,
      tone: jobs.hasFailure ? 'danger' : jobs.frontJob?.status === 'rendering' ? 'accent' : 'neutral',
      action: { kind: 'openExportSheet' },
    },
    {
      id: 'appUpdates',
      label: 'Updates',
      ariaLabel: `App updates: ${snapshot.appUpdateStatus}. Opens the app updates drawer.`,
      tone:
        snapshot.appUpdateStatus === 'update-available'
          ? 'warn'
          : snapshot.appUpdateStatus === 'error'
            ? 'danger'
            : 'neutral',
      action: { kind: 'openDrawer', drawer: 'appUpdates' },
    },
    {
      id: 'workspace',
      label: 'Workspace',
      ariaLabel: `Workspace sync${snapshot.sharingConflictCount > 0 ? `, ${snapshot.sharingConflictCount} conflict(s)` : ''}. Opens the workspace drawer.`,
      tone: snapshot.sharingConflictCount > 0 ? 'warn' : 'neutral',
      action: { kind: 'openDrawer', drawer: 'workspace' },
    },
    {
      id: 'audio',
      label: 'Audio',
      ariaLabel: `Audio and runtime issues${
        snapshot.hasUnrecoverableError ? ', unrecoverable error present' : snapshot.hasRecoverableError ? ', recoverable issue present' : ''
      }. Opens the audio and runtime drawer.`,
      tone: snapshot.hasUnrecoverableError ? 'danger' : snapshot.hasRecoverableError ? 'warn' : 'neutral',
      action: { kind: 'openDrawer', drawer: 'audio' },
    },
  ]
}
