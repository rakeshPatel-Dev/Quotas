import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Scheduler } from '../src/main/scheduler/scheduler.js'
import type { QuotaService } from '../src/main/quota/service.js'
import { AccountStore, emptyAccount } from '../src/main/store/accountStore.js'
import { createSecretBox } from '../src/main/store/secretBox.js'
import type { Account } from '../src/shared/types.js'

/**
 * The scheduler only cares about `QuotaService.refreshAccount`, so tests drive
 * it with a stub rather than a real one. The cast keeps that honest at compile
 * time without constructing the token/client graph.
 */
type RefreshAccount = (id: string) => Promise<Account | undefined>

let dir: string
let store: AccountStore
let now = 1_000_000

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aqt-sched-'))
  store = new AccountStore(createSecretBox({ force: 'dev-keyfile', keyFile: join(dir, 'dev.key') }), {
    file: join(dir, 'accounts.json'),
    saveDebounceMs: 0,
  })
  store.load()
  now = 1_000_000
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function addAccount(id: string, over: Partial<Account> = {}): Account {
  return store.upsert({
    ...emptyAccount({ id, email: `${id}@example.com`, refreshTokenEnc: 'sealed' }),
    ...over,
  })
}

function makeScheduler(refreshAccount: RefreshAccount, options = {}) {
  const service = { refreshAccount } as unknown as QuotaService
  return new Scheduler(store, service, {
    now: () => now,
    random: () => 0.5,
    ...options,
  })
}

const defaults = {
  basePollMs: 4 * 60_000,
  jitterMs: 30_000,
  initialBackoffMs: 30_000,
  maxBackoffMs: 30 * 60_000,
}

describe('due selection', () => {
  it('polls accounts that have never been polled', async () => {
    addAccount('a1')
    const refreshAccount = vi.fn(async () => store.get('a1'))
    const scheduler = makeScheduler(refreshAccount, defaults)

    expect(scheduler.dueAccounts().map((a) => a.id)).toEqual(['a1'])
    await scheduler.tick()
    expect(refreshAccount).toHaveBeenCalledWith('a1')
  })

  it('skips accounts whose next poll is in the future', async () => {
    addAccount('a1', { nextPollAt: now + 60_000 })
    const refreshAccount = vi.fn(async () => store.get('a1'))
    const scheduler = makeScheduler(refreshAccount, defaults)

    expect(scheduler.dueAccounts()).toEqual([])
    await scheduler.tick()
    expect(refreshAccount).not.toHaveBeenCalled()
  })

  it('polls again once nextPollAt has passed', async () => {
    addAccount('a1', { nextPollAt: now + 60_000 })
    const scheduler = makeScheduler(async () => store.get('a1'), defaults)

    now += 59_999
    expect(scheduler.dueAccounts()).toEqual([])
    now += 2
    expect(scheduler.dueAccounts().map((a) => a.id)).toEqual(['a1'])
  })

  it('never polls a paused account', async () => {
    addAccount('a1', { paused: true })
    const refreshAccount = vi.fn(async () => store.get('a1'))
    const scheduler = makeScheduler(refreshAccount, defaults)

    await scheduler.tick()
    expect(refreshAccount).not.toHaveBeenCalled()
  })
})

describe('successful scheduling', () => {
  it('reschedules with jitter and clears backoff', async () => {
    addAccount('a1', { backoffMs: 120_000 })
    const scheduler = makeScheduler(async () => store.get('a1'), {
      ...defaults,
      random: () => 0.5,
    })

    await scheduler.tick()

    // 4 minutes + half of the 30s jitter window.
    expect(store.get('a1')?.nextPollAt).toBe(now + 4 * 60_000 + 15_000)
    expect(store.get('a1')?.backoffMs).toBe(0)
    expect(store.get('a1')?.status).toBe('ok')
  })

  it('applies jitter so repeated polls do not land on the same instant', async () => {
    addAccount('a1')

    const startedAt = now
    const early = makeScheduler(async () => store.get('a1'), { ...defaults, random: () => 0 })
    await early.tick()
    const firstOffset = store.get('a1')!.nextPollAt - startedAt

    // Move past the scheduled time and poll again with the opposite jitter.
    now = store.get('a1')!.nextPollAt + 1
    const restartedAt = now
    const late = makeScheduler(async () => store.get('a1'), { ...defaults, random: () => 1 })
    await late.tick()
    const secondOffset = store.get('a1')!.nextPollAt - restartedAt

    // Both polls use the same base gap; only the jitter differs.
    expect(firstOffset).toBe(4 * 60_000)
    expect(secondOffset).toBe(4 * 60_000 + 30_000)
    expect(secondOffset - firstOffset).toBe(30_000)
  })

  it('makes a due account not due again after a successful poll', async () => {
    addAccount('a1')
    const refreshAccount = vi.fn(async () => store.get('a1'))
    const scheduler = makeScheduler(refreshAccount, defaults)

    await scheduler.tick()
    await scheduler.tick()

    expect(refreshAccount).toHaveBeenCalledTimes(1)
  })
})

