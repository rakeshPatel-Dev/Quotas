import { useEffect, useState } from 'react'

/**
 * A shared 1s ticker. Countdowns are derived from a single clock for the whole
 * app instead of one timer per component, and it costs no API calls.
 */
let subscribers = 0
let timer: ReturnType<typeof setInterval> | null = null
let current = Date.now()
const listeners = new Set<(now: number) => void>()

function start(): void {
  if (timer !== null) return
  timer = setInterval(() => {
    current = Date.now()
    for (const listener of listeners) listener(current)
  }, 1000)
}

function stop(): void {
  if (timer === null) return
  clearInterval(timer)
  timer = null
}

export function useNow(): number {
  const [now, setNow] = useState(current)

  useEffect(() => {
    listeners.add(setNow)
    subscribers += 1
    start()

    return () => {
      listeners.delete(setNow)
      subscribers -= 1
      if (subscribers === 0) stop()
    }
  }, [])

  return now
}
