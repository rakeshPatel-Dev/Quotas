import { EventEmitter } from 'node:events'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
import { getAccountsFile } from '../config.js'
import type { Account, AccountStatus, ModelFamily, ModelQuota } from '../../shared/types.js'
import type { SecretBox } from './secretBox.js'

const modelQuotaSchema = z.object({
  modelId: z.string().min(1),
  label: z.string().min(1),
  family: z.enum(['claude', 'gemini-pro', 'gemini-flash', 'other']),
  remainingFraction: z.number().min(0).max(1).nullable(),
  resetAt: z.number().nullable(),
  isExhausted: z.boolean(),
})

const accountSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  refreshTokenEnc: z.string().min(1),
  accessExpiry: z.number().nullable().optional(),
  projectId: z.string().optional(),
  planType: z.string().optional(),
  credits: z
    .object({
      available: z.number(),
      monthly: z.number(),
      remainingFraction: z.number().min(0).max(1),
    })
    .nullable()
    .optional(),
  quota: z.array(modelQuotaSchema),
  fetchedAt: z.number().optional(),
  status: z.enum(['ok', 'refreshing', 'auth_error', 'rate_limited', 'error']),
  lastError: z.string().optional(),
  nextPollAt: z.number(),
  backoffMs: z.number(),
  paused: z.boolean(),
})

const fileSchema = z.object({
  version: z.literal(1),
  accounts: z.array(accountSchema),
})

export type AccountStoreEvents = {
  updated: [Account]
  removed: [string]
  error: [Error]
}

export interface AccountStoreOptions {
  file?: string
  saveDebounceMs?: number
}

/**
 * In-memory account map backed by a single JSON file.
 *
 * Writes are debounced and atomic (tmp file + rename), and the previous good
 * file is kept as `.bak` so a crash mid-write cannot leave an unreadable store.
 */
export class AccountStore extends EventEmitter<AccountStoreEvents> {
  readonly file: string
  private readonly backupFile: string
  private readonly tmpFile: string
  private readonly saveDebounceMs: number
  private readonly accounts = new Map<string, Account>()
  private saveTimer: NodeJS.Timeout | null = null
  private saveChain: Promise<void> = Promise.resolve()
  private loaded = false

  constructor(
    private readonly box: SecretBox,
    options: AccountStoreOptions = {},
  ) {
    super()
    this.file = options.file ?? getAccountsFile()
    this.backupFile = `${this.file}.bak`
    this.tmpFile = `${this.file}.tmp`
    this.saveDebounceMs = options.saveDebounceMs ?? 400
  }

  load(): Account[] {
    if (this.loaded) return this.list()
    this.loaded = true

    let accounts: Account[] | null = existsSync(this.file) ? this.tryRead(this.file) : null
    let fromBackup = false

    if (accounts === null && existsSync(this.backupFile)) {
      accounts = this.tryRead(this.backupFile)
      fromBackup = accounts !== null
    }

    if (accounts) {
      for (const account of accounts) this.accounts.set(account.id, account)
      if (fromBackup) {
        this.emit(
          'error',
          new Error(
            `Primary accounts file was unreadable; recovered ${accounts.length} accounts from backup`,
          ),
        )
      }
    }

    // A leftover tmp file means a crash between write and rename. Either the
    // primary loaded fine (so the tmp copy is garbage) or we just fell back to
    // the backup; in both cases it is not authoritative and must not linger.
    rmSync(this.tmpFile, { force: true })

    return this.list()
  }

  private tryRead(path: string): Account[] | null {
    try {
      const parsed = fileSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
      if (!parsed.success) {
        this.emit('error', new Error(`Invalid accounts file at ${path}: ${parsed.error.message}`))
        return null
      }
      return parsed.data.accounts
    } catch (err) {
      this.emit('error', new Error(`Could not read ${path}: ${(err as Error).message}`))
      return null
    }
  }

  list(): Account[] {
    return [...this.accounts.values()].sort((a, b) => a.email.localeCompare(b.email))
  }

  get(id: string): Account | undefined {
    return this.accounts.get(id)
  }

  /**
   * Inserts a new account or replaces an existing one with the same id.
   *
   * This is a straight replace, not a merge. Callers that re-add an account
   * (a second sign-in) are responsible for carrying over the fields they want
   * to keep; a merge would silently resurrect stale scheduling values such as a
   * `nextPollAt` that should have been reset to "poll now".
   */
  upsert(account: Account): Account {
    this.accounts.set(account.id, account)
    this.touch(account)
    return account
  }

  update(id: string, patch: Partial<Account>): Account | undefined {
    const existing = this.accounts.get(id)
    if (!existing) return undefined
    const next: Account = { ...existing, ...patch, id: existing.id }
    this.accounts.set(id, next)
    this.touch(next)
    return next
  }

  remove(id: string): boolean {
    const removed = this.accounts.delete(id)
    if (removed) {
      this.scheduleSave()
      this.emit('removed', id)
    }
    return removed
  }

  setStatus(id: string, status: AccountStatus, lastError?: string): void {
    const patch: Partial<Account> = { status }
    if (lastError !== undefined) patch.lastError = lastError
    this.update(id, patch)
  }

  sealRefreshToken(plain: string): string {
    return this.box.seal(plain)
  }

  openRefreshToken(account: Account): string {
    return this.box.open(account.refreshTokenEnc)
  }

  private touch(account: Account): void {
    this.scheduleSave()
    this.emit('updated', account)
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.save()
    }, this.saveDebounceMs)
    this.saveTimer.unref?.()
  }

  /** Serializes writes so two flushes can never interleave their renames. */
  save(): Promise<void> {
    this.saveChain = this.saveChain.then(() => this.writeNow(), () => this.writeNow())
    return this.saveChain
  }

  private writeNow(): void {
    const payload = JSON.stringify({ version: 1, accounts: this.list() }, null, 2)
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.tmpFile, payload, { mode: 0o600 })
    if (existsSync(this.file)) copyFileSync(this.file, this.backupFile)
    renameSync(this.tmpFile, this.file)
  }

  /** Cancels any pending debounce and writes immediately. Call on shutdown. */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    await this.save()
  }
}

export function emptyAccount(partial: Pick<Account, 'id' | 'email' | 'refreshTokenEnc'>): Account {
  return {
    ...partial,
    quota: [],
    status: 'ok',
    nextPollAt: 0,
    backoffMs: 0,
    paused: false,
  }
}

export type { ModelFamily, ModelQuota }
