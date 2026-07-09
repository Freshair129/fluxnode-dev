import { useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { isTauriRuntime } from '../../services/ipc/tauri-runtime'

/**
 * Drives drag-active highlighting + drop handling for a single drop target.
 *
 * Tauri v2 intercepts native OS drag-drop at the webview level by default, so
 * regular HTML5 `dragover`/`drop` DOM events never receive real file paths
 * inside the desktop app — only the browser (`npm run dev`) fallback does.
 * In Tauri mode we instead subscribe to `getCurrentWebview().onDragDropEvent`
 * and hit-test its window-relative drop position against this zone's
 * bounding rect so only drops that actually land on this element register.
 */
export function useFileDropZone<T extends HTMLElement>(onFilesDropped: (paths: string[]) => void) {
  const zoneRef = useRef<T | null>(null)
  const [isActive, setIsActive] = useState(false)
  const onFilesDroppedRef = useRef(onFilesDropped)
  onFilesDroppedRef.current = onFilesDropped

  useEffect(() => {
    if (!isTauriRuntime()) {
      return
    }

    let unlisten: (() => void) | null = null
    let disposed = false

    function isPointInsideZone(x: number, y: number) {
      const bounds = zoneRef.current?.getBoundingClientRect()

      if (!bounds) {
        return false
      }

      return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom
    }

    void import('@tauri-apps/api/webview').then(({ getCurrentWebview }) => {
      if (disposed) {
        return
      }

      void getCurrentWebview()
        .onDragDropEvent((event) => {
          const payload = event.payload

          if (payload.type === 'enter' || payload.type === 'over') {
            setIsActive(isPointInsideZone(payload.position.x, payload.position.y))
            return
          }

          if (payload.type === 'drop') {
            const inside = isPointInsideZone(payload.position.x, payload.position.y)
            setIsActive(false)

            if (inside && payload.paths.length > 0) {
              onFilesDroppedRef.current(payload.paths)
            }
            return
          }

          setIsActive(false)
        })
        .then((dispose) => {
          if (disposed) {
            dispose()
          } else {
            unlisten = dispose
          }
        })
    })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  const browserDragHandlers = {
    onDragOver: (event: DragEvent<T>) => {
      if (isTauriRuntime()) {
        return
      }
      event.preventDefault()
      setIsActive(true)
    },
    onDragLeave: (event: DragEvent<T>) => {
      if (isTauriRuntime()) {
        return
      }
      event.preventDefault()
      setIsActive(false)
    },
    onDrop: (event: DragEvent<T>) => {
      if (isTauriRuntime()) {
        return
      }
      event.preventDefault()
      setIsActive(false)
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length > 0) {
        // Browsers never expose an absolute filesystem path for security
        // reasons, so we can only forward the file names here.
        onFilesDroppedRef.current(files.map((file) => file.name))
      }
    },
  }

  return { zoneRef, isActive, browserDragHandlers }
}
