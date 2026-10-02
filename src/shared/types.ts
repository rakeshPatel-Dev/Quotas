/**
 * Types shared by the main process, the preload bridge and the renderer.
 * Nothing here may contain a token value.
 */

export type AccountStatus =
  | 'ok'
  | 'refreshing'
  | 'auth_error'
  | 'rate_limited'
  | 'error'

/** Coarse bucket used by the UI to group model rows. */
export type ModelFamily = 'claude' | 'gemini-pro' | 'gemini-flash' | 'other'

export type ModelQuota = {
  modelId: string
  label: string
  family: ModelFamily
  /** 0..1. Clamped. Null when the API reports no quota info for this model. */
  remainingFraction: number | null
  /** UTC epoch ms. Null when the API reports no reset time (or it already passed). */
  resetAt: number | null
  isExhausted: boolean
}

export type PromptCredits = {
  available: number
  monthly: number
  /** 0..1 */
  remainingFraction: number
}

/** On-disk shape. `refreshTokenEnc` is an encrypted blob, never a raw token. */
export type Account = {
  /** Google `sub` claim, or a derived stable id. Never the email. */
  id: string
  email: string
  refreshTokenEnc: string
  /**
   * Expiry hint for the in-memory access token. The access token itself is
   * deliberately NOT persisted: it is cheap to re-derive from the refresh
   * token and writing it to disk only widens the blast radius.
   */
  accessExpiry?: number | null
  projectId?: string
  planType?: string
  credits?: PromptCredits | null
  quota: ModelQuota[]
  fetchedAt?: number
  status: AccountStatus
  lastError?: string
  nextPollAt: number
  backoffMs: number
  paused: boolean
}

/** Account shape that is allowed to cross the IPC boundary. */
export type PublicAccount = Omit<Account, 'refreshTokenEnc' | 'accessExpiry'>

export function toPublicAccount(account: Account): PublicAccount {
  const { refreshTokenEnc: _enc, accessExpiry: _exp, ...rest } = account
  return rest
}

export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  const name = email.slice(0, at)
  const domain = email.slice(at)
  const head = name.slice(0, Math.min(1, name.length))
  return `${head}${'*'.repeat(Math.max(3, name.length - 1))}${domain}`
}

/* ------------------------------------------------------------------ */
/* IPC contract (implemented in the main process, consumed by preload) */
/* ------------------------------------------------------------------ */

export type QuotaIpc = {
  listAccounts(): Promise<PublicAccount[]>
  addAccount(): Promise<void>
  removeAccount(id: string): Promise<void>
  refresh(id: string | 'all'): Promise<void>
  setPaused(id: string, paused: boolean): Promise<void>
  onAccountUpdated(cb: (account: PublicAccount) => void): () => void
}

export const IPC_CHANNELS = {
  listAccounts: 'accounts:list',
  addAccount: 'accounts:add',
  removeAccount: 'accounts:remove',
  refresh: 'accounts:refresh',
  setPaused: 'accounts:setPaused',
  accountUpdated: 'accounts:updated',
} as const
