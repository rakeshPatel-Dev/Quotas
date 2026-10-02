import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Load environment variables from .env file if present. */
function loadDotenv(): void {
  const candidates = [
    join(process.cwd(), '.env'),
    join(dirname(fileURLToPath(import.meta.url)), '../../.env'),
  ]
  for (const envFile of candidates) {
    if (existsSync(envFile)) {
      try {
        const content = readFileSync(envFile, 'utf8')
        for (const line of content.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('#')) continue
          const eq = trimmed.indexOf('=')
          if (eq === -1) continue
          const key = trimmed.slice(0, eq).trim()
          let val = trimmed.slice(eq + 1).trim()
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1)
          }
          if (process.env[key] === undefined) {
            process.env[key] = val
          }
        }
        break
      } catch {
        // Ignore read errors
      }
    }
  }
}

loadDotenv()

/**
 * OAuth + Cloud Code endpoints.
 *
 * Credentials are loaded from environment variables (.env file supported):
 *   ANTIGRAVITY_OAUTH_CLIENT_ID
 *   ANTIGRAVITY_OAUTH_CLIENT_SECRET
 *
 * Your client must be an "installed application" and must have the same scopes
 * plus a loopback redirect URI registered.
 */
export const oauthConfig = {
  clientId: process.env.ANTIGRAVITY_OAUTH_CLIENT_ID ?? '',
  clientSecret: process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET ?? '',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
  scopes: [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/cloud-platform',
  ],
} as const

export const cloudCodeConfig = {
  baseUrl: 'https://cloudcode-pa.googleapis.com',
  userAgent: 'antigravity',
  metadata: {
    ideType: 'ANTIGRAVITY',
    platform: 'PLATFORM_UNSPECIFIED',
    pluginType: 'GEMINI',
  },
  onboardAttempts: 5,
  onboardDelayMs: 2000,
} as const

/** Where accounts live. Override for tests and for throwaway profiles. */
export function getDataDir(): string {
  return process.env.ANTIGRAVITY_TRACKER_DATA_DIR ?? join(homedir(), '.antigravity-quota-tracker')
}

export function getAccountsFile(): string {
  return join(getDataDir(), 'accounts.json')
}

export function getDevKeyFile(): string {
  return join(getDataDir(), 'dev.key')
}
