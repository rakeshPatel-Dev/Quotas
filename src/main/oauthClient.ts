/**
 * The OAuth client shipped inside the binary.
 *
 * Desktop ("installed application") clients cannot keep a secret: Google treats
 * the loopback redirect as the security boundary, which is why every Electron
 * and browser app on the platform embeds one. This is the project's own client,
 * issued to this project's own Google Cloud project, and it is deliberately
 * committed so that a downloaded installer works without any setup.
 *
 * To use your own instead, set ANTIGRAVITY_OAUTH_CLIENT_ID and
 * ANTIGRAVITY_OAUTH_CLIENT_SECRET; those win over whatever is written here.
 *
 * How to issue a replacement:
 *   1. Google Cloud Console -> create or pick a project.
 *   2. Enable the "Google Cloud Code API" (cloudcode.googleapis.com).
 *   3. Credentials -> Create credentials -> OAuth client ID.
 *   4. Application type: "Desktop app".
 *   5. Add the scopes listed in `oauthConfig.scopes`. No redirect URI needs
 *      registering: desktop clients may use any loopback port.
 *   6. Put the resulting id and secret in the two constants below.
 *
 * A "Web application" client will not work. Google rejects loopback redirects
 * for that type, and the flow would fail at the token exchange.
 */
export const BUNDLED_OAUTH_CLIENT = {
  // REPLACE_WITH_YOUR_OWN_CLIENT_ID
  clientId: '',
  // REPLACE_WITH_YOUR_OWN_CLIENT_SECRET
  clientSecret: '',
} as const

/** True when the placeholders above were never filled in. */
export function isBundledClientUnconfigured(client: {
  clientId: string
  clientSecret: string
}): boolean {
  const placeholder = (value: string): boolean =>
    value.trim() === '' || /^REPLACE_WITH/.test(value.trim())
  return placeholder(client.clientId) || placeholder(client.clientSecret)
}