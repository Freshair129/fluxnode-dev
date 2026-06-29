const CONNECTIVITY_PROBE_URLS = [
  'https://www.gstatic.com/generate_204',
  'https://www.msftconnecttest.com/connecttest.txt',
] as const

const CONNECTIVITY_TIMEOUT_MS = 4_000

export async function checkNetworkConnectivity() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return false
  }

  for (const url of CONNECTIVITY_PROBE_URLS) {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), CONNECTIVITY_TIMEOUT_MS)

    try {
      await fetch(url, {
        method: 'GET',
        mode: 'no-cors',
        cache: 'no-store',
        signal: controller.signal,
      })
      return true
    } catch {
      continue
    } finally {
      window.clearTimeout(timeout)
    }
  }

  return false
}
