/**
 * Writes the OAuth client into the bundle at build time.
 *
 * The client secret is deliberately not committed: GitHub push protection
 * blocks any push containing a `GOCSPX-` string, and a secret in git history is
 * permanent. Instead the release workflow passes it through Actions secrets and
 * this script substitutes it into the source tree immediately before
 * electron-builder runs. The packaged app carries the value; the repository
 * never does.
 *
 * Locally, set ANTIGRAVITY_OAUTH_CLIENT_ID / _SECRET (e.g. in .env) or skip this
 * entirely -- config.ts falls back to .env, which is enough for development.
 *
 * Usage: node scripts/bundleOAuthClient.mjs [--require]
 *   --require  exit non-zero unless both values are present (used in CI)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'src', 'main', 'oauthClient.ts')

const required = process.argv.includes('--require')

// dotenv, so a local `npm run dist` picks up .env the same way the app does.
const envFile = join(root, '.env')
try {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined && !/^(REPLACE_WITH|)$/.test(val)) {
      process.env[key] = val
    }
  }
} catch {
  // No .env is fine; the caller decides whether that is an error.
}

const clientId = process.env.ANTIGRAVITY_OAUTH_CLIENT_ID?.trim() ?? ''
const clientSecret = process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET?.trim() ?? ''
const missing = !clientId || !clientSecret

if (missing && required) {
  console.error(
    [
      'Refusing to build: no OAuth client to bundle.',
      '',
      'Set these as repository Actions secrets (Settings -> Secrets and variables',
      '-> Actions), on both the client id and the client secret:',
      '  ANTIGRAVITY_OAUTH_CLIENT_ID',
      '  ANTIGRAVITY_OAUTH_CLIENT_SECRET',
      '',
      'Without them the installers would ship an app that cannot sign in.',
    ].join('\n'),
  )
  process.exit(1)
}

if (missing) {
  console.log('[bundle-oauth-client] no client found; leaving placeholders in place.')
  process.exit(0)
}

const source = readFileSync(target, 'utf8')
const quote = (value) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

const updated = source
  .replace(/clientId:\s*'[^']*'/, `clientId: '${quote(clientId)}'`)
  .replace(/clientSecret:\s*'[^']*'/, `clientSecret: '${quote(clientSecret)}'`)

if (updated === source) {
  console.error('[bundle-oauth-client] could not find clientId/clientSecret to replace.')
  process.exit(1)
}

writeFileSync(target, updated)
console.log(`[bundle-oauth-client] wrote client ${clientId} into ${target}`)