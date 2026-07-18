/** `MM:SS:FF` (or `H:MM:SS:FF` past an hour) — the compact editorial timecode the monitors use. */
export function formatTimecode(seconds: number, fps: number): string {
  const safeSeconds = Math.max(0, seconds)
  const whole = Math.floor(safeSeconds)
  const frames = Math.floor((safeSeconds - whole) * fps)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const secs = whole % 60
  const core = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`
  return hours > 0 ? `${hours}:${core}` : core
}
