import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { URL, URLSearchParams } from 'node:url'
import { oauthConfig } from '../config.js'

export type OAuthTokens = {
  /** Stable per-account identifier (Google `sub`), never the email. */
  id: string
  email: string
  accessToken: string
  refreshToken: string
  /** UTC epoch ms. */
  accessExpiry: number
}

export type OAuthErrorCode =
  | 'access_denied'
  | 'state_mismatch'
  | 'no_code'
  | 'timeout'
  | 'no_refresh_token'
  | 'token_exchange_failed'
  | 'identity_unresolved'

export class OAuthError extends Error {
  constructor(
    readonly code: OAuthErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'OAuthError'
  }
}

export interface OAuthFlowOptions {
  /**
   * How to show the consent URL. Under Electron this is
   * `shell.openExternal`; in a plain Node run it is `open` or a no-op when the
   * caller wants to print the URL itself.
   */
  openUrl?: (url: string) => void | Promise<void>
  /** Called with the consent URL right after the callback server is listening. */
  onAuthUrl?: (url: string, redirectUri: string) => void
  timeoutMs?: number
  /** Fixed port, mainly for tests. Defaults to an ephemeral port. */
  port?: number
}

type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in: number
  id_token?: string
  token_type: string
  error?: string
  error_description?: string
}

const base64url = (buf: Buffer): string => buf.toString('base64url')

/** S256 PKCE. */
function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/**
 * Reads `sub` and `email` out of the id token.
 *
 * The signature is not verified: this token is received directly from Google's
 * token endpoint over TLS in the same response body as the access token, so it
 * is not attacker-controlled. It is an identity claim, not an authorization
 * decision.
 */
function decodeIdToken(idToken: string): { sub?: string; email?: string } {
  const parts = idToken.split('.')
  if (parts.length < 2) return {}
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'))
    if (!payload || typeof payload !== 'object') return {}
    const record = payload as Record<string, unknown>
    return {
      sub: typeof record.sub === 'string' ? record.sub : undefined,
      email: typeof record.email === 'string' ? record.email : undefined,
    }
  } catch {
    return {}
  }
}

/**
 * Stable account id when no id token came back: a hash of the lowercased email.
 * Keeps "log in twice with the same account" idempotent without storing the
 * address as the primary key.
 */
function idFromEmail(email: string): string {
  return `email:${createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 32)}`
}

async function postForm(url: string, body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const text = await response.text()
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new OAuthError('token_exchange_failed', `Token endpoint returned ${response.status}`)
  }
  if (!response.ok || !json || typeof json !== 'object') {
    const record = json as Record<string, unknown>
    const code = typeof record.error === 'string' ? record.error : String(response.status)
    const description = typeof record.error_description === 'string' ? record.error_description : text
    throw new OAuthError('token_exchange_failed', `Token endpoint error: ${code} ${description}`)
  }
  return json as TokenResponse
}

