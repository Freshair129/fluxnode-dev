import { Cloud, Cpu, Download, FileVideo, Menu as MenuIcon, PanelsTopLeft, Redo2, Settings2, Undo2, WifiOff } from 'lucide-react'
import {
  createProjectWithPicker,
  openProjectWithPicker,
  saveProjectAsWithPicker,
} from '../../services/project-file-actions'
import { useProjectStore } from '../../store/project-store'
import { IconButton } from '../../components/IconButton'
import { Menu, MenuItem } from '../../components/Menu'

export interface HeaderProps {
  /** Opens the export sheet (owned by App, same surface the status bar toggles). */
  onExport?: () => void
}

/**
 * Slim single-row top bar (48px) — CapCut/Premiere grammar: project identity + file verbs on the
 * left, the Edit/Nodes workspace switch in the center, and Export as the one accent action on the
 * right. Everything that used to be a labeled pill here now lives in the File and View menus; the
 * status rows moved to the status bar, keeping only the aria-live status message.
 */
export function Header({ onExport }: HeaderProps = {}) {
  const projectName = useProjectStore((state) => state.project.meta.name)
  const activeView = useProjectStore((state) => state.ui.activeView)
  const computeMode = useProjectStore((state) => state.project.workflow.computeMode)
  const proxyEnabled = useProjectStore((state) => state.project.settings.proxyEnabled)
  const statusMessage = useProjectStore((state) => state.ui.statusMessage)
  const currentProjectPath = useProjectStore((state) => state.ui.currentProjectPath)
  const panelLayouts = useProjectStore((state) => state.project.meta.panelLayouts)
  const sharing = useProjectStore((state) => state.project.meta.sharing)
  const defaultProjectDirectory = useProjectStore((state) => state.preferences.defaultProjectDirectory)
  const density = useProjectStore((state) => state.preferences.density)
  const workspaceLayout = useProjectStore((state) => state.preferences.workspaceLayout)
  const lastSavedAt = useProjectStore((state) => state.ui.lastSavedAt)
  const networkStatus = useProjectStore((state) => state.ui.networkStatus)
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
  const setDensityMode = useProjectStore((state) => state.setDensityMode)
  const setWorkspaceLayout = useProjectStore((state) => state.setWorkspaceLayout)
  const undoCount = useProjectStore((state) => state.history.undoStack.length)
  const redoCount = useProjectStore((state) => state.history.redoStack.length)

  return (
    <header
      aria-label="Application header"
      className="relative z-20 flex h-12 items-center gap-3 border-b border-hairline bg-black/45 px-3 backdrop-blur-xl"
    >
      {/* Left: identity + file verbs */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div
          aria-hidden="true"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-accent text-xs font-black text-black"
        >
          F
        </div>

        <Menu label="File menu" icon={<MenuIcon size={15} aria-hidden="true" />}>
          <MenuItem
            label="New Project…"
            onClick={() => void createProjectWithPicker(newProject, createProjectAtPath, defaultProjectDirectory)}
          />
          <MenuItem
            label="Open Project…"
            onClick={() => void openProjectWithPicker(openProjectFromPath, defaultProjectDirectory)}
          />
          <MenuItem label="Save" onClick={() => void saveProject()} />
          <MenuItem label="Save As…" onClick={() => void saveProjectAsWithPicker(saveProjectAs, defaultProjectDirectory)} />
          {recentProjects.length > 0 ? (
            <>
              <div role="separator" className="my-1 border-t border-white/8" />
              {recentProjects.slice(0, 5).map((entry) => (
                <MenuItem key={entry.path} label={`Recent: ${entry.name}`} onClick={() => void openProjectFromPath(entry.path)} />
              ))}
            </>
          ) : null}
          <div role="separator" className="my-1 border-t border-white/8" />
          <MenuItem
            label={sharing.enabled ? `Share Workspace (${sharing.collaborators.length})` : 'Share Workspace'}
            onClick={openWorkspaceSharing}
            pressed={sharing.enabled}
          />
        </Menu>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate font-display text-sm font-semibold tracking-tight text-white" title={currentProjectPath ?? projectName}>
              {projectName}
            </h1>
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${lastSavedAt ? 'bg-success' : 'bg-warn'}`}
              title={lastSavedAt ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}` : 'Not saved yet'}
            />
          </div>
          <p aria-live="polite" className="truncate text-[10px] leading-tight text-text-secondary">
            {statusMessage}
          </p>
        </div>

        <div className="ml-1 flex shrink-0 items-center gap-1">
          <IconButton size="sm" disabled={undoCount === 0} label="Undo" title="Undo (Ctrl+Z)" onClick={undo}>
            <Undo2 size={14} />
          </IconButton>
          <IconButton size="sm" disabled={redoCount === 0} label="Redo" title="Redo (Ctrl+Shift+Z)" onClick={redo}>
            <Redo2 size={14} />
          </IconButton>
        </div>
      </div>

      {/* Center: workspace switch. Accessible names stay "Timeline view"/"Workflow view" — the
          command registry, docs, and e2e suite address them by those names. */}
      <div className="flex shrink-0 rounded-full border border-white/10 bg-[#1a1a1b]/90 p-0.5" role="group" aria-label="Workspace">
        <WorkspaceTab active={activeView === 'timeline'} label="Timeline view" text="Edit" onClick={() => setActiveView('timeline')} />
        <WorkspaceTab active={activeView === 'workflow'} label="Workflow view" text="Nodes" onClick={() => setActiveView('workflow')} />
      </div>

      {/* Right: mode toggles + settings + export */}
      <div className="flex flex-1 items-center justify-end gap-1.5">
        {networkStatus === 'offline' ? (
          <span
            role="status"
            title="Offline — cloud compute disabled, local editing continues"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-warn/30 bg-warn/10 text-warn"
          >
            <WifiOff size={14} aria-hidden="true" />
            <span className="sr-only">Offline mode active. Cloud compute is disabled.</span>
          </span>
        ) : null}

        <button
          type="button"
          onClick={toggleComputeMode}
          disabled={networkStatus === 'offline'}
          aria-label={`Switch compute mode. Current mode ${computeMode}.`}
          title={computeMode === 'local' ? 'Local compute — click for cloud' : 'Cloud compute — click for local'}
          className="hidden h-8 items-center gap-1.5 rounded-full border border-white/10 bg-[#1a1a1b]/90 px-3 text-xs font-medium text-white transition hover:border-cloud/50 disabled:cursor-not-allowed disabled:opacity-45 md:inline-flex"
        >
          {computeMode === 'local' ? (
            <Cpu size={13} className="text-accent" aria-hidden="true" />
          ) : (
            <Cloud size={13} className="text-cloud" aria-hidden="true" />
          )}
          {computeMode === 'local' ? 'Local' : 'Cloud'}
        </button>

        <button
          type="button"
          onClick={toggleProxyMode}
          aria-pressed={proxyEnabled}
          aria-label={`Toggle proxy mode. Proxy mode is ${proxyEnabled ? 'on' : 'off'}.`}
          title={proxyEnabled ? 'Proxy mode on' : 'Proxy mode off'}
          className={`hidden h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition md:inline-flex ${
            proxyEnabled ? 'border-accent/30 bg-accent/10 text-accent-soft' : 'border-white/10 bg-[#1a1a1b]/90 text-text-secondary hover:text-white'
          }`}
        >
          <FileVideo size={13} aria-hidden="true" />
          Proxy
        </button>

        <Menu label="View options" icon={<PanelsTopLeft size={15} aria-hidden="true" />}>
          <MenuItem
            label="Studio Layout (media / monitor / timeline)"
            pressed={workspaceLayout === 'studio'}
            onClick={() => void setWorkspaceLayout('studio')}
          />
          <MenuItem
            label="Strata Layout (sky / horizon / ground)"
            pressed={workspaceLayout === 'strata'}
            onClick={() => void setWorkspaceLayout('strata')}
          />
          <div role="separator" className="my-1 border-t border-white/8" />
          <MenuItem label="Density: Comfortable" pressed={density === 'comfortable'} onClick={() => void setDensityMode('comfortable')} />
          <MenuItem label="Density: Compact" pressed={density === 'compact'} onClick={() => void setDensityMode('compact')} />
          <div role="separator" className="my-1 border-t border-white/8" />
          <MenuItem
            label="Detach Preview"
            pressed={panelLayouts.preview.detached}
            onClick={() => void (panelLayouts.preview.detached ? closeDetachedPanel('preview') : openDetachedPanel('preview'))}
          />
          <MenuItem
            label="Detach Timeline"
            pressed={panelLayouts.timeline.detached}
            onClick={() => void (panelLayouts.timeline.detached ? closeDetachedPanel('timeline') : openDetachedPanel('timeline'))}
          />
          <MenuItem
            label="Detach Inspector"
            pressed={panelLayouts.inspector.detached}
            onClick={() => void (panelLayouts.inspector.detached ? closeDetachedPanel('inspector') : openDetachedPanel('inspector'))}
          />
        </Menu>

        <IconButton size="sm" label="Open settings" onClick={openSettings}>
          <Settings2 size={14} />
        </IconButton>

        <button
          type="button"
          onClick={() => onExport?.()}
          aria-label="Open export sheet"
          className="ml-1 inline-flex h-8 items-center gap-1.5 rounded-full bg-accent px-4 text-xs font-semibold text-black transition hover:brightness-95"
        >
          <Download size={13} aria-hidden="true" />
          Export
        </button>
      </div>
    </header>
  )
}

function WorkspaceTab({
  active,
  label,
  text,
  onClick,
}: {
  active: boolean
  label: string
  text: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={`rounded-full px-4 py-1.5 text-xs font-medium transition ${
        active ? 'bg-white text-black' : 'text-[#8f96a3] hover:text-white'
      }`}
    >
      {text}
    </button>
  )
}
