#!/usr/bin/env node
/**
 * Verification CLI for build steps 1-3. No Electron, no UI: it exercises the
 * store, the OAuth flow, the token manager and the quota client from the
 * command line so the risky part can be verified before any UI exists.
 *
 *   npm run dev -- add
 *   npm run dev -- accounts
 *   npm run dev -- quota
 *   npm run dev -- quota --all
 *   npm run dev -- remove <email>
 */
import { parseArgs } from 'node:util'
import pLimit from 'p-limit'
import { getDataDir, oauthConfig } from './main/config.js'
import { addAccount as runAddAccount } from './main/addAccount.js'
import { TokenManager } from './main/auth/tokenManager.js'
import { QuotaClient } from './main/quota/cloudcode.js'
import { QuotaService } from './main/quota/service.js'
import { groupIntoPools, hasQuotaData } from './shared/pools.js'
import { AccountStore, emptyAccount } from './main/store/accountStore.js'
import { createSecretBox } from './main/store/secretBox.js'
import { maskEmail, type Account } from './shared/types.js'
import {
  idForImportedEmail,
  readAntigravityUsageAccounts,
} from './main/auth/importAccounts.js'

const MAX_CONCURRENT_FETCHES = 3

const box = createSecretBox()
const store = new AccountStore(box)
const tokens = new TokenManager(store)
const client = new QuotaClient(tokens, store)
const service = new QuotaService(store, tokens, client)

store.on('error', (err) => console.error(`  ! ${err.message}`))

