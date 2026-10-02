import { AuthRevokedError, type TokenManager } from '../auth/tokenManager.js'
import type { AccountStore } from '../store/accountStore.js'
import { ApiShapeError } from './parser.js'
import { QuotaApiError, type QuotaClient } from './cloudcode.js'
import type { Account } from '../../shared/types.js'

export const STALE_AFTER_MS = 15 * 60 * 1000

/**
 * Fetches one account's quota and folds the outcome into the account record.
 *
 * Every failure path keeps the last known quota on the account and only changes
 * status, so one broken account can never blank out the others.
 */
export class QuotaService {
  constructor(
    private readonly store: AccountStore,
    private readonly tokens: TokenManager,
    private readonly client: QuotaClient,
  ) {}

  async refreshAccount(accountId: string): Promise<Account | undefined> {
    const account = this.store.get(accountId)
    if (!account) return undefined

    this.store.setStatus(accountId, 'refreshing', undefined)

    try {
      const result = await this.client.fetchQuota(accountId)
      return this.store.update(accountId, {
        quota: result.quota,
        planType: result.planType ?? account.planType,
        credits: result.credits,
        projectId: result.projectId ?? account.projectId,
        fetchedAt: Date.now(),
        status: 'ok',
        lastError: undefined,
        backoffMs: 0,
      })
    } catch (err) {
      this.recordFailure(accountId, err)
      return this.store.get(accountId)
    }
  }

  private recordFailure(accountId: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err)

    if (err instanceof AuthRevokedError) {
      this.store.update(accountId, {
        status: 'auth_error',
        paused: true,
        lastError: 'Refresh token revoked. Sign in again.',
      })
      return
    }

    if (err instanceof QuotaApiError) {
      switch (err.kind) {
        case 'auth':
          // 401 that survived a refresh, or a 403 restricted account.
          this.store.update(accountId, {
            status: 'auth_error',
            paused: err.status === 403,
            lastError: message,
          })
          return
        case 'rate_limited':
          this.store.update(accountId, {
            status: 'rate_limited',
            backoffMs: err.retryAfterMs ?? 30_000,
            lastError: message,
          })
          return
        case 'network':
        case 'server':
          // Keep showing the last known numbers; they are just stale now.
          this.store.update(accountId, { status: 'error', lastError: `${message} (showing stale data)` })
          return
        case 'shape':
          this.store.update(accountId, { status: 'error', lastError: 'API response changed shape.' })
          return
        default:
          this.store.update(accountId, { status: 'error', lastError: message })
          return
      }
    }

    if (err instanceof ApiShapeError) {
      this.store.update(accountId, {
        status: 'error',
        lastError: 'API response changed shape; quota not updated.',
      })
      return
    }

    this.store.update(accountId, { status: 'error', lastError: message })
  }
}
