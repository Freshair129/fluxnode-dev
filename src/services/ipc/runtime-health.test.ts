import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invokeCommand } from './tauri-commands'
import { isTauriRuntime } from './tauri-runtime'
import { readRuntimeHealth } from './runtime-health'

vi.mock('./tauri-commands', () => ({ invokeCommand: vi.fn() }))
vi.mock('./tauri-runtime', () => ({ isTauriRuntime: vi.fn() }))

const mockedInvokeCommand = vi.mocked(invokeCommand)
const mockedIsTauriRuntime = vi.mocked(isTauriRuntime)

describe('readRuntimeHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedIsTauriRuntime.mockReturnValue(true)
  })

  it('parses the JSON string returned by the native health command', async () => {
    mockedInvokeCommand.mockResolvedValue(
      JSON.stringify({
        status: 'ok',
        app_data_dir: 'G:/AI-Studio/FluxNode',
        os: 'windows',
        os_version: 'Windows',
        arch: 'x86_64',
        cpu_cores: 16,
        total_memory_gb: 32,
        available_memory_gb: 12,
        disk_free_gb: 100,
        disk_capacity_gb: 500,
        vram_total_gb: 12,
        vram_used_gb: 4,
        vram_utilization_pct: 33.3,
      }),
    )

    const health = await readRuntimeHealth()

    expect(health.status).toBe('ok')
    expect(health.os).toBe('windows')
    expect(health.arch).toBe('x86_64')
    expect(health.cpuCores).toBe(16)
    expect(health.totalMemoryGb).toBe(32)
    expect(health.availableMemoryGb).toBe(12)
    expect(health.vramTotalGb).toBe(12)
  })

  it('returns degraded telemetry when the native health payload is invalid', async () => {
    mockedInvokeCommand.mockResolvedValue('{invalid json')

    const health = await readRuntimeHealth()

    expect(health.backend).toBe('tauri')
    expect(health.status).toBe('degraded')
    expect(health.totalMemoryGb).toBeNull()
    expect(health.availableMemoryGb).toBeNull()
  })
})
