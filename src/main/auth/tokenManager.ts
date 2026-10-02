import type { AccountStore } from '../store/accountStore.js'
import { OAuthError, refreshAccessToken } from './oauthFlow.js'

/** Refresh this far ahead of the real expiry so in-flight requests stay valid. */
const EXPIRY_BUFFER_MS = 60_000

/** Transient refresh failures get a few quick retries; permanent ones do not. */
const MAX_ATTEMPTS = 3
const BASE_DELAY_MS = 1_000

export class AuthRevokedError extends Error {
  constructor(message = 'Refresh token was revoked. Sign in again.') {
    super(message)
    this.name = 'AuthRevokedError'
  }
}

type CachedToken = { accessToken: string; accessExpiry: number }

/**
 * Owns access tokens for every account.
 *
 * Access tokens live only in memory; the store keeps the encrypted refresh
 * token and an expiry hint. Concurrent callers for the same account share one
 * in-flight refresh so a burst of pollers cannot stampede the token endpoint.
 */
export class TokenManager {
  private readonly cache = new Map<string, CachedToken>()
  private readonly inflight = new Map<string, Promise<string>>()

  constructor(
    private readonly store: AccountStore,
    private readonly refreshFn: typeof refreshAccessToken = refreshAccessToken,
  ) {}

  /** Seeds the cache right after a fresh login, avoiding an immediate refresh. */
  prime(accountId: string, accessToken: string, accessExpiry: number): void {
    this.cache.set(accountId, { accessToken, accessExpiry })
  }

  isCached(accountId: string): boolean {
    const token = this.cache.get(accountId)
    return token !== undefined && token.accessExpiry > Date.now() + EXPIRY_BUFFER_MS
  }

  /**
   * Returns a valid access token for the account, refreshing if needed.
   * Throws `AuthRevokedError` when the refresh token is no longer usable.
   */
  getValidAccessToken(accountId: string): Promise<string> {
    const cached = this.cache.get(accountId)
    if (cached && cached.accessExpiry > Date.now() + EXPIRY_BUFFER_MS) {
      return Promise.resolve(cached.accessToken)
    }

    const existing = this.inflight.get(accountId)
    if (existing) return existing

    const promise = this.doRefresh(accountId).finally(() => {
      this.inflight.delete(accountId)
    })
    this.inflight.set(accountId, promise)
    return promise
  }

  /** Drops the cached token so the next call refreshes. Used after a 401. */
  invalidate(accountId: string): void {
    this.cache.delete(accountId)
  }

  forget(accountId: string): void {
    this.invalidate(accountId)
    this.inflight.delete(accountId)
  }

  private async doRefresh(accountId: string): Promise<string> {
    const account = this.store.get(accountId)
    if (!account) throw new Error(`Unknown account: ${accountId}`)

    let refreshToken: string
    try {
      refreshToken = this.store.openRefreshToken(account)
    } catch (err) {
      this.store.setStatus(accountId, 'auth_error', 'Stored credentials could not be decrypted.')
      throw new AuthRevokedError(`Stored credentials could not be decrypted: ${(err as Error).message}`)
    }

    let lastError: Error = new Error('Token refresh failed')

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const { accessToken, accessExpiry } = await this.refreshFn(refreshToken)
        this.cache.set(accountId, { accessToken, accessExpiry })
        this.store.update(accountId, {
          accessExpiry,
          status: 'ok',
          lastError: undefined,
        })
        return accessToken
      } catch (err) {
        lastError = err as Error

        if (isPermanent(err)) {
          this.store.update(accountId, {
            status: 'auth_error',
            paused: true,
            lastError: 'Refresh token revoked. Sign in again.',
          })
          this.invalidate(accountId)
          throw new AuthRevokedError()
        }

        if (attempt < MAX_ATTEMPTS) {
          await delay(BASE_DELAY_MS * 2 ** (attempt - 1))
        }
      }
    }

    this.store.setStatus(accountId, 'error', `Token refresh failed: ${lastError.message}`)
    throw lastError
  }
}

/**
 * `invalid_grant` is Google's code for a revoked or expired refresh token, and
 * a 400 from the token endpoint is almost always that. Retrying cannot help.
 */
function isPermanent(err: unknown): boolean {
  if (err instanceof OAuthError) {
    return /invalid_grant|invalid_token|unauthorized_client/i.test(err.message)
  }
  const message = err instanceof Error ? err.message : String(err)
  return /invalid_grant|invalid_token|revoked|unauthorized_client/i.test(message)
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
