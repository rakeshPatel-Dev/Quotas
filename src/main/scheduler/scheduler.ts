import { EventEmitter } from 'node:events'
import pLimit from 'p-limit'
import type { Account } from '../../shared/types.js'
import type { AccountStore } from '../store/accountStore.js'
import type { QuotaService } from '../quota/service.js'

export type SchedulerOptions = {
  /** How often the tick loop wakes up to look for due accounts. */
  intervalMs?: number
  /** Normal gap between successful polls. */
  basePollMs?: number
  /** Random spread added to each successful poll so accounts do not sync up. */
  jitterMs?: number
  maxConcurrent?: number
  /** First backoff after a failure, doubled on each subsequent failure. */
  initialBackoffMs?: number
  maxBackoffMs?: number
  now?: () => number
  random?: () => number
}

export type SchedulerEvents = {
  'account:updated': [Account]
  tick: [{ due: number; fetched: number }]
  error: [Error]
}

const DEFAULTS = {
  intervalMs: 5_000,
  basePollMs: 4 * 60_000,
  jitterMs: 30_000,
  maxConcurrent: 3,
  initialBackoffMs: 30_000,
  maxBackoffMs: 30 * 60_000,
}

/**
 * Polls every account on its own schedule.
 *
 * Each account carries its own `nextPollAt` and `backoffMs`, so a rate-limited
 * or broken account delays only itself. Fetches run through a concurrency
 * limiter, and every account's outcome is published the moment it settles
 * rather than after the slowest one in the batch.
 */
export class Scheduler extends EventEmitter<SchedulerEvents> {
  private readonly intervalMs: number
  private readonly basePollMs: number
  private readonly jitterMs: number
  private readonly maxConcurrent: number
  private readonly initialBackoffMs: number
  private readonly maxBackoffMs: number
  private readonly now: () => number
  private readonly random: () => number
  private readonly limit: ReturnType<typeof pLimit>

  /** Accounts with a fetch currently running, so a tick cannot double-fetch. */
  private readonly inFlight = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private ticking = false

  constructor(
    private readonly store: AccountStore,
    private readonly service: QuotaService,
    options: SchedulerOptions = {},
  ) {
    super()
    this.intervalMs = options.intervalMs ?? DEFAULTS.intervalMs
    this.basePollMs = options.basePollMs ?? DEFAULTS.basePollMs
    this.jitterMs = options.jitterMs ?? DEFAULTS.jitterMs
    this.maxConcurrent = options.maxConcurrent ?? DEFAULTS.maxConcurrent
    this.initialBackoffMs = options.initialBackoffMs ?? DEFAULTS.initialBackoffMs
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULTS.maxBackoffMs
    this.now = options.now ?? Date.now
    this.random = options.random ?? Math.random
    this.limit = pLimit(this.maxConcurrent)
  }

  /** Accounts eligible to be polled right now. */
  dueAccounts(): Account[] {
    const now = this.now()
    return this.store
      .list()
      .filter(
        (account) =>
          !account.paused && !this.inFlight.has(account.id) && account.nextPollAt <= now,
      )
  }

  /**
   * Polls every due account once. Safe to call concurrently: overlapping ticks
   * collapse into one, and an account already being fetched is skipped.
   */
  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true

    try {
      const due = this.dueAccounts()
      if (due.length === 0) {
        this.emit('tick', { due: 0, fetched: 0 })
        return
      }

      this.markInFlight(due)
      this.emit('tick', { due: due.length, fetched: due.length })

      // allSettled, never all: a rejected account must not abort the batch.
      const results = await Promise.allSettled(
        due.map((account) => this.limit(() => this.service.refreshAccount(account.id))),
      )

      results.forEach((result, index) => {
        const account = due[index]!
        if (result.status === 'rejected') {
          this.emit('error', result.reason as Error)
          this.backoff(account, 'error', (result.reason as Error).message)
        } else {
          this.settle(account)
        }
      })
    } finally {
      this.ticking = false
    }
  }

  private markInFlight(accounts: Account[]): void {
    for (const account of accounts) this.inFlight.add(account.id)
  }

  /**
   * Applies the outcome of one finished fetch to that account's schedule, then
   * publishes it. Called per account so the UI updates as results land.
   */
  private settle(previous: Account): void {
    this.inFlight.delete(previous.id)
    const account = this.store.get(previous.id)
    if (!account) return

    const patch =
      account.status === 'auth_error'
        ? // Nothing will fix a revoked grant; wait for the user to sign in.
          { paused: true, nextPollAt: Number.MAX_SAFE_INTEGER }
        : account.status === 'rate_limited' || account.status === 'error'
          ? this.backoffPatch(account)
          : this.successPatch()

    const updated = this.store.update(previous.id, patch)
    if (updated) this.emit('account:updated', updated)
  }

  private successPatch(): Partial<Account> {
    // Jitter keeps a batch of accounts from re-polling in lockstep forever.
    const jitter = this.jitterMs > 0 ? this.random() * this.jitterMs : 0
    return {
      status: 'ok',
      lastError: undefined,
      backoffMs: 0,
      nextPollAt: this.now() + this.basePollMs + jitter,
    }
  }

  private backoffPatch(account: Account): Partial<Account> {
    const backoffMs = this.nextBackoff(account.backoffMs)
    return { backoffMs, nextPollAt: this.now() + backoffMs }
  }

  /** Doubles the previous backoff, or starts at the initial value. */
  nextBackoff(previous: number): number {
    return Math.min(previous > 0 ? previous * 2 : this.initialBackoffMs, this.maxBackoffMs)
  }

  private backoff(account: Account, status: Account['status'], message: string): void {
    this.inFlight.delete(account.id)
    const backoffMs = this.nextBackoff(account.backoffMs)
    const updated = this.store.update(account.id, {
      status,
      lastError: message,
      backoffMs,
      nextPollAt: this.now() + backoffMs,
    })
    if (updated) this.emit('account:updated', updated)
  }

  /** Forces a fetch now, ignoring the schedule. Used by the UI refresh button. */
  async refreshNow(id: string | 'all'): Promise<void> {
    const targets =
      id === 'all'
        ? this.store.list().filter((account) => !account.paused && !this.inFlight.has(account.id))
        : [this.store.get(id)].filter((account): account is Account => account !== undefined)

    this.markInFlight(targets)

    const results = await Promise.allSettled(
      targets.map((account) => this.limit(() => this.service.refreshAccount(account.id))),
    )

    results.forEach((result, index) => {
      const account = targets[index]!
      if (result.status === 'rejected') {
        this.backoff(account, 'error', (result.reason as Error).message)
      } else {
        this.settle(account)
      }
    })
  }

  /** Sets an account's paused flag. Unpausing makes it due immediately. */
  setPaused(id: string, paused: boolean): void {
    this.store.update(id, {
      paused,
      nextPollAt: paused ? Number.MAX_SAFE_INTEGER : 0,
      backoffMs: paused ? 0 : this.store.get(id)?.backoffMs ?? 0,
    })
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.tick().catch((err: unknown) => this.emit('error', err as Error))
    }, this.intervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  get running(): boolean {
    return this.timer !== null
  }
}
