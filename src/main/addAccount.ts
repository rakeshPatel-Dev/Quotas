import { startOAuthFlow, type OAuthFlowOptions } from './auth/oauthFlow.js'
import type { TokenManager } from './auth/tokenManager.js'
import type { QuotaService } from './quota/service.js'
import { emptyAccount, type AccountStore } from './store/accountStore.js'
import type { Account } from '../shared/types.js'

export type AddAccountDeps = {
  store: AccountStore
  tokens: TokenManager
  service: QuotaService
}

export type AddAccountResult = {
  id: string
  email: string
  /** True when this re-authenticated an account that was already tracked. */
  replaced: boolean
  account: Account | undefined
}

/**
 * Signs in one Google account and leaves it tracked and freshly fetched.
 *
 * Shared by the CLI and the Electron IPC layer so both paths persist, prime and
 * refresh in exactly the same order. The browser hand-off is injected, which is
 * the only difference between the two callers.
 */
export async function addAccount(
  deps: AddAccountDeps,
  options: OAuthFlowOptions = {},
): Promise<AddAccountResult> {
  const result = await startOAuthFlow(options)

  const existing = deps.store.list().find((account) => account.id === result.id)
  const record = emptyAccount({
    id: result.id,
    email: result.email,
    refreshTokenEnc: deps.store.sealRefreshToken(result.refreshToken),
  })

  // upsert() replaces the record outright, which is what clears a stale
  // paused/backoff state on re-login. Quota already on file is kept so a
  // re-login does not blank the card before the first fetch lands.
  deps.store.upsert({
    ...record,
    quota: existing?.quota ?? [],
    projectId: existing?.projectId,
  })
  deps.tokens.prime(result.id, result.accessToken, result.accessExpiry)
  await deps.store.flush()

  const account: Account | undefined = await deps.service.refreshAccount(result.id)
  await deps.store.flush()

  return { id: result.id, email: result.email, replaced: existing !== undefined, account }
}
