import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

export type ImportedAccount = {
  email: string
  refreshToken: string
  projectId?: string
}

/**
 * Reads accounts saved by the antigravity-usage CLI so they can be migrated
 * instead of forcing a fresh browser sign-in per account.
 *
 * Those files hold refresh tokens in plaintext. Nothing here logs or returns
 * the token itself to anything but the caller, which immediately re-seals it.
 */
export function readAntigravityUsageAccounts(
  accountsDir = defaultAccountsDir(),
): ImportedAccount[] {
  if (!existsSync(accountsDir)) return []

  const accounts: ImportedAccount[] = []

  for (const entry of readdirSync(accountsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const tokensFile = join(accountsDir, entry.name, 'tokens.json')
    if (!existsSync(tokensFile)) continue

    try {
      const parsed: unknown = JSON.parse(readFileSync(tokensFile, 'utf8'))
      if (!parsed || typeof parsed !== 'object') continue
      const record = parsed as Record<string, unknown>
      const refreshToken = record.refreshToken
      if (typeof refreshToken !== 'string' || refreshToken.length === 0) continue

      // The directory name is the email; the file may also carry one.
      const email =
        (typeof record.email === 'string' && record.email) || `${entry.name}@unknown`
      accounts.push({
        email,
        refreshToken,
        projectId: typeof record.projectId === 'string' ? record.projectId : undefined,
      })
    } catch {
      // Skip unreadable account directories rather than failing the import.
    }
  }

  return accounts
}

function defaultAccountsDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
  return join(xdg, 'antigravity-usage', 'accounts')
}

/**
 * Mirrors the id derivation in the OAuth flow, so an imported account and a
 * later browser sign-in of the same Google account resolve to one record
 * instead of two.
 */
export function idForImportedEmail(email: string): string {
  return `email:${createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 32)}`
}
