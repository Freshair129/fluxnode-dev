import type { RuntimeHealth } from '../../domain/project/types'
import { invokeCommand } from './tauri-commands'
import { isTauriRuntime } from './tauri-runtime'

interface TauriHealthResponse {
  status: string
  app_data_dir: string
  os: string
  os_version: string | null
  arch: string
  cpu_cores: number
  total_memory_gb: number | null
  available_memory_gb: number | null
  disk_free_gb: number | null
  disk_capacity_gb: number | null
  vram_total_gb: number | null
  vram_used_gb: number | null
  vram_utilization_pct: number | null
}

export async function readRuntimeHealth(): Promise<RuntimeHealth> {
  const deviceMemoryGb =
    typeof navigator !== 'undefined' && 'deviceMemory' in navigator
      ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0)
      : null

  if (!isTauriRuntime()) {
    return {
      backend: 'browser',
      status: 'ok',
      appDataDir: null,
      os: null,
      osVersion: null,
      arch: null,
      cpuCores:
        typeof navigator !== 'undefined' && navigator.hardwareConcurrency
          ? navigator.hardwareConcurrency
          : null,
      deviceMemoryGb,
      totalMemoryGb: deviceMemoryGb,
      availableMemoryGb: null,
      diskFreeGb: null,
      diskCapacityGb: null,
      vramTotalGb: null,
      vramUsedGb: null,
      vramUtilizationPct: null,
      lastCheckedAt: new Date().toISOString(),
    }
  }

  try {
    const payload = await invokeCommand<unknown>('health_ping')
    const summary =
      typeof payload === 'string'
        ? (JSON.parse(payload) as TauriHealthResponse)
        : (payload as TauriHealthResponse)
    return {
      backend: 'tauri',
      status: summary.status === 'ok' ? 'ok' : 'degraded',
      appDataDir: summary.app_data_dir,
      os: summary.os,
      osVersion: summary.os_version,
      arch: summary.arch,
      cpuCores: summary.cpu_cores,
      deviceMemoryGb,
      totalMemoryGb: summary.total_memory_gb,
      availableMemoryGb: summary.available_memory_gb,
      diskFreeGb: summary.disk_free_gb,
      diskCapacityGb: summary.disk_capacity_gb,
      vramTotalGb: summary.vram_total_gb,
      vramUsedGb: summary.vram_used_gb,
      vramUtilizationPct: summary.vram_utilization_pct,
      lastCheckedAt: new Date().toISOString(),
    }
  } catch {
    return {
      backend: 'tauri',
      status: 'degraded',
      appDataDir: null,
      os: null,
      osVersion: null,
      arch: null,
      cpuCores:
        typeof navigator !== 'undefined' && navigator.hardwareConcurrency
          ? navigator.hardwareConcurrency
          : null,
      deviceMemoryGb,
      totalMemoryGb: deviceMemoryGb,
      availableMemoryGb: null,
      diskFreeGb: null,
      diskCapacityGb: null,
      vramTotalGb: null,
      vramUsedGb: null,
      vramUtilizationPct: null,
      lastCheckedAt: new Date().toISOString(),
    }
  }
}
