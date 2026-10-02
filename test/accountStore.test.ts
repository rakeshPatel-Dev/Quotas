import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AccountStore, emptyAccount } from '../src/main/store/accountStore.js'
import { createSecretBox } from '../src/main/store/secretBox.js'
import { toPublicAccount, maskEmail, type Account } from '../src/shared/types.js'

let dir: string
let file: string

const newStore = (): AccountStore =>
  new AccountStore(createSecretBox({ force: 'dev-keyfile', keyFile: join(dir, 'dev.key') }), {
    file,
    saveDebounceMs: 0,
  })

const sample = (id: string, email: string): Account =>
  emptyAccount({ id, email, refreshTokenEnc: 'sealed-blob' })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aqt-store-'))
  file = join(dir, 'accounts.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('AccountStore persistence', () => {
  it('round-trips accounts through the file', async () => {
    const store = newStore()
    store.load()
    store.upsert(sample('a1', 'one@example.com'))
    store.upsert(sample('a2', 'two@example.com'))
    await store.flush()

    const reopened = newStore().load()
    expect(reopened.map((a) => a.email)).toEqual(['one@example.com', 'two@example.com'])
  })

  it('never writes a raw refresh token to disk', async () => {
    const store = newStore()
    store.load()
    store.upsert(
      emptyAccount({ id: 'a1', email: 'one@example.com', refreshTokenEnc: store.sealRefreshToken('super-secret') }),
    )
    await store.flush()

    const contents = readFileSync(file, 'utf8')
    expect(contents).not.toContain('super-secret')
    expect(contents).toContain('refreshTokenEnc')
    expect(store.openRefreshToken(store.get('a1')!)).toBe('super-secret')
  })

  it('recovers from a corrupt primary file using the backup', async () => {
    const store = newStore()
    store.load()
    store.upsert(sample('a1', 'one@example.com'))
    await store.flush()
    // A second save rotates the good copy into .bak.
    store.upsert(sample('a2', 'two@example.com'))
    await store.flush()

    // Simulate a crash that truncated the primary file.
    writeFileSync(file, '{"version":1,"accounts":[{"id":"a1"')

    const errors: string[] = []
    const recovered = new AccountStore(
      createSecretBox({ force: 'dev-keyfile', keyFile: join(dir, 'dev.key') }),
      { file, saveDebounceMs: 0 },
    )
    recovered.on('error', (err) => errors.push(err.message))
    const accounts = recovered.load()

    expect(accounts.length).toBeGreaterThan(0)
    expect(errors.some((m) => m.includes('backup'))).toBe(true)
  })

  it('ignores a stray tmp file left by a crash between write and rename', async () => {
    const store = newStore()
    store.load()
    store.upsert(sample('a1', 'one@example.com'))
    await store.flush()

    // The primary is still the last good file; the tmp copy must not win.
    writeFileSync(`${file}.tmp`, '{"version":1,"accounts":[]}')

    const reopened = newStore().load()
    expect(reopened.map((a) => a.email)).toEqual(['one@example.com'])
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })

  it('leaves no tmp file behind after a successful write', async () => {
    const store = newStore()
    store.load()
    store.upsert(sample('a1', 'one@example.com'))
    await store.flush()

    expect(existsSync(`${file}.tmp`)).toBe(false)
    expect(existsSync(file)).toBe(true)
  })

  it('serializes concurrent flushes so writes cannot interleave', async () => {
    const store = newStore()
    store.load()
    for (let i = 0; i < 25; i++) store.upsert(sample(`a${i}`, `user${i}@example.com`))

    await Promise.all([store.save(), store.flush(), store.save()])

    expect(newStore().load()).toHaveLength(25)
  })

  it('replaces an existing record on upsert, keyed by id', () => {
    const store = newStore()
    store.load()
    store.upsert(sample('a1', 'one@example.com'))
    store.update('a1', { projectId: 'rising-ember-123', nextPollAt: 999 })
    store.upsert({ ...sample('a1', 'one@example.com'), refreshTokenEnc: 'new-blob' })

    // A replace, not a merge: re-adding an account resets its schedule so it
    // polls immediately, and the caller carries over what it wants to keep.
    expect(store.list()).toHaveLength(1)
    expect(store.get('a1')?.refreshTokenEnc).toBe('new-blob')
    expect(store.get('a1')?.nextPollAt).toBe(0)
    expect(store.get('a1')?.projectId).toBeUndefined()
  })

  it('removes accounts and emits the id', () => {
    const store = newStore()
    store.load()
    store.upsert(sample('a1', 'one@example.com'))

    const removed: string[] = []
    store.on('removed', (id) => removed.push(id))

    expect(store.remove('a1')).toBe(true)
    expect(store.remove('a1')).toBe(false)
    expect(removed).toEqual(['a1'])
    expect(store.list()).toEqual([])
  })

  it('emits an update for each account as it changes', () => {
    const store = newStore()
    store.load()
    const seen: string[] = []
    store.on('updated', (account) => seen.push(account.id))

    store.upsert(sample('a1', 'one@example.com'))
    store.setStatus('a1', 'rate_limited', 'slow down')

    expect(seen).toEqual(['a1', 'a1'])
    expect(store.get('a1')?.lastError).toBe('slow down')
  })

  it('drops a record that does not match the schema instead of crashing', () => {
    writeFileSync(file, JSON.stringify({ version: 1, accounts: [{ id: 'a1', email: 'x@y.z' }] }))

    const errors: string[] = []
    const store = new AccountStore(
      createSecretBox({ force: 'dev-keyfile', keyFile: join(dir, 'dev.key') }),
      { file, saveDebounceMs: 0 },
    )
    store.on('error', (err) => errors.push(err.message))

    expect(store.load()).toEqual([])
    expect(errors.some((m) => m.includes('Invalid accounts file'))).toBe(true)
  })
})

describe('SecretBox', () => {
  it('round-trips and rejects tampered ciphertext', () => {
    const box = createSecretBox({ force: 'dev-keyfile', keyFile: join(dir, 'dev.key') })
    const sealed = box.seal('top-secret')

    expect(sealed).not.toContain('top-secret')
    expect(box.open(sealed)).toBe('top-secret')

    const bytes = Buffer.from(sealed.split(':')[2]!, 'base64')
    const last = bytes.length - 1
    bytes.writeUInt8(bytes.readUInt8(last) ^ 0xff, last)
    expect(() => box.open(`${sealed.split(':')[0]}:dev-keyfile:${bytes.toString('base64')}`)).toThrow()
  })

  it('cannot open a blob sealed with a different key', () => {
    const a = createSecretBox({ force: 'dev-keyfile', keyFile: join(dir, 'a.key') })
    const b = createSecretBox({ force: 'dev-keyfile', keyFile: join(dir, 'b.key') })

    expect(() => b.open(a.seal('top-secret'))).toThrow()
  })
})

describe('shared helpers', () => {
  it('strips secrets from the public account shape', () => {
    const account: Account = {
      ...sample('a1', 'one@example.com'),
      accessExpiry: Date.now() + 1000,
    }
    const publicAccount = toPublicAccount(account)

    expect(publicAccount).not.toHaveProperty('refreshTokenEnc')
    expect(publicAccount).not.toHaveProperty('accessExpiry')
    expect(JSON.stringify(publicAccount)).not.toContain('sealed-blob')
  })

  it('masks the local part of an email', () => {
    expect(maskEmail('someone@gmail.com')).toBe('s******@gmail.com')
    expect(maskEmail('a@b.com')).toBe('a***@b.com')
    expect(maskEmail('nope')).toBe('***')
  })
})