describe('backoff', () => {
  it('starts at the initial delay after the first failure', async () => {
    addAccount('a1')
    store.setStatus('a1', 'rate_limited', 'slow down')
    const scheduler = makeScheduler(async () => store.get('a1'), defaults)

    await scheduler.tick()

    expect(store.get('a1')?.backoffMs).toBe(30_000)
    expect(store.get('a1')?.nextPollAt).toBe(now + 30_000)
    expect(store.get('a1')?.status).toBe('rate_limited')
  })

  it('doubles the delay on each consecutive failure', async () => {
    addAccount('a1')
    const scheduler = makeScheduler(async () => store.get('a1'), defaults)

    for (const expected of [30_000, 60_000, 120_000, 240_000]) {
      store.setStatus('a1', 'rate_limited')
      await scheduler.tick()
      expect(store.get('a1')?.backoffMs).toBe(expected)
      // Jump past the backoff so the account is due again.
      now += expected + 1
    }
  })

  it('caps the delay at the maximum', async () => {
    addAccount('a1', { backoffMs: 20 * 60_000 })
    const scheduler = makeScheduler(async () => store.get('a1'), defaults)

    store.setStatus('a1', 'rate_limited')
    await scheduler.tick()

    expect(store.get('a1')?.backoffMs).toBe(30 * 60_000)
    expect(store.get('a1')?.nextPollAt).toBe(now + 30 * 60_000)
  })

  it('clears the backoff once the account recovers', async () => {
    addAccount('a1', { backoffMs: 240_000 })
    const scheduler = makeScheduler(async () => store.get('a1'), defaults)

    await scheduler.tick()
    expect(store.get('a1')?.backoffMs).toBe(0)
  })

  it('honours a longer Retry-After from the service', async () => {
    addAccount('a1')
    // QuotaService writes the server-suggested delay into backoffMs.
    store.setStatus('a1', 'rate_limited', 'rate limited')
    store.update('a1', { backoffMs: 5 * 60_000 })
    const scheduler = makeScheduler(async () => store.get('a1'), defaults)

    await scheduler.tick()

    // 5 minutes already exceeds the doubling floor, and stays under the cap.
    expect(store.get('a1')?.backoffMs).toBe(10 * 60_000)
  })
})

describe('auth errors', () => {
  it('pauses the account and stops scheduling it', async () => {
    addAccount('a1')
    const scheduler = makeScheduler(async () => {
      store.setStatus('a1', 'auth_error', 'Refresh token revoked. Sign in again.')
      return store.get('a1')
    }, defaults)

    await scheduler.tick()

    const account = store.get('a1')
    expect(account?.status).toBe('auth_error')
    expect(account?.paused).toBe(true)
    expect(scheduler.dueAccounts()).toEqual([])

    // Even far in the future, it stays parked until the user signs in again.
    now += 10 * 24 * 60 * 60_000
    expect(scheduler.dueAccounts()).toEqual([])
  })

  it('does not poll the auth-failed account while polling healthy ones', async () => {
    addAccount('bad', { paused: true, status: 'auth_error' })
    addAccount('good')
    const refreshAccount = vi.fn(async (id: string) => store.get(id))
    const scheduler = makeScheduler(refreshAccount, defaults)

    await scheduler.tick()

    expect(refreshAccount).toHaveBeenCalledTimes(1)
    expect(refreshAccount).toHaveBeenCalledWith('good')
  })
})

describe('isolation between accounts', () => {
  it('one throwing account does not stop the others', async () => {
    addAccount('bad')
    addAccount('good1')
    addAccount('good2')

    const refreshAccount = vi.fn(async (id: string) => {
      if (id === 'bad') throw new Error('socket hang up')
      return store.get(id)
    })
    const scheduler = makeScheduler(refreshAccount, defaults)

    const errors: Error[] = []
    scheduler.on('error', (err) => errors.push(err))

    await scheduler.tick()

    expect(refreshAccount).toHaveBeenCalledTimes(3)
    expect(errors.map((e) => e.message)).toEqual(['socket hang up'])

    expect(store.get('bad')?.status).toBe('error')
    expect(store.get('bad')?.lastError).toBe('socket hang up')
    expect(store.get('bad')?.backoffMs).toBe(30_000)

    expect(store.get('good1')?.status).toBe('ok')
    expect(store.get('good1')?.backoffMs).toBe(0)
    expect(store.get('good2')?.status).toBe('ok')
  })

  it('backs off only the failing account, leaving the schedule of the rest intact', async () => {
    addAccount('bad')
    addAccount('good')
    const scheduler = makeScheduler(async (id: string) => {
      if (id === 'bad') {
        store.setStatus('bad', 'rate_limited')
        return store.get(id)
      }
      return store.get(id)
    }, defaults)

    await scheduler.tick()

    expect(store.get('bad')?.nextPollAt).toBe(now + 30_000)
    expect(store.get('good')?.nextPollAt).toBe(now + 4 * 60_000 + 15_000)
  })

  it('publishes each account as it settles, not after the whole batch', async () => {
    const order: string[] = []
    addAccount('slow')
    addAccount('fast')

    const scheduler = makeScheduler(async (id: string) => {
      if (id === 'slow') await new Promise((r) => setTimeout(r, 40))
      order.push(id)
      return store.get(id)
    }, defaults)

    const published: string[] = []
    scheduler.on('account:updated', (account) => published.push(account.id))

    await scheduler.tick()

    expect(order).toEqual(['fast', 'slow'])
    expect(published).toEqual(['fast', 'slow'])
  })
})

