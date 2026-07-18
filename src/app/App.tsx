import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { Header } from '../features/header/Header'
import { PreviewPanel } from '../features/preview/PreviewPanel'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { useKeyboardShortcuts } from '../features/shortcuts/useKeyboardShortcuts'
import {
  getDetachedPanelFromLocation,
  listenForDetachedPanelState,
  broadcastDetachedPanelState,
  type DetachedPanelStateEnvelope,
} from '../services/ipc/detached-panels'
import {
  buildAssetWatchTargets,
  listenForAssetWatchEvents,
  syncAssetWatchTargets,
} from '../services/ipc/asset-watch'
import { checkNetworkConnectivity } from '../services/connectivity/check-network'
import { useTimelineAudio, type TimelineAudioClip } from '../services/audio'
import { ErrorToasts } from '../features/notifications/ErrorToasts'
import { useProjectStore } from '../store/project-store'
import { focusShellRegion, resolveShellFocusTargets } from '../features/workspace/shellFocusTargets'
import { StatusBar } from '../features/status/statusBar/StatusBar'
import type { StatusBarAction, StatusDrawerId } from '../features/status/statusBar/segments'

const TimelineView = lazy(() =>
  import('../features/timeline/TimelineView').then((module) => ({ default: module.TimelineView })),
)
const StrataShell = lazy(() =>
  import('../features/workspace/StrataShell').then((module) => ({ default: module.StrataShell })),
)
const StudioShell = lazy(() =>
  import('../features/workspace/StudioShell').then((module) => ({ default: module.StudioShell })),
)
const StatusOverlays = lazy(() =>
  import('../features/status/StatusOverlays').then((module) => ({ default: module.StatusOverlays })),
)
const DetachedInspectorPanel = lazy(() =>
  import('../features/inspector/DetachedInspectorPanel').then((module) => ({ default: module.DetachedInspectorPanel })),
)
const WelcomeModal = lazy(() =>
  import('../features/onboarding/WelcomeModal').then((module) => ({ default: module.WelcomeModal })),
)
const SettingsModal = lazy(() =>
  import('../features/settings/SettingsModal').then((module) => ({ default: module.SettingsModal })),
)
const WorkspaceSharingModal = lazy(() =>
  import('../features/workspace/WorkspaceSharingModal').then((module) => ({ default: module.WorkspaceSharingModal })),
)
const ShortcutsCheatSheet = lazy(() =>
  import('../features/shortcuts/ShortcutsCheatSheet').then((module) => ({ default: module.ShortcutsCheatSheet })),
)
const CommandPalette = lazy(() =>
  import('../features/commands/CommandPalette').then((module) => ({ default: module.CommandPalette })),
)
const CopilotPanel = lazy(() =>
  import('../features/copilot/CopilotPanel').then((module) => ({ default: module.CopilotPanel })),
)