function openBrowser(url: string): void {
  console.log('\nOpen this URL to sign in:\n')
  console.log(`  ${url}\n`)
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  void import('node:child_process')
    .then(({ spawn }) => {
      spawn(command, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref()
    })
    .catch(() => undefined)
}

async function addAccount(): Promise<void> {
  console.log(`Starting Google sign-in (data dir: ${getDataDir()})`)
  const result = await runAddAccount({ store, tokens, service }, { openUrl: openBrowser })

  console.log(
    `\nSigned in as ${result.email}${result.replaced ? ' (updated existing account)' : ''}`,
  )
  console.log('Fetching quota...')
  if (result.account) printAccount(result.account)
}

function formatReset(resetAt: number | null): string {
  if (resetAt === null) return 'no reset time'
  const ms = resetAt - Date.now()
  if (ms <= 0) return 'reset due'
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.round((ms % 3_600_000) / 60_000)
  return hours > 0 ? `resets in ${hours}h ${minutes}m` : `resets in ${minutes}m`
}

function printAccount(account: Account): void {
  const bar = (fraction: number | null): string => {
    if (fraction === null) return '  ?  '
    const filled = Math.round(fraction * 10)
    return `${'#'.repeat(filled)}${'.'.repeat(10 - filled)}`
  }

  console.log(`\n${account.email}${account.planType ? `  [${account.planType}]` : ''}`)
  console.log(`  status: ${account.status}${account.lastError ? ` - ${account.lastError}` : ''}`)
  if (account.credits) {
    console.log(
      `  prompt credits: ${account.credits.available}/${account.credits.monthly} ` +
        `(${Math.round(account.credits.remainingFraction * 100)}% left)`,
    )
  }
  if (account.quota.length === 0) {
    console.log('  no trackable models reported')
    return
  }

  const pools = groupIntoPools(account.quota)
  const withFraction = pools.filter((pool) => pool.remainingFraction !== null)

  if (withFraction.length === 0) {
    console.log(
      `  ${account.quota.length} models tracked, but Google reports no remaining-quota ` +
        `numbers for this account. Reset times only:`,
    )
  }

  for (const pool of pools) {
    const percent =
      pool.remainingFraction === null
        ? '  ?'
        : `${Math.round(pool.remainingFraction * 100)}%`.padStart(4)
    const names = pool.labels.length > 3
      ? `${pool.labels.slice(0, 3).join(', ')} +${pool.labels.length - 3} more`
      : pool.labels.join(', ')
    console.log(`\n  ${names}`)
    console.log(`    ${bar(pool.remainingFraction)} ${percent}  ${formatReset(pool.resetAt)}`)
  }
}

async function quota(args: { all?: boolean; positional: string[] }): Promise<void> {
  const accounts = store.list()
  if (accounts.length === 0) {
    console.log('No accounts yet. Run: npm run dev -- add')
    return
  }

  let targets = accounts
  if (args.all) {
    targets = accounts.filter((account) => !account.paused)
  } else if (args.positional[0]) {
    const needle = args.positional[0].toLowerCase()
    targets = accounts.filter(
      (account) =>
        account.email.toLowerCase() === needle || maskEmail(account.email).toLowerCase() === needle,
    )
    if (targets.length === 0) {
      console.log(`No account matching "${args.positional[0]}".`)
      return
    }
  } else {
    targets = [accounts[0]!]
  }

  console.log(`Fetching ${targets.length} account(s), ${MAX_CONCURRENT_FETCHES} at a time...`)
  const limit = pLimit(MAX_CONCURRENT_FETCHES)
  // allSettled, never all: one failure must not abort the rest.
  const results = await Promise.allSettled(targets.map((a) => limit(() => service.refreshAccount(a.id))))
  await store.flush()

  const failed = results.filter((r) => r.status === 'rejected').length
  for (const account of store.list()) {
    if (targets.some((t) => t.id === account.id)) printAccount(account)
  }
  if (failed > 0) console.error(`\n${failed} account(s) threw unexpectedly.`)
}

function listAccounts(): void {
  const accounts = store.list()
  if (accounts.length === 0) {
    console.log('No accounts yet. Run: npm run dev -- add')
    return
  }
  for (const account of accounts) {
    // Only average models that actually reported a fraction; a null fraction
    // means "no data", not "empty".
    const withData = account.quota.filter((q) => q.remainingFraction !== null)
    const quotaPct =
      withData.length === 0
        ? 'no quota data'
        : `${Math.round(
            (withData.reduce((sum, q) => sum + (q.remainingFraction ?? 0), 0) / withData.length) * 100,
          )}% avg`
    console.log(
      `${account.id.slice(0, 18).padEnd(20)} ${account.email.padEnd(34)} ` +
        `${account.status.padEnd(13)} ${account.paused ? 'paused' : 'active'}  ${quotaPct}`,
    )
  }
}

async function importAccounts(): Promise<void> {
  const found = readAntigravityUsageAccounts()
  if (found.length === 0) {
    console.log('No antigravity-usage accounts found to import.')
    return
  }

  let imported = 0
  for (const candidate of found) {
    const id = idForImportedEmail(candidate.email)
    if (store.get(id)) {
      console.log(`  skip ${candidate.email} (already added)`)
      continue
    }
    store.upsert({
      ...emptyAccount({
        id,
        email: candidate.email,
        refreshTokenEnc: store.sealRefreshToken(candidate.refreshToken),
      }),
      projectId: candidate.projectId,
    })
    imported++
    console.log(`  imported ${candidate.email}`)
  }

  await store.flush()
  console.log(`\nImported ${imported} account(s). Tokens re-encrypted with ${box.kind}.`)
}

async function removeAccount(email: string): Promise<void> {
  const account = store.list().find((a) => a.email.toLowerCase() === email.toLowerCase())
  if (!account) {
    console.log(`No account matching "${email}".`)
    return
  }
  store.remove(account.id)
  tokens.forget(account.id)
  await store.flush()
  console.log(`Removed ${account.email}.`)
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      all: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  })

  const command = positionals[0] ?? 'quota'
  store.load()

  switch (command) {
    case 'add':
      await addAccount()
      break
    case 'accounts':
    case 'list':
      listAccounts()
      break
    case 'import':
      await importAccounts()
      break
    case 'quota':
      await quota({ all: Boolean(values.all), positional: positionals.slice(1) })
      break
    case 'remove':
      if (!positionals[1]) throw new Error('Usage: remove <email>')
      await removeAccount(positionals[1])
      break
    case 'help':
    case '-h':
    case '--help':
    default:
      console.log(
        [
          'Usage: npm run dev -- <command>',
          '',
          '  add                 sign in with Google and store the account',
          '  accounts            list stored accounts',
          '  import              adopt accounts from the antigravity-usage CLI',
          '  quota [email]       fetch and print quota (defaults to first account)',
          '  quota --all         fetch every unpaused account, 3 at a time',
          '  remove <email>      delete an account and its tokens',
          '',
          `data dir: ${getDataDir()}`,
          `encryption: ${box.kind}`,
          `oauth client: ${oauthConfig.clientId.slice(0, 24)}...`,
        ].join('\n'),
      )
  }
}

main()
  .then(async () => {
    await store.flush()
    process.exit(0)
  })
  .catch(async (err: unknown) => {
    console.error(`\n${err instanceof Error ? err.message : String(err)}`)
    await store.flush()
    process.exit(1)
  })
