import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthRevokedError, TokenManager } from '../src/main/auth/tokenManager.js'
import { AccountStore, emptyAccount } from '../src/main/store/accountStore.js'
import { createSecretBox } from '../src/main/store/secretBox.js'

let dir: string
let store: AccountStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aqt-token-'))
  store = new AccountStore(createSecretBox({ force: 'dev-keyfile', keyFile: join(dir, 'dev.key') }), {
    file: join(dir, 'accounts.json'),
    saveDebounceMs: 0,
  })
  store.load()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function addAccount(id: string, email: string): void {
  store.upsert(
    emptyAccount({
      id,
      email,
      refreshTokenEnc: store.sealRefreshToken(`refresh-token-for-${id}`),
    }),
  )
}

describe('TokenManager single-flight', () => {
  it('collapses 10 simultaneous callers into exactly one refresh', async () => {
    addAccount('a1', 'one@example.com')
    const refresh = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10))
      return { accessToken: 'fresh-token', accessExpiry: Date.now() + 3_600_000 }
    })
    const manager = new TokenManager(store, refresh)

    const tokens = await Promise.all(Array.from({ length: 10 }, () => manager.getValidAccessToken('a1')))

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(tokens).toEqual(Array.from({ length: 10 }, () => 'fresh-token'))
  })

  it('reuses the cached token until the expiry buffer is reached', async () => {
    addAccount('a1', 'one@example.com')
    const refresh = vi.fn(async () => ({
      accessToken: 'fresh-token',
      accessExpiry: Date.now() + 3_600_000,
    }))
    const manager = new TokenManager(store, refresh)

    await manager.getValidAccessToken('a1')
    await manager.getValidAccessToken('a1')
    await manager.getValidAccessToken('a1')

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(manager.isCached('a1')).toBe(true)
  })

  it('refreshes again once the token is inside the 60s expiry buffer', async () => {
    addAccount('a1', 'one@example.com')
    const refresh = vi
      .fn()
      .mockResolvedValueOnce({ accessToken: 'first', accessExpiry: Date.now() + 30_000 })
      .mockResolvedValueOnce({ accessToken: 'second', accessExpiry: Date.now() + 3_600_000 })
    const manager = new TokenManager(store, refresh)

    expect(await manager.getValidAccessToken('a1')).toBe('first')
    expect(manager.isCached('a1')).toBe(false)
    expect(await manager.getValidAccessToken('a1')).toBe('second')
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('keeps accounts isolated: one revoked account does not affect another', async () => {
    addAccount('bad', 'bad@example.com')
    addAccount('good', 'good@example.com')

    const refresh = vi.fn(async (refreshToken: string) => {
      if (refreshToken === 'refresh-token-for-bad') {
        throw new Error('Token endpoint error: 400 invalid_grant')
      }
      return { accessToken: 'good-token', accessExpiry: Date.now() + 3_600_000 }
    })
    const manager = new TokenManager(store, refresh)

    await expect(manager.getValidAccessToken('bad')).rejects.toBeInstanceOf(AuthRevokedError)
    expect(await manager.getValidAccessToken('good')).toBe('good-token')

    expect(store.get('bad')?.status).toBe('auth_error')
    expect(store.get('bad')?.paused).toBe(true)
    expect(store.get('good')?.status).toBe('ok')
  })

  it('does not retry a revoked refresh token', async () => {
    addAccount('bad', 'bad@example.com')
    const refresh = vi.fn(async () => {
      throw new Error('400 invalid_grant')
    })
    const manager = new TokenManager(store, refresh)

    await expect(manager.getValidAccessToken('bad')).rejects.toBeInstanceOf(AuthRevokedError)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('retries a transient failure and then succeeds', async () => {
    addAccount('a1', 'one@example.com')
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({ accessToken: 'eventually', accessExpiry: Date.now() + 3_600_000 })
    const manager = new TokenManager(store, refresh)

    expect(await manager.getValidAccessToken('a1')).toBe('eventually')
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(store.get('a1')?.status).toBe('ok')
  })

  it('starts a new refresh after a previous one settled, rather than reusing it', async () => {
    addAccount('a1', 'one@example.com')
    const refresh = vi.fn(async () => ({
      accessToken: `token-${refresh.mock.calls.length}`,
      accessExpiry: Date.now() + 3_600_000,
    }))
    const manager = new TokenManager(store, refresh)

    await manager.getValidAccessToken('a1')
    manager.invalidate('a1')
    expect(await manager.getValidAccessToken('a1')).toBe('token-2')
  })

  it('decrypts the stored refresh token with the store key', async () => {
    addAccount('a1', 'one@example.com')
    const refresh = vi.fn(async () => ({
      accessToken: 't',
      accessExpiry: Date.now() + 3_600_000,
    }))
    const manager = new TokenManager(store, refresh)

    await manager.getValidAccessToken('a1')
    expect(refresh).toHaveBeenCalledWith('refresh-token-for-a1')
  })
})
