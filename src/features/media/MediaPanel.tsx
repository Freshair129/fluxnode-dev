import { useMemo, useState } from 'react'
import { ChevronLeft, FileQuestion, FileVideo, Image as ImageIcon, Music, Plus, RefreshCw, Search, Upload } from 'lucide-react'
import { useProjectStore } from '../../store/project-store'
import { useFileDropZone } from '../timeline/useFileDropZone'
import { isTauriRuntime } from '../../services/ipc/tauri-runtime'
import type { Asset } from '../../domain/project/types'

/** Drag payload type for media-bin → timeline drags (read by StudioTimeline's lane drop). */
export const MEDIA_DRAG_MIME = 'application/x-fluxnode-asset-id'

function assetTypeIcon(type: Asset['type']) {
  switch (type) {
    case 'video':
      return FileVideo
    case 'audio':
      return Music
    case 'image':
      return ImageIcon
    default:
      return FileQuestion
  }
}

function formatDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) {
    return null
  }

  const whole = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(whole / 60)
  const secs = whole % 60
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

/**
 * Studio-layout media bin (CapCut grammar: import lives here, assets are draggable onto the
 * timeline, double-click appends to the matching track). Replaces the asset list that used to sit
 * inside TimelineView's sidebar.
 */
export interface MediaPanelProps {
  /** When provided, a collapse chevron renders in the panel header (studio shell rail toggle). */
  onCollapse?: () => void
}

export function MediaPanel({ onCollapse }: MediaPanelProps = {}) {
  const assets = useProjectStore((state) => state.project.assets.assets)
  const assetThumbnails = useProjectStore((state) => state.assetThumbnails)
  const importAssetFromPath = useProjectStore((state) => state.importAssetFromPath)
  const rescanAssetStatuses = useProjectStore((state) => state.rescanAssetStatuses)
  const addClipFromAsset = useProjectStore((state) => state.addClipFromAsset)
  const [query, setQuery] = useState('')

  const assetList = useMemo(() => {
    const list = Object.values(assets)
    const needle = query.trim().toLowerCase()
    const filtered = needle.length > 0 ? list.filter((asset) => asset.name.toLowerCase().includes(needle)) : list
    return filtered.sort((a, b) => a.name.localeCompare(b.name))
  }, [assets, query])

  const handleFilesDropped = (paths: string[]) => {
    if (isTauriRuntime()) {
      for (const path of paths) {
        void importAssetFromPath(path)
      }
      return
    }

    void importAssetFromPath()
  }

  const dropZone = useFileDropZone<HTMLDivElement>(handleFilesDropped)

  return (
    <section
      aria-label="Media bin"
      ref={dropZone.zoneRef}
      {...dropZone.browserDragHandlers}
      className={`flex h-full min-h-0 flex-col bg-surface-2 outline-2 -outline-offset-2 transition ${
        dropZone.isActive ? 'outline-accent/60' : 'outline-transparent'
      }`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-hairline px-3 py-[var(--meridian-gutter)]">
        <div className="flex items-center gap-1">
          {onCollapse ? (
            <button
              type="button"
              aria-label="Collapse media bin"
              title="Collapse media bin"
              aria-expanded
              onClick={onCollapse}
              className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-md)] text-text-secondary transition hover:bg-white/8 hover:text-white"
            >
              <ChevronLeft size={13} aria-hidden="true" />
            </button>
          ) : null}
          <p className="text-[11px] uppercase tracking-[0.22em] text-text-secondary">Media</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Rescan asset files"
            title="Rescan asset files"
            onClick={() => void rescanAssetStatuses()}
            className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] text-text-secondary transition hover:bg-white/8 hover:text-white"
          >
            <RefreshCw size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => void importAssetFromPath()}
            className="inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-md)] bg-accent px-2.5 text-xs font-semibold text-black transition hover:brightness-95"
          >
            <Upload size={13} aria-hidden="true" />
            Import
          </button>
        </div>
      </div>

      <div className="shrink-0 px-3 pt-2">
        <label className="flex items-center gap-2 rounded-[var(--radius-md)] border border-white/10 bg-black/25 px-2.5 py-1.5 focus-within:border-accent/50">
          <Search size={13} aria-hidden="true" className="shrink-0 text-text-secondary" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search media"
            aria-label="Search media"
            className="w-full min-w-0 bg-transparent text-xs text-white outline-none placeholder:text-text-secondary"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {assetList.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-white/12 p-4 text-center">
            <Upload size={20} aria-hidden="true" className="text-text-secondary" />
            <p className="text-sm text-text-data">
              {query.trim().length > 0 ? 'No media matches your search.' : 'Drop files here or import to start editing.'}
            </p>
            {query.trim().length === 0 ? (
              <button
                type="button"
                onClick={() => void importAssetFromPath()}
                className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-black transition hover:brightness-95"
              >
                Import media
              </button>
            ) : null}
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-2" aria-label="Imported media">
            {assetList.map((asset) => {
              const TypeIcon = assetTypeIcon(asset.type)
              const duration = formatDuration(asset.duration)
              const thumbnail = assetThumbnails[asset.id]?.thumbnailPath ?? null

              return (
                <li key={asset.id} className="group relative">
                  <div
                    role="button"
                    tabIndex={0}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(MEDIA_DRAG_MIME, asset.id)
                      event.dataTransfer.effectAllowed = 'copy'
                    }}
                    onDoubleClick={() => addClipFromAsset(asset.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        addClipFromAsset(asset.id)
                      }
                    }}
                    aria-label={`${asset.name}, ${asset.type}${duration ? `, ${duration}` : ''}. Drag onto the timeline, or press Enter to add.`}
                    title={`${asset.name} — drag to timeline, double-click to add`}
                    className="cursor-grab overflow-hidden rounded-[var(--radius-md)] border border-white/8 bg-black/25 transition hover:border-white/20 active:cursor-grabbing"
                  >
                    <div className="relative aspect-video w-full bg-[#0c0d0f]">
                      {thumbnail ? (
                        <img src={thumbnail} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-text-secondary">
                          <TypeIcon size={18} aria-hidden="true" />
                        </div>
                      )}
                      {duration ? (
                        <span className="absolute bottom-1 right-1 rounded-[var(--radius-sm)] bg-black/70 px-1 py-0.5 font-mono text-[10px] tabular-nums text-text-data">
                          {duration}
                        </span>
                      ) : null}
                      {asset.status !== 'linked' ? (
                        <span
                          className={`absolute left-1 top-1 h-2 w-2 rounded-full ${
                            asset.status === 'corrupt' ? 'bg-danger' : 'bg-warn'
                          }`}
                          title={asset.status === 'corrupt' ? 'Cannot decode' : 'Media offline'}
                        />
                      ) : null}
                    </div>
                    <p className="truncate px-1.5 py-1 text-[11px] text-text-data">{asset.name}</p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Add ${asset.name} to timeline`}
                    title="Add to timeline"
                    onClick={() => addClipFromAsset(asset.id)}
                    className="absolute right-1 top-1 hidden h-6 w-6 items-center justify-center rounded-full bg-accent text-black shadow-overlay transition hover:brightness-95 group-focus-within:flex group-hover:flex"
                  >
                    <Plus size={13} aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