describe('concurrency', () => {
  it('never exceeds the concurrency cap', async () => {
    for (const id of ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7']) addAccount(id)

    let active = 0
    let peak = 0
    const scheduler = makeScheduler(async (id: string) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return store.get(id)
    }, { ...defaults, maxConcurrent: 3 })

    await scheduler.tick()

    expect(peak).toBe(3)
  })

  it('defaults to a cap of three', async () => {
    for (const id of ['a1', 'a2', 'a3', 'a4', 'a5']) addAccount(id)

    let active = 0
    let peak = 0
    const scheduler = makeScheduler(async (id: string) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return store.get(id)
    }, defaults)

    await scheduler.tick()

    expect(peak).toBe(3)
  })

  it('does not fetch an account that is already in flight', async () => {
    addAccount('a1')
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })

    const refreshAccount = vi.fn(async () => {
      await gate
      return store.get('a1')
    })
    const scheduler = makeScheduler(refreshAccount, defaults)

    const first = scheduler.tick()
    const second = scheduler.tick()
    // p-limit defers the callback, so wait for it to actually start.
    await new Promise((r) => setTimeout(r, 10))

    expect(refreshAccount).toHaveBeenCalledTimes(1)

    release()
    await Promise.all([first, second])
  })
})

describe('manual control', () => {
  it('refreshNow ignores the schedule', async () => {
    addAccount('a1', { nextPollAt: now + 60 * 60_000 })
    const refreshAccount = vi.fn(async () => store.get('a1'))
    const scheduler = makeScheduler(refreshAccount, defaults)

    await scheduler.refreshNow('a1')

    expect(refreshAccount).toHaveBeenCalledWith('a1')
    expect(store.get('a1')?.nextPollAt).toBe(now + 4 * 60_000 + 15_000)
  })

  it('refreshNow all skips paused accounts', async () => {
    addAccount('a1')
    addAccount('paused', { paused: true })
    const refreshAccount = vi.fn(async (id: string) => store.get(id))
    const scheduler = makeScheduler(refreshAccount, defaults)

    await scheduler.refreshNow('all')

    expect(refreshAccount).toHaveBeenCalledTimes(1)
    expect(refreshAccount).toHaveBeenCalledWith('a1')
  })

  it('refreshNow on an unknown id is a no-op', async () => {
    const refreshAccount = vi.fn(async () => undefined)
    const scheduler = makeScheduler(refreshAccount, defaults)

    await scheduler.refreshNow('nope')

    expect(refreshAccount).not.toHaveBeenCalled()
  })

  it('setPaused parks an account and unpausing makes it due at once', () => {
    addAccount('a1', { nextPollAt: now + 4 * 60_000, backoffMs: 60_000 })
    const scheduler = makeScheduler(async () => store.get('a1'), defaults)

    scheduler.setPaused('a1', true)
    expect(store.get('a1')?.paused).toBe(true)
    expect(scheduler.dueAccounts()).toEqual([])

    scheduler.setPaused('a1', false)
    expect(store.get('a1')?.paused).toBe(false)
    expect(store.get('a1')?.backoffMs).toBe(0)
    expect(scheduler.dueAccounts().map((a) => a.id)).toEqual(['a1'])
  })
})

describe('lifecycle', () => {
  it('start and stop drive the tick loop', async () => {
    vi.useFakeTimers()
    try {
      addAccount('a1')
      const refreshAccount = vi.fn(async () => store.get('a1'))
      const scheduler = makeScheduler(refreshAccount, { ...defaults, intervalMs: 5_000 })

      scheduler.start()
      expect(scheduler.running).toBe(true)

      await vi.advanceTimersByTimeAsync(5_000)
      expect(refreshAccount).toHaveBeenCalledTimes(1)

      scheduler.stop()
      expect(scheduler.running).toBe(false)

      await vi.advanceTimersByTimeAsync(60_000)
      expect(refreshAccount).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('start is idempotent', () => {
    const scheduler = makeScheduler(async () => undefined, defaults)
    scheduler.start()
    scheduler.start()
    scheduler.stop()
    scheduler.stop()
    expect(scheduler.running).toBe(false)
  })
})
