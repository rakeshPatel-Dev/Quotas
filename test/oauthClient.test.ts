import { describe, expect, it } from 'vitest'
import { isBundledClientUnconfigured } from '../src/main/oauthClient.js'

describe('bundled OAuth client', () => {
  it('treats an empty pair as unconfigured', () => {
    expect(isBundledClientUnconfigured({ clientId: '', clientSecret: '' })).toBe(true)
  })

  it('treats unfilled placeholders as unconfigured', () => {
    // Guards the exact failure mode where a release ships the template verbatim
    // and every sign-in fails with Google's `invalid_client`.
    expect(
      isBundledClientUnconfigured({
        clientId: 'REPLACE_WITH_YOUR_OWN_CLIENT_ID',
        clientSecret: 'REPLACE_WITH_YOUR_OWN_CLIENT_SECRET',
      }),
    ).toBe(true)
    expect(
      isBundledClientUnconfigured({
        clientId: '123-abc.apps.googleusercontent.com',
        clientSecret: 'REPLACE_WITH_YOUR_OWN_CLIENT_SECRET',
      }),
    ).toBe(true)
  })

  it('treats whitespace as unconfigured', () => {
    expect(isBundledClientUnconfigured({ clientId: '  ', clientSecret: 'x' })).toBe(true)
  })

  it('accepts a filled pair', () => {
    expect(
      isBundledClientUnconfigured({
        clientId: '123-abc.apps.googleusercontent.com',
        clientSecret: 'GOCSPX-real-looking-value',
      }),
    ).toBe(false)
  })
})