export default function App() {
  const detachedPanel = useMemo(() => getDetachedPanelFromLocation(), [])
  const syncWindowId = useMemo(
    () => `${detachedPanel ?? 'main'}-${Math.random().toString(36).slice(2, 10)}`,
    [detachedPanel],
  )
  const activeView = useProjectStore((state) => state.ui.activeView)
  // MERIDIAN item 7 (density modes, spec G/L.7): read once here and stamped onto the app shell
  // root below so every surface in this tree — StrataShell (which also stamps it on
  // `[data-meridian-shell]`, satisfying L.7's literal "on the shell"), the status bar, AND the
  // overlays/drawers/palette that render as this div's SIBLINGS-of-StrataShell rather than its
  // descendants — inherits the same `--meridian-*` CSS custom properties (decision D).
  const densityMode = useProjectStore((state) => state.preferences.density)
  const workspaceLayout = useProjectStore((state) => state.preferences.workspaceLayout)
  const showSettings = useProjectStore((state) => state.ui.showSettings)
  const showWorkspaceSharing = useProjectStore((state) => state.ui.showWorkspaceSharing)
  const showWelcome = useProjectStore((state) => state.ui.showWelcome)
  const project = useProjectStore((state) => state.project)
  const ui = useProjectStore((state) => state.ui)
  const runtimeHealth = useProjectStore((state) => state.runtimeHealth)
  const previewFrames = useProjectStore((state) => state.previewFrames)
  const nodePreviewFrames = useProjectStore((state) => state.nodePreviewFrames)
  const waveformCache = useProjectStore((state) => state.waveformCache)
  const assetThumbnails = useProjectStore((state) => state.assetThumbnails)
  const runtimeCacheMetrics = useProjectStore((state) => state.runtimeCacheMetrics)
  const workflowValidationIssues = useProjectStore((state) => state.workflowValidationIssues)
  const projectValidationIssues = useProjectStore((state) => state.projectValidationIssues)
  const workflowExecutionOrder = useProjectStore((state) => state.workflowExecutionOrder)
  const assets = useProjectStore((state) => state.project.assets.assets)
  const currentProjectPath = useProjectStore((state) => state.ui.currentProjectPath)
  const loadPersistedProject = useProjectStore((state) => state.loadPersistedProject)
  const autoSaveProject = useProjectStore((state) => state.autoSaveProject)
  const playbackState = useProjectStore((state) => state.ui.playbackState)
  const playbackRate = useProjectStore((state) => state.ui.playbackRate)
  const movePlayhead = useProjectStore((state) => state.movePlayhead)
  const recordViewSwitchMetric = useProjectStore((state) => state.recordViewSwitchMetric)
  const rescanAssetStatuses = useProjectStore((state) => state.rescanAssetStatuses)
  const refreshRuntimeHealth = useProjectStore((state) => state.refreshRuntimeHealth)
  const syncResilienceState = useProjectStore((state) => state.syncResilienceState)
  const toggleComputeMode = useProjectStore((state) => state.toggleComputeMode)
  const loadAppPreferences = useProjectStore((state) => state.loadAppPreferences)
  const loadCurrentAppVersion = useProjectStore((state) => state.loadCurrentAppVersion)
  const networkStatus = useProjectStore((state) => state.ui.networkStatus)
  const computeMode = useProjectStore((state) => state.project.workflow.computeMode)
  const performanceMode = useProjectStore((state) => state.ui.performanceMode)
  const runtimeStatus = useProjectStore((state) => state.runtimeHealth.status)
  const pendingPanelSyncTimerRef = useRef<number | null>(null)
  const suppressNextPanelBroadcastRef = useRef<string | null>(null)
  const lastAppliedPanelTransactionRef = useRef<string | null>(null)
  const previousActiveViewRef = useRef(activeView)
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showCopilot, setShowCopilot] = useState(false)
  // MERIDIAN item 9: the status bar's secondary surfaces (export sheet + the four drawers) are
  // UI-local state, same as showShortcutsHelp/showCommandPalette above — not store state, per the
  // item-9 hard constraint ("do not change the store contract... adding UI-state fields... is
  // fine" — this just doesn't need to be in the store at all). At most one is open at a time
  // (single active secondary surface — see StatusOverlays' doc comment).
  const [showExportSheet, setShowExportSheet] = useState(false)
  const [openStatusDrawer, setOpenStatusDrawer] = useState<StatusDrawerId | null>(null)
  const [inspectorJobId, setInspectorJobId] = useState<string | null>(null)
  const saveProject = useProjectStore((state) => state.saveProject)

  // Opening any status drawer closes the export sheet (single active secondary surface — see
  // StatusOverlays' doc comment); passed to both the palette (Ctrl+K "Open … drawer" verbs) and
  // the status bar segments so both entry points share one exclusivity rule.
  function openStatusDrawerExclusive(drawer: StatusDrawerId) {
    setShowExportSheet(false)
    setOpenStatusDrawer((current) => (current === drawer ? null : drawer))
  }

  useKeyboardShortcuts({
    onOpenShortcutsHelp: () => setShowShortcutsHelp((current) => !current),
    onOpenCommandPalette: () => setShowCommandPalette(true),
    onOpenExportSheet: () => {
      setOpenStatusDrawer(null)
      setShowExportSheet((current) => !current)
    },
    onOpenStatusDrawer: openStatusDrawerExclusive,
  })

  function handleStatusBarActivate(action: StatusBarAction) {
    if (action.kind === 'openDrawer') {
      openStatusDrawerExclusive(action.drawer)
      return
    }

    if (action.kind === 'openExportSheet') {
      setOpenStatusDrawer(null)
      setShowExportSheet((current) => !current)
      return
    }

    if (action.kind === 'save') {
      void saveProject()
      return
    }

    focusShellRegion(resolveShellFocusTargets().ground)
  }

  // MERIDIAN item 9 (round-2 fix): Escape for the export sheet + drawers is owned by `DrawerShell`
  // itself now, not here. Those surfaces became `aria-modal="true"` (trap and declaration must
  // agree — spec J.7 clarification), so an `isOverlayOpen()`-gated handler here would bail on them.
  // DrawerShell's own topmost-only Escape handler preserves the "closes topmost overlay only"
  // ordering against a stacked FailureInspectorModal — see its doc comment.

  // Map timeline clips with an audio stream onto the decoupled audio-engine
  // input shape, then drive Web Audio playback in sync with the playhead.
  const timelineAudioClips = useMemo<TimelineAudioClip[]>(() => {
    const assetsById = project.assets.assets
    const clips: TimelineAudioClip[] = []
    for (const track of project.timeline.tracks) {
      if (track.type === 'subtitle') {
        continue
      }
      for (const clip of track.clips) {
        const asset = assetsById[clip.assetId]
        if (!asset || (asset.type !== 'audio' && asset.type !== 'video') || !asset.sourcePath) {
          continue
        }
        clips.push({
          id: clip.id,
          sourcePath: asset.sourcePath,
          startTime: clip.startTime,
          inPoint: clip.inPoint,
          outPoint: clip.outPoint,
          volume: clip.volume,
          speed: clip.speed,
          trackMuted: track.muted,
          trackSolo: track.solo,
          trackVolume: track.volume,
        })
      }
    }
    return clips
  }, [project.timeline.tracks, project.assets.assets])

  useTimelineAudio({
    clips: timelineAudioClips,
    playhead: project.timeline.playhead,
    isPlaying: playbackState === 'playing',
    masterVolume: project.audio.masterVolume,
    playbackRate,
    enabled: !detachedPanel,
  })

  useEffect(() => {
    let unlisten: (() => void) | null = null
    void listenForDetachedPanelState((envelope) => {
      if (envelope.sourceWindowId === syncWindowId) {
        return
      }

      if (lastAppliedPanelTransactionRef.current === envelope.transactionId) {
        return
      }

      lastAppliedPanelTransactionRef.current = envelope.transactionId
      suppressNextPanelBroadcastRef.current = envelope.transactionId

      const payload = envelope.snapshot as Partial<ReturnType<typeof useProjectStore.getState>>
      const storeState = useProjectStore.getState()
      const remoteProject = payload.project
      const localProject = storeState.project
      const remoteMutationAt = Date.parse(envelope.emittedAt)
      const localMutationAt = storeState.collaborationState.lastLocalProjectMutationAt
      const sharingEnabled = localProject.meta.sharing.enabled || remoteProject?.meta.sharing.enabled

      if (
        sharingEnabled &&
        remoteProject &&
        Number.isFinite(remoteMutationAt) &&
        Math.abs(remoteMutationAt - (localMutationAt ?? 0)) <= 5_000 &&
        JSON.stringify(remoteProject) !== JSON.stringify(localProject)
      ) {
        const autoResolution = remoteMutationAt >= (localMutationAt ?? 0) ? 'remote' : 'local'
        storeState.registerWorkspaceSyncConflict({
          id: `workspace-conflict-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          sourceWindowId: envelope.sourceWindowId,
          transactionId: envelope.transactionId,
          field: 'project',
          detectedAt: new Date().toISOString(),
          localUpdatedAt: localProject.meta.updatedAt,
          remoteUpdatedAt: remoteProject.meta.updatedAt,
          autoResolution,
          resolvedWith: autoResolution,
          localProjectSnapshot: structuredClone(localProject),
          remoteProjectSnapshot: structuredClone(remoteProject),
        })

        if (autoResolution === 'local') {
          return
        }
      }

      useProjectStore.setState((state) => ({
        ...state,
        project: payload.project ?? state.project,
        runtimeHealth: payload.runtimeHealth ?? state.runtimeHealth,
        runtimeCacheMetrics: payload.runtimeCacheMetrics ?? state.runtimeCacheMetrics,
        previewFrames: payload.previewFrames ?? state.previewFrames,
        nodePreviewFrames: payload.nodePreviewFrames ?? state.nodePreviewFrames,
        waveformCache: payload.waveformCache ?? state.waveformCache,
        assetThumbnails: payload.assetThumbnails ?? state.assetThumbnails,
        workflowValidationIssues: payload.workflowValidationIssues ?? state.workflowValidationIssues,
        projectValidationIssues: payload.projectValidationIssues ?? state.projectValidationIssues,
        workflowExecutionOrder: payload.workflowExecutionOrder ?? state.workflowExecutionOrder,
        ui: payload.ui ? { ...state.ui, ...payload.ui, showWelcome: false, showSettings: false, showWorkspaceSharing: false, showNodePicker: false } : state.ui,
      }))
    }).then((dispose) => {
      unlisten = dispose
    })

    return () => {
      unlisten?.()
    }
  }, [syncWindowId])

  useEffect(() => {
    if (suppressNextPanelBroadcastRef.current) {
      suppressNextPanelBroadcastRef.current = null
      return
    }

    if (pendingPanelSyncTimerRef.current !== null) {
      window.clearTimeout(pendingPanelSyncTimerRef.current)
    }

    pendingPanelSyncTimerRef.current = window.setTimeout(() => {
      pendingPanelSyncTimerRef.current = null

      const envelope: DetachedPanelStateEnvelope = {
        sourceWindowId: syncWindowId,
        transactionId: `panel-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        emittedAt: new Date().toISOString(),
        snapshot: {
          project,
          runtimeHealth,
          runtimeCacheMetrics,
          previewFrames,
          nodePreviewFrames,
          waveformCache,
          assetThumbnails,
          workflowValidationIssues,
          projectValidationIssues,
          workflowExecutionOrder,
          ui: {
            activeView: ui.activeView,
            selectedClipId: ui.selectedClipId,
            selectedClipIds: ui.selectedClipIds,
            selectedTrackId: ui.selectedTrackId,
            selectedNodeId: ui.selectedNodeId,
            selectedNodeIds: ui.selectedNodeIds,
            playbackState: ui.playbackState,
            playbackRate: ui.playbackRate,
            statusMessage: ui.statusMessage,
            networkStatus: ui.networkStatus,
            performanceMode: ui.performanceMode,
            scrubPreviewState: ui.scrubPreviewState,
            workflowConnectionFeedback: ui.workflowConnectionFeedback,
            currentProjectPath: ui.currentProjectPath,
            lastSavedAt: ui.lastSavedAt,
            lastAutoSavedAt: ui.lastAutoSavedAt,
            showWelcome: false,
            showSettings: false,
            showWorkspaceSharing: false,
            showNodePicker: false,
            timelineClipboard: [],
            workflowClipboard: ui.workflowClipboard,
          },
        },
      }

      void broadcastDetachedPanelState(envelope)
    }, 16)

    return () => {
      if (pendingPanelSyncTimerRef.current !== null) {
        window.clearTimeout(pendingPanelSyncTimerRef.current)
      }
    }
  }, [
    assetThumbnails,
    nodePreviewFrames,
    previewFrames,
    project,
    projectValidationIssues,
    runtimeCacheMetrics,
    runtimeHealth,
    ui,
    waveformCache,
    workflowExecutionOrder,
    workflowValidationIssues,
    syncWindowId,
  ])

  useEffect(() => {
    if (detachedPanel) {
      return
    }

    void loadPersistedProject()
  }, [detachedPanel, loadPersistedProject])

  useEffect(() => {
    if (detachedPanel) {
      return
    }

    void loadAppPreferences()
  }, [detachedPanel, loadAppPreferences])

  useEffect(() => {
    if (detachedPanel) {
      return
    }

    void loadCurrentAppVersion()
  }, [detachedPanel, loadCurrentAppVersion])

  useEffect(() => {
    if (detachedPanel) {
      return
    }

    void refreshRuntimeHealth()
  }, [detachedPanel, refreshRuntimeHealth])

  useEffect(() => {
    if (detachedPanel) {
      return
    }

    const timer = window.setInterval(() => {
      void refreshRuntimeHealth()
    }, 30_000)

    return () => window.clearInterval(timer)
  }, [detachedPanel, refreshRuntimeHealth])

  useEffect(() => {
    if (detachedPanel) {
      return
    }

    const timer = window.setInterval(() => {
      void autoSaveProject()
    }, 60_000)

    return () => window.clearInterval(timer)
  }, [autoSaveProject, detachedPanel])

  useEffect(() => {
    if (detachedPanel) {
      return
    }

    syncResilienceState()
  }, [computeMode, detachedPanel, networkStatus, performanceMode, runtimeStatus, syncResilienceState])

  useEffect(() => {
    if (detachedPanel) {
      return
    }

    void syncAssetWatchTargets(buildAssetWatchTargets(Object.values(assets), currentProjectPath))
  }, [assets, currentProjectPath, detachedPanel])

  useEffect(() => {
    if (detachedPanel) {
      return
    }

    let unlisten: (() => void) | null = null
    let rescanTimer: number | null = null

    void listenForAssetWatchEvents(() => {
      if (rescanTimer !== null) {
        window.clearTimeout(rescanTimer)
      }

      rescanTimer = window.setTimeout(() => {
        rescanTimer = null
        void rescanAssetStatuses()
      }, 250)
    }).then((dispose) => {
      unlisten = dispose
    })

    return () => {
      if (rescanTimer !== null) {
        window.clearTimeout(rescanTimer)
      }

      unlisten?.()
    }
  }, [detachedPanel, rescanAssetStatuses])

  useEffect(() => {
    if (detachedPanel) {
      return
    }

    if (playbackState === 'paused') {
      return
    }

    const direction = playbackState === 'reverse' ? -1 : 1
    const timer = window.setInterval(() => {
      movePlayhead(direction * (playbackRate / 10))
    }, 100)

    return () => window.clearInterval(timer)
  }, [detachedPanel, movePlayhead, playbackRate, playbackState])

  useEffect(() => {
    if (detachedPanel) {
      previousActiveViewRef.current = activeView
      return
    }

    const fromView = previousActiveViewRef.current

    if (fromView === activeView) {
      return
    }

    const startedAt = performance.now()
    let firstFrameHandle = 0
    let secondFrameHandle = 0

    firstFrameHandle = window.requestAnimationFrame(() => {
      secondFrameHandle = window.requestAnimationFrame(() => {
        recordViewSwitchMetric({
          fromView,
          toView: activeView,
          durationMs: Number((performance.now() - startedAt).toFixed(1)),
          measuredAt: new Date().toISOString(),
        })
      })
    })

    previousActiveViewRef.current = activeView

    return () => {
      window.cancelAnimationFrame(firstFrameHandle)
      window.cancelAnimationFrame(secondFrameHandle)
    }
  }, [activeView, detachedPanel, recordViewSwitchMetric])

  useEffect(() => {
    if (detachedPanel) {
      return
    }

    async function syncNetworkState(reason: 'event' | 'probe' = 'event') {
      const isConnected = await checkNetworkConnectivity()
      const nextStatus = isConnected ? 'online' : 'offline'
      const store = useProjectStore.getState()

      if (store.ui.networkStatus === nextStatus && reason === 'probe') {
        return
      }

      useProjectStore.setState((state) => ({
        ui: {
          ...state.ui,
          networkStatus: nextStatus,
          performanceMode: nextStatus === 'offline' ? 'memory_guarded' : state.ui.performanceMode,
          statusMessage:
            nextStatus === 'online'
              ? reason === 'probe'
                ? 'Connectivity probe confirmed internet access'
                : 'Connection restored'
              : 'Offline mode active, cloud compute disabled',
        },
      }))

      if (nextStatus === 'offline' && store.project.workflow.computeMode === 'cloud') {
        toggleComputeMode()
      }
    }

    void syncNetworkState('probe')
    const probeTimer = window.setInterval(() => {
      void syncNetworkState('probe')
    }, 30_000)

    const handleOnline = () => {
      void syncNetworkState('event')
    }
    const handleOffline = () => {
      void syncNetworkState('event')
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.clearInterval(probeTimer)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [detachedPanel, toggleComputeMode])

  if (detachedPanel) {
    return (
      <main
        aria-label={`${detachedPanel} detached panel`}
        className="min-h-screen bg-[#0d0d0d] p-4 text-white"
      >
        <ErrorBoundary label={`${detachedPanel} panel`}>
          {detachedPanel === 'preview' ? <PreviewPanel /> : null}
          {detachedPanel === 'timeline' ? (
            <Suspense fallback={<PanelFallback label="Loading timeline panel" />}>
              <TimelineView />
            </Suspense>
          ) : null}
          {detachedPanel === 'inspector' ? (
            <Suspense fallback={<PanelFallback label="Loading inspector panel" />}>
              <DetachedInspectorPanel />
            </Suspense>
          ) : null}
        </ErrorBoundary>
      </main>
    )
  }

  return (
    <div
      data-meridian-app-shell
      data-density={densityMode}
      className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(224,255,0,0.08),_transparent_28%),linear-gradient(180deg,_#0d0d0d_0%,_#090909_100%)] text-white"
    >
      <div className="relative min-h-screen overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:80px_80px] opacity-20" />
        <ErrorBoundary label="Header" compact>
          <Header
            onExport={() => {
              setOpenStatusDrawer(null)
              setShowExportSheet(true)
            }}
          />
        </ErrorBoundary>
        <main
          aria-label="FluxNode workspace"
          className={`relative z-10 h-[calc(100vh-3rem)] overflow-hidden ${workspaceLayout === 'studio' ? 'p-2' : 'p-4 md:p-5'}`}
        >
          <ErrorBoundary label="Workspace">
            {/* MERIDIAN item 9: dissolved SystemPanels' thousands-of-pixels-tall content into the
                28px status bar + drawers/export sheet (docs/design/MERIDIAN-UI-SPEC.md section F's
                wireframe). This column now holds exactly the shell and the status bar (item-9
                destination map D) — the item-3 "SystemPanels capped to its own scrolling box"
                stopgap is gone; StrataShell's `flex-1` gets the full remaining height honestly.
                The drawers/export sheet/failure inspector are fixed-position overlays, not part of
                this flex column — see the `StatusOverlays` mount near the other modals below. */}
            <div className="flex h-full flex-col gap-2 overflow-hidden">
              {/* MERIDIAN strata shell (item 2) + stage row (item 3): sky (WorkflowView) and
                  ground (TimelineView) render simultaneously, separated by the horizon
                  splitter, with the preview stage/job ledger/inspector folded onto the horizon
                  itself as StrataShell's fixed-height stage row — see
                  docs/design/MERIDIAN-UI-SPEC.md sections D, F, H, J.2, J.4. PreviewPanel used
                  to render as its own row above the shell (item-2 review carried this forward
                  as a blocking note for item 3: "must fold PreviewPanel onto the horizon").
                  `flex-1 min-h-0` is the minimum needed so the shell's CSS grid rows have real
                  height to split. */}
              <ErrorBoundary label={workspaceLayout === 'studio' ? 'Studio shell' : 'Strata shell'}>
                <Suspense fallback={<PanelFallback label="Loading workspace" />}>
                  {workspaceLayout === 'studio' ? (
                    <StudioShell className="min-h-0 flex-1" />
                  ) : (
                    <StrataShell className="min-h-0 flex-1" />
                  )}
                </Suspense>
              </ErrorBoundary>
              <ErrorBoundary label="Status bar" compact>
                <StatusBar className="shrink-0" onActivate={handleStatusBarActivate} />
              </ErrorBoundary>
            </div>
          </ErrorBoundary>
        </main>
        {showWelcome ? (
          <ErrorBoundary label="Welcome flow" compact>
            <Suspense fallback={<ModalFallback label="Loading welcome flow" />}>
              <WelcomeModal />
            </Suspense>
          </ErrorBoundary>
        ) : null}
        {showSettings ? (
          <ErrorBoundary label="Settings" compact>
            <Suspense fallback={<ModalFallback label="Loading settings" />}>
              <SettingsModal />
            </Suspense>
          </ErrorBoundary>
        ) : null}
        {showWorkspaceSharing ? (
          <ErrorBoundary label="Workspace sharing" compact>
            <Suspense fallback={<ModalFallback label="Loading workspace sharing" />}>
              <WorkspaceSharingModal />
            </Suspense>
          </ErrorBoundary>
        ) : null}
        {showShortcutsHelp ? (
          <ErrorBoundary label="Shortcuts overlay" compact>
            <Suspense fallback={<ModalFallback label="Loading shortcuts overlay" />}>
              <ShortcutsCheatSheet open={showShortcutsHelp} onClose={() => setShowShortcutsHelp(false)} />
            </Suspense>
          </ErrorBoundary>
        ) : null}
        {showCommandPalette ? (
          <ErrorBoundary label="Command palette" compact>
            <Suspense fallback={<ModalFallback label="Loading command palette" />}>
              <CommandPalette
                onClose={() => setShowCommandPalette(false)}
                onOpenShortcutsHelp={() => setShowShortcutsHelp((current) => !current)}
                onOpenExportSheet={() => {
                  setOpenStatusDrawer(null)
                  setShowExportSheet((current) => !current)
                }}
                onOpenStatusDrawer={openStatusDrawerExclusive}
              />
            </Suspense>
          </ErrorBoundary>
        ) : null}
        <ErrorBoundary label="Status overlays" compact>
          <Suspense fallback={null}>
            <StatusOverlays
              openDrawer={openStatusDrawer}
              onCloseDrawer={() => setOpenStatusDrawer(null)}
              showExportSheet={showExportSheet}
              onCloseExportSheet={() => setShowExportSheet(false)}
              inspectorJobId={inspectorJobId}
              onInspect={(jobId) => setInspectorJobId(jobId)}
              onCloseInspector={() => setInspectorJobId(null)}
            />
          </Suspense>
        </ErrorBoundary>
        <ErrorBoundary label="Notifications" compact>
          <ErrorToasts />
        </ErrorBoundary>
        {showCopilot ? (
          <ErrorBoundary label="Copilot" compact>
            <Suspense fallback={null}>
              <CopilotPanel onClose={() => setShowCopilot(false)} />
            </Suspense>
          </ErrorBoundary>
        ) : (
          <button
            type="button"
            onClick={() => setShowCopilot(true)}
            aria-label="Open copilot"
            className="fixed bottom-4 right-4 z-40 rounded-full border border-[#e0ff00]/40 bg-[#111214]/90 px-4 py-2 text-sm font-semibold text-[#e0ff00] shadow-[0_18px_50px_rgba(0,0,0,0.4)] backdrop-blur-xl transition hover:bg-[#e0ff00]/10"
          >
            Copilot
          </button>
        )}
      </div>
    </div>
  )
}

export function PanelFallback({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <section
      aria-label={label}
      className={`rounded-[1.75rem] border border-white/10 bg-[#111214]/85 p-5 text-sm text-[#9ca3af] shadow-[0_18px_50px_rgba(0,0,0,0.28)] ${compact ? 'min-h-24' : 'min-h-64'}`}
    >
      <div className="flex h-full items-center justify-center rounded-[1.25rem] border border-dashed border-white/10 bg-black/20 px-6 py-8 text-center">
        {label}
      </div>
    </section>
  )
}

function ModalFallback({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-[1.75rem] border border-white/10 bg-[#111214] p-6 text-center text-sm text-[#9ca3af] shadow-[0_30px_120px_rgba(0,0,0,0.55)]">
        {label}
      </div>
    </div>
  )
}
