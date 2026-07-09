import { Cloud, Cpu, FolderOpen, Redo2, Save, SaveAll, Settings2, Sparkles, Undo2, WifiOff } from 'lucide-react'
import {
  createProjectWithPicker,
  openProjectWithPicker,
  saveProjectAsWithPicker,
} from '../../services/project-file-actions'
import { useProjectStore } from '../../store/project-store'
import { IconButton } from '../../components/IconButton'
import { Menu, MenuItem } from '../../components/Menu'

export function Header() {
  const projectName = useProjectStore((state) => state.project.meta.name)
  const activeView = useProjectStore((state) => state.ui.activeView)
  const computeMode = useProjectStore((state) => state.project.workflow.computeMode)
  const proxyEnabled = useProjectStore((state) => state.project.settings.proxyEnabled)
  const assets = useProjectStore((state) => state.project.assets.assets)
  const statusMessage = useProjectStore((state) => state.ui.statusMessage)
  const currentProjectPath = useProjectStore((state) => state.ui.currentProjectPath)
  const panelLayouts = useProjectStore((state) => state.project.meta.panelLayouts)
  const sharing = useProjectStore((state) => state.project.meta.sharing)
  const defaultProjectDirectory = useProjectStore((state) => state.preferences.defaultProjectDirectory)
  const lastSavedAt = useProjectStore((state) => state.ui.lastSavedAt)
  const lastAutoSavedAt = useProjectStore((state) => state.ui.lastAutoSavedAt)
  const networkStatus = useProjectStore((state) => state.ui.networkStatus)
  const performanceMode = useProjectStore((state) => state.ui.performanceMode)
  const workflowNodes = useProjectStore((state) => state.project.workflow.nodes)
  const recentProjects = useProjectStore((state) => state.recentProjects)
  const newProject = useProjectStore((state) => state.newProject)
  const createProjectAtPath = useProjectStore((state) => state.createProjectAtPath)
  const openProjectFromPath = useProjectStore((state) => state.openProjectFromPath)
  const setActiveView = useProjectStore((state) => state.setActiveView)
  const toggleComputeMode = useProjectStore((state) => state.toggleComputeMode)
  const toggleProxyMode = useProjectStore((state) => state.toggleProxyMode)
  const saveProject = useProjectStore((state) => state.saveProject)
  const saveProjectAs = useProjectStore((state) => state.saveProjectAs)
  const undo = useProjectStore((state) => state.undo)
  const redo = useProjectStore((state) => state.redo)
  const openSettings = useProjectStore((state) => state.openSettings)
  const openWorkspaceSharing = useProjectStore((state) => state.openWorkspaceSharing)
  const openDetachedPanel = useProjectStore((state) => state.openDetachedPanel)
  const closeDetachedPanel = useProjectStore((state) => state.closeDetachedPanel)
  const undoCount = useProjectStore((state) => state.history.undoStack.length)
  const redoCount = useProjectStore((state) => state.history.redoStack.length)
  const proxyCount = Object.values(assets).filter((asset) => asset.proxyPath).length
  const activeCollaboratorCount = sharing.collaborators.length
  const offlineBlockedNodeCount = workflowNodes.filter((node) => {
    if (node.type !== 'ai_generate' && node.type !== 'ai_upscale') {
      return false
    }

    if (!('computeSource' in node.data)) {
      return false
    }

    const effectiveSource = node.data.computeSource === 'project' ? computeMode : node.data.computeSource
    return networkStatus === 'offline' && effectiveSource === 'cloud'
  }).length

  return (
    <header
      aria-label="Application header"
      className="relative z-10 border-b border-white/10 bg-black/45 px-4 py-3 backdrop-blur-xl md:px-6"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <div aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(145deg,var(--color-accent),#7cd100)] text-lg font-black text-black shadow-[0_0_36px_rgba(224,255,0,0.35)]">
            F
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.4em] text-[#8e929b]">FluxNode</p>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-lg font-semibold tracking-tight text-white md:text-xl">
                {projectName}
              </h1>
              <span className="rounded-full border border-accent/20 bg-accent/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.25em] text-accent">
                phase 1
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full border border-white/10 bg-[#1a1a1b]/90 p-1">
            <ModeButton active={activeView === 'timeline'} label="Timeline" onClick={() => setActiveView('timeline')} />
            <ModeButton active={activeView === 'workflow'} label="Workflow" onClick={() => setActiveView('workflow')} />
          </div>

          <button
            type="button"
            onClick={toggleComputeMode}
            disabled={networkStatus === 'offline'}
            aria-label={`Switch compute mode. Current mode ${computeMode}.`}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#1a1a1b]/90 px-4 py-2 text-xs font-medium text-white transition hover:border-[#3b82f6]/50 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {computeMode === 'local' ? <Cpu size={14} className="text-accent" aria-hidden="true" /> : <Cloud size={14} className="text-[#3b82f6]" aria-hidden="true" />}
            {computeMode === 'local' ? 'Local Compute' : 'Cloud Compute'}
          </button>
          <button
            type="button"
            onClick={toggleProxyMode}
            aria-pressed={proxyEnabled}
            aria-label={`Toggle proxy mode. Proxy mode is ${proxyEnabled ? 'on' : 'off'}.`}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium transition ${
              proxyEnabled
                ? 'border-accent/25 bg-accent/10 text-[#f5ffd5]'
                : 'border-white/10 bg-[#1a1a1b]/90 text-white'
            }`}
          >
            {proxyEnabled ? 'Proxy Mode On' : 'Proxy Mode Off'}
          </button>

          <button
            type="button"
            onClick={() => void createProjectWithPicker(newProject, createProjectAtPath, defaultProjectDirectory)}
            aria-label="Create a new project"
            className="rounded-full border border-white/10 bg-[#1a1a1b]/90 px-4 py-2 text-xs font-medium text-white transition hover:border-white/20"
          >
            New Project
          </button>
          <IconButton label="Open project" onClick={() => void openProjectWithPicker(openProjectFromPath, defaultProjectDirectory)}>
            <FolderOpen size={16} />
          </IconButton>
          <IconButton disabled={undoCount === 0} label="Undo" onClick={undo}>
            <Undo2 size={16} />
          </IconButton>
          <IconButton disabled={redoCount === 0} label="Redo" onClick={redo}>
            <Redo2 size={16} />
          </IconButton>
          <IconButton label="Save project" onClick={() => void saveProject()}>
            <Save size={16} />
          </IconButton>
          <IconButton label="Save project as" onClick={() => void saveProjectAsWithPicker(saveProjectAs, defaultProjectDirectory)}>
            <SaveAll size={16} />
          </IconButton>
          <IconButton label="Open settings" onClick={openSettings}>
            <Settings2 size={16} />
          </IconButton>
          <Menu label="More workspace actions">
            <MenuItem
              label={sharing.enabled ? `Share Workspace (${activeCollaboratorCount})` : 'Share Workspace'}
              onClick={openWorkspaceSharing}
              pressed={sharing.enabled}
            />
            <div role="separator" className="my-1 border-t border-white/8" />
            <MenuItem
              label="Detach Preview"
              pressed={panelLayouts.preview.detached}
              onClick={() =>
                void (panelLayouts.preview.detached ? closeDetachedPanel('preview') : openDetachedPanel('preview'))
              }
            />
            <MenuItem
              label="Detach Timeline"
              pressed={panelLayouts.timeline.detached}
              onClick={() =>
                void (panelLayouts.timeline.detached ? closeDetachedPanel('timeline') : openDetachedPanel('timeline'))
              }
            />
            <MenuItem
              label="Detach Inspector"
              pressed={panelLayouts.inspector.detached}
              onClick={() =>
                void (panelLayouts.inspector.detached ? closeDetachedPanel('inspector') : openDetachedPanel('inspector'))
              }
            />
          </Menu>
        </div>
      </div>

      <div
        aria-live="polite"
        className="mt-3 flex flex-col gap-2 text-xs text-[#9ea4ae] md:flex-row md:items-center md:justify-between"
      >
        <div className="inline-flex items-center gap-2">
          <Sparkles size={14} className="text-accent" aria-hidden="true" />
          <span>{statusMessage}</span>
        </div>
        <span>
          {lastSavedAt ? `Last saved ${new Date(lastSavedAt).toLocaleTimeString()}` : 'Not saved yet'}
          {lastAutoSavedAt ? ` | Autosaved ${new Date(lastAutoSavedAt).toLocaleTimeString()}` : ''}
          {` | ${networkStatus}`}
          {` | ${performanceMode.replace('_', ' ')}`}
          {` | proxies ${proxyCount}`}
          {sharing.enabled ? ` | workspace ${sharing.accessLevel.replace('_', ' ')} / ${activeCollaboratorCount} collaborator${activeCollaboratorCount === 1 ? '' : 's'}` : ''}
          {recentProjects.length > 0 ? ` | ${recentProjects.length} recent project entries` : ''}
        </span>
      </div>
      <div className="mt-2 text-[11px] text-[#7f8792]">
        {currentProjectPath ?? 'Project path not assigned yet. Use Save As to create a .fluxnode directory.'}
      </div>
      {networkStatus === 'offline' ? (
        <div
          role="status"
          className="mt-3 flex flex-wrap items-center gap-2 rounded-[1rem] border border-amber-300/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-50"
        >
          <WifiOff size={14} aria-hidden="true" />
          <span>Offline mode active. Cloud compute is disabled and FluxNode will keep local editing, save/load, proxy, and local render paths available.</span>
          {offlineBlockedNodeCount > 0 ? (
            <span className="rounded-full border border-amber-200/20 px-2 py-1 text-[10px] uppercase tracking-[0.18em]">
              {offlineBlockedNodeCount} AI node{offlineBlockedNodeCount === 1 ? '' : 's'} require internet
            </span>
          ) : null}
        </div>
      ) : null}
    </header>
  )
}

function ModeButton({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${label} view`}
      className={`rounded-full px-4 py-2 text-sm transition ${
        active ? 'bg-white text-black' : 'text-[#8f96a3] hover:text-white'
      }`}
    >
      {label}
    </button>
  )
}

