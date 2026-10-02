/**
 * Diagnostic: why do most accounts report no remaining-quota figure?
 *
 * Calls the same two endpoints fetchQuota uses and prints only structure and
 * quota numbers. No token, key or header value is ever printed.
 *
 *   npx tsx scripts/debugQuotaShape.ts
 */
import { AccountStore } from '../src/main/store/accountStore.js'
import { createSecretBox } from '../src/main/store/secretBox.js'
import { TokenManager } from '../src/main/auth/tokenManager.js'
import { QuotaClient } from '../src/main/quota/cloudcode.js'
import { cloudCodeConfig } from '../src/main/config.js'
import { isTrackableModel } from '../src/main/quota/parser.js'

const store = new AccountStore(createSecretBox())
store.load()
const tokens = new TokenManager(store)
const client = new QuotaClient(tokens, store)

// The raw request helper is private by design; this script reaches past it only
// to inspect the wire shape, which is exactly what is under investigation.
const raw = client as unknown as {
  request(accountId: string, endpoint: string, body: unknown): Promise<unknown>
}

for (const account of store.list()) {
  console.log(`\n${'='.repeat(70)}`)
  console.log(account.email)

  let assist: Record<string, unknown>
  try {
    assist = (await raw.request(account.id, '/v1internal:loadCodeAssist', {
      metadata: cloudCodeConfig.metadata,
    })) as Record<string, unknown>
  } catch (err) {
    console.log(`  loadCodeAssist failed: ${(err as Error).message}`)
    continue
  }

  console.log(`  currentTier.id:    ${(assist.currentTier as {id?:string})?.id ?? 'n/a'}`)
  console.log(`  paidTier.name:     ${(assist.paidTier as {name?:string})?.name ?? 'n/a'}`)

  const projectId = account.projectId
  let modelsRaw: Record<string, unknown>
  try {
    modelsRaw = (await raw.request(
      account.id,
      '/v1internal:fetchAvailableModels',
      projectId ? { project: projectId } : {},
    )) as Record<string, unknown>
  } catch (err) {
    console.log(`  fetchAvailableModels failed: ${(err as Error).message}`)
    continue
  }

  const models = (modelsRaw.models ?? {}) as Record<string, { quotaInfo?: Record<string, unknown> }>
  const entries = Object.entries(models)
  console.log(`  project used:      ${projectId ? 'stored' : 'NONE (unresolved)'}`)
  console.log(`  models returned:   ${entries.length}`)
  console.log(`  response keys:     ${Object.keys(modelsRaw).sort().join(', ')}`)

  const withFraction = entries.filter(([, m]) => typeof m.quotaInfo?.remainingFraction === 'number')
  console.log(`  with fraction:     ${withFraction.length}/${entries.length}`)
  for (const [id, m] of withFraction) {
    const trackable = isTrackableModel(id, true)
    console.log(`      ${trackable ? 'KEPT    ' : 'FILTERED'} ${id}  ${JSON.stringify(m.quotaInfo)}`)
  }
}