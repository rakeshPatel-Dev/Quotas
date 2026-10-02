import { cloudCodeConfig } from '../config.js'
import type { AccountStore } from '../store/accountStore.js'
import type { TokenManager } from '../auth/tokenManager.js'
import { AuthRevokedError } from '../auth/tokenManager.js'
import { ApiShapeError, parseQuota, type ParsedQuota } from './parser.js'
import {
  loadCodeAssistSchema,
  onboardUserSchema,
  type LoadCodeAssistResponse,
} from './schemas.js'

export class QuotaApiError extends Error {
  constructor(
    readonly kind: 'auth' | 'rate_limited' | 'server' | 'api' | 'network' | 'shape',
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'QuotaApiError'
  }
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** `cloudaicompanionProject` arrives as either a bare string or `{ id }`. */
export function extractProjectId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'string' && id.length > 0) return id
  }
  return undefined
}

export type QuotaResult = ParsedQuota & { projectId?: string }

/**
 * Client for the internal Cloud Code endpoints the Antigravity IDE itself uses.
 * There is no public quota API, so this is the piece most likely to break; all
 * response handling lives in `parser.ts`.
 */
export class QuotaClient {
  constructor(
    private readonly tokens: TokenManager,
    private readonly store: AccountStore,
  ) {}

  private async request(accountId: string, endpoint: string, body: unknown): Promise<unknown> {
    const accessToken = await this.tokens.getValidAccessToken(accountId)

    let response: Response
    try {
      response = await fetch(`${cloudCodeConfig.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': cloudCodeConfig.userAgent,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      })
    } catch (err) {
      throw new QuotaApiError('network', `Could not reach Google: ${(err as Error).message}`)
    }

    if (response.status === 401) {
      // The token may have been revoked server-side. Drop it so the next call
      // refreshes, and let the retry below decide if that was enough.
      this.tokens.invalidate(accountId)
      throw new QuotaApiError('auth', 'Access token rejected by Google.', 401)
    }
    if (response.status === 403) {
      throw new QuotaApiError('auth', 'Account is not allowed to use Code Assist.', 403)
    }
    if (response.status === 429) {
      const header = response.headers.get('retry-after')
      const seconds = header ? Number.parseInt(header, 10) : Number.NaN
      throw new QuotaApiError(
        'rate_limited',
        'Rate limited by Google.',
        429,
        Number.isNaN(seconds) ? undefined : seconds * 1000,
      )
    }
    if (response.status >= 500) {
      throw new QuotaApiError('server', `Google returned ${response.status}.`, response.status)
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new QuotaApiError('api', `Google returned ${response.status}. ${text.slice(0, 200)}`, response.status)
    }

    try {
      return await response.json()
    } catch {
      throw new QuotaApiError('shape', 'Response was not valid JSON.', response.status)
    }
  }

  /** loadCodeAssist, retried once on 401 after dropping the cached token. */
  private async loadCodeAssist(accountId: string): Promise<LoadCodeAssistResponse> {
    let raw: unknown
    try {
      raw = await this.request(accountId, '/v1internal:loadCodeAssist', {
        metadata: cloudCodeConfig.metadata,
      })
    } catch (err) {
      if (err instanceof QuotaApiError && err.kind === 'auth' && err.status === 401) {
        raw = await this.request(accountId, '/v1internal:loadCodeAssist', {
          metadata: cloudCodeConfig.metadata,
        })
      } else {
        throw err
      }
    }

    const parsed = loadCodeAssistSchema.safeParse(raw)
    if (!parsed.success) {
      throw new ApiShapeError(raw, `loadCodeAssist shape changed: ${parsed.error.message}`)
    }
    return parsed.data
  }

  /**
   * Resolves the per-account Cloud Code project id.
   *
   * New accounts have none until they are onboarded, so this may call
   * `onboardUser` a few times before the id shows up in loadCodeAssist. Pass an
   * already-fetched `loadCodeAssist` response to avoid asking for it twice.
   */
  async resolveProjectId(
    accountId: string,
    preloaded?: LoadCodeAssistResponse,
  ): Promise<string | undefined> {
    const cached = this.store.get(accountId)?.projectId
    if (cached) return cached

    const load = preloaded ?? (await this.loadCodeAssist(accountId))
    const existing = extractProjectId(load.cloudaicompanionProject)
    if (existing) {
      this.store.update(accountId, { projectId: existing })
      return existing
    }

    const tierId =
      load.allowedTiers?.find((tier) => tier.isDefault && tier.id)?.id ??
      load.allowedTiers?.find((tier) => tier.id)?.id ??
      load.paidTier?.id ??
      load.currentTier?.id
    if (!tierId) return undefined

    for (let attempt = 0; attempt < cloudCodeConfig.onboardAttempts; attempt++) {
      if (attempt > 0) await delay(cloudCodeConfig.onboardDelayMs)

      try {
        const raw = await this.request(accountId, '/v1internal:onboardUser', {
          tierId,
          metadata: cloudCodeConfig.metadata,
        })
        const onboarded = onboardUserSchema.safeParse(raw)
        if (onboarded.success) {
          const fromOnboard = extractProjectId(onboarded.data.response?.cloudaicompanionProject)
          if (fromOnboard) {
            this.store.update(accountId, { projectId: fromOnboard })
            return fromOnboard
          }
        }
      } catch (err) {
        // Onboarding legitimately 403s for accounts that are already onboarded
        // but whose project is not echoed back. Keep polling loadCodeAssist.
        if (err instanceof QuotaApiError && (err.kind === 'auth' || err.kind === 'rate_limited')) {
          throw err
        }
      }

      const retryLoad = await this.loadCodeAssist(accountId)
      const projectId = extractProjectId(retryLoad.cloudaicompanionProject)
      if (projectId) {
        this.store.update(accountId, { projectId })
        return projectId
      }
    }

    return undefined
  }

  /** Fetches quota for one account. Never throws for one account into another. */
  async fetchQuota(accountId: string): Promise<QuotaResult> {
    // One loadCodeAssist serves both the plan info and the project id lookup.
    const codeAssist = await this.loadCodeAssist(accountId)
    const projectId = await this.resolveProjectId(accountId, codeAssist)

    const modelsRaw = await this.request(
      accountId,
      '/v1internal:fetchAvailableModels',
      projectId ? { project: projectId } : {},
    )

    return { ...parseQuota(codeAssist, modelsRaw), projectId }
  }
}

export { AuthRevokedError }
