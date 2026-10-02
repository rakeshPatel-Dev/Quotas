/** "just now" / "4m ago" / "3h ago" / "2d ago". */
export function formatRelative(ts: number | undefined, now: number): string {
  if (!ts) return 'never'
  const seconds = Math.max(0, Math.round((now - ts) / 1000))
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/**
 * Countdown to a reset. Drops the least significant unit so the string keeps a
 * stable width per magnitude, which stops the layout jittering every second.
 */
export function formatCountdown(target: number, now: number): string {
  const ms = target - now
  if (ms <= 0) return 'due'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const rem = minutes % 60
    return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`
  }
  const days = Math.floor(hours / 24)
  const rem = hours % 24
  return rem > 0 ? `${days}d ${rem}h` : `${days}d`
}

export function formatPercent(fraction: number | null): string {
  if (fraction === null) return '—'
  const pct = Math.round(fraction * 100)
  return `${pct}%`
}