async function exchangeCode(
  code: string,
  redirectUri: string,
  verifier: string,
): Promise<TokenResponse> {
  return postForm(
    oauthConfig.tokenUrl,
    new URLSearchParams({
      code,
      client_id: oauthConfig.clientId,
      client_secret: oauthConfig.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  )
}

/** Fallback identity lookup when the token response has no id token. */
async function fetchEmail(accessToken: string): Promise<string | undefined> {
  try {
    const response = await fetch(oauthConfig.userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) return undefined
    const json: unknown = await response.json()
    const email = (json as { email?: unknown }).email
    return typeof email === 'string' ? email : undefined
  } catch {
    return undefined
  }
}

async function finishLogin(
  code: string,
  redirectUri: string,
  verifier: string,
): Promise<OAuthTokens> {
  const tokens = await exchangeCode(code, redirectUri, verifier)
  if (!tokens.refresh_token) {
    // Google only issues a refresh token on the consent screen. Without one the
    // account would work until the access token expires and then be dead.
    throw new OAuthError(
      'no_refresh_token',
      'Google did not return a refresh token. Revoke the app grant and try again.',
    )
  }

  const claims = tokens.id_token ? decodeIdToken(tokens.id_token) : {}
  const email = claims.email ?? (await fetchEmail(tokens.access_token))
  if (!email) {
    throw new OAuthError(
      'identity_unresolved',
      'Signed in, but the account email could not be determined. Check that the OAuth client requests the userinfo.email scope.',
    )
  }

  return {
    id: claims.sub ?? idFromEmail(email),
    email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessExpiry: Date.now() + tokens.expires_in * 1000,
  }
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })

function page(title: string, detail: string): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>` +
    `<body style="font-family:system-ui;padding:48px;text-align:center">` +
    `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p></body></html>`
  )
}

function respond(res: ServerResponse, status: number, title: string, detail: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(page(title, detail))
}

/**
 * Runs the browser consent flow and resolves with the account's tokens.
 *
 * Opens a loopback listener on 127.0.0.1, so the redirect URI is
 * `http://127.0.0.1:<ephemeral>/callback`. It must match what is registered on
 * the OAuth client (Google ignores the port for loopback URIs).
 */
export async function startOAuthFlow(options: OAuthFlowOptions = {}): Promise<OAuthTokens> {
  const { verifier, challenge } = createPkce()
  const state = base64url(randomBytes(24))

  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, '127.0.0.1', () => resolve())
  })
  const { port } = server.address() as AddressInfo
  const redirectUri = `http://127.0.0.1:${port}/callback`

  const authUrl =
    `${oauthConfig.authUrl}?` +
    new URLSearchParams({
      client_id: oauthConfig.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: oauthConfig.scopes.join(' '),
      access_type: 'offline',
      // Required so Google hands back a refresh token.
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString()

  options.onAuthUrl?.(authUrl, redirectUri)
  if (options.openUrl) await options.openUrl(authUrl)

  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000

  return new Promise<OAuthTokens>((resolve, reject) => {
    let settled = false

    const finish = (err: Error | null, tokens?: OAuthTokens): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server.close()
      if (err) reject(err)
      else resolve(tokens!)
    }

    const timer = setTimeout(
      () => finish(new OAuthError('timeout', 'Login timed out.')),
      timeoutMs,
    )
    timer.unref?.()

    server.on('request', (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)

      // Anything that is not the callback (favicon probes, etc.) gets ignored.
      if (url.pathname !== '/callback') {
        respond(res, 404, 'Not found', 'Nothing to see here.')
        return
      }

      const oauthError = url.searchParams.get('error')
      if (oauthError) {
        respond(res, 400, 'Sign-in cancelled', 'You can close this window.')
        finish(new OAuthError('access_denied', `Google returned: ${oauthError}`))
        return
      }

      const code = url.searchParams.get('code')
      if (!code || url.searchParams.get('state') !== state) {
        respond(res, 400, 'Invalid request', 'State mismatch or missing code.')
        finish(new OAuthError(code ? 'state_mismatch' : 'no_code', 'Callback validation failed.'))
        return
      }

      finishLogin(code, redirectUri, verifier).then(
        (tokens) => {
          respond(res, 200, 'Signed in', `Signed in as ${tokens.email}. You can close this window.`)
          finish(null, tokens)
        },
        (err: Error) => {
          respond(res, 500, 'Sign-in failed', 'Could not complete the token exchange.')
          finish(err)
        },
      )
    })
  })
}

/**
 * Exchanges a refresh token for a new access token.
 * Throws an `OAuthError` with `token_exchange_failed` for `invalid_grant`, which
 * the token manager turns into a permanent "re-login needed" state.
 */
export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string
  accessExpiry: number
}> {
  const tokens = await postForm(
    oauthConfig.tokenUrl,
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: oauthConfig.clientId,
      client_secret: oauthConfig.clientSecret,
      grant_type: 'refresh_token',
    }),
  )
  return {
    accessToken: tokens.access_token,
    accessExpiry: Date.now() + tokens.expires_in * 1000,
  }
}

/** Exported for tests. */
export const __testing = { decodeIdToken, idFromEmail }
