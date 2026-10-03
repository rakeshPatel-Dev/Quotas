import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUNDLED_OAUTH_CLIENT, isBundledClientUnconfigured } from './oauthClient.js'

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
 * Credentials resolve in this order:
 *   1. ANTIGRAVITY_OAUTH_CLIENT_ID / _SECRET, including from a .env file
 *   2. the client bundled into the binary (see oauthClient.ts)
 *
 * A released build must ship a working client, so `assertOAuthConfigured` turns a
 * blank pair into one actionable error instead of Google's `invalid_client`.
 */
function resolveOAuthClient(): { clientId: string; clientSecret: string } {
  const fromEnv = {
    clientId: process.env.ANTIGRAVITY_OAUTH_CLIENT_ID ?? '',
    clientSecret: process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET ?? '',
  }
  if (fromEnv.clientId && fromEnv.clientSecret) return fromEnv
  if (isBundledClientUnconfigured(BUNDLED_OAUTH_CLIENT)) return fromEnv
  return {
    clientId: BUNDLED_OAUTH_CLIENT.clientId,
    clientSecret: BUNDLED_OAUTH_CLIENT.clientSecret,
  }
}

export const oauthConfig = {
  clientId: resolveOAuthClient().clientId,
  clientSecret: resolveOAuthClient().clientSecret,
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
  scopes: [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/cloud-platform',
  ],
} as const

/**
 * Fails loudly before any network call, so a misconfigured build reports what is
 * actually wrong instead of surfacing Google's `invalid_client` on the consent
 * screen, which looks like a Google outage.
 */
export function assertOAuthConfigured(): void {
  if (oauthConfig.clientId && oauthConfig.clientSecret) return
  throw new Error(
    [
      'No OAuth client is configured, so sign-in cannot start.',
      '',
      'If you are running from source: set ANTIGRAVITY_OAUTH_CLIENT_ID and',
      'ANTIGRAVITY_OAUTH_CLIENT_SECRET in .env (see .env.example).',
      '',
      'If you installed a downloaded build: it was packaged without a client.',
      'See docs/building.md for how the bundled client is configured.',
    ].join('\n'),
  )
}

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
