import { invokeCommand } from './tauri-commands'
import { isTauriRuntime } from './tauri-runtime'
import type { DetachedPanelKind, DetachedPanelLayout } from '../../domain/project/types'
import { listen } from '@tauri-apps/api/event'

interface DetachedPanelWindowPayload {
  detached: boolean
  width: number
  height: number
  x: number | null
  y: number | null
}

export interface DetachedPanelStateEnvelope {
  sourceWindowId: string
  transactionId: string
  emittedAt: string
  snapshot: unknown
}

export async function openDetachedPanelWindow(
  panel: DetachedPanelKind,
  layout: DetachedPanelLayout,
): Promise<DetachedPanelLayout> {
  if (!isTauriRuntime()) {
    return layout
  }

  const response = await invokeCommand<string>('panel_window_open', {
    panel,
    width: layout.width,
    height: layout.height,
    x: layout.x,
    y: layout.y,
  })

  return JSON.parse(response) as DetachedPanelWindowPayload
}

export async function closeDetachedPanelWindow(panel: DetachedPanelKind): Promise<DetachedPanelLayout | null> {
  if (!isTauriRuntime()) {
    return null
  }

  const response = await invokeCommand<string | null>('panel_window_close', { panel })
  return response ? (JSON.parse(response) as DetachedPanelWindowPayload) : null
}

export async function broadcastDetachedPanelState(envelope: DetachedPanelStateEnvelope): Promise<void> {
  if (!isTauriRuntime()) {
    return
  }

  await invokeCommand('panel_window_broadcast_state', {
    snapshotJson: JSON.stringify(envelope),
  })
}

export async function listenForDetachedPanelState(handler: (envelope: DetachedPanelStateEnvelope) => void) {
  if (!isTauriRuntime()) {
    return () => {}
  }

  return listen<DetachedPanelStateEnvelope>('fluxnode://detached-panel-state', (event) => {
    handler(event.payload)
  })
}

export function getDetachedPanelFromLocation(): DetachedPanelKind | null {
  if (typeof window === 'undefined') {
    return null
  }

  const params = new URLSearchParams(window.location.search)
  const panel = params.get('panel')
  return panel === 'preview' || panel === 'timeline' || panel === 'inspector' ? panel : null
}
