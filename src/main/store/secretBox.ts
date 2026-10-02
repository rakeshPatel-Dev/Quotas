import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createRequire } from 'node:module'
import { getDevKeyFile } from '../config.js'

/**
 * Sealed secrets are self-describing strings: `v1:<kind>:<base64 payload>`.
 * The kind lets a file written in dev mode still be readable if the app later
 * gains access to the OS keychain, and vice versa.
 */
export type SecretBoxKind = 'os-keychain' | 'dev-keyfile'

export interface SecretBox {
  readonly kind: SecretBoxKind
  /** Encrypts a UTF-8 string. */
  seal(plain: string): string
  /** Decrypts a value produced by `seal` of the same kind. Throws on tampering. */
  open(sealed: string): string
}

const PREFIX = 'v1'

interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(blob: Buffer): string
}

const require_ = createRequire(import.meta.url)

function tryOsKeychain(): SecretBox | null {
  let safeStorage: SafeStorageLike | undefined
  try {
    // Resolves to Electron's module inside the main process, throws in plain Node.
    const electron = require_('electron') as { safeStorage?: SafeStorageLike }
    safeStorage = electron?.safeStorage
  } catch {
    return null
  }
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) return null

  return {
    kind: 'os-keychain',
    seal(plain) {
      return `${PREFIX}:os-keychain:${safeStorage!.encryptString(plain).toString('base64')}`
    },
    open(sealed) {
      return safeStorage!.decryptString(Buffer.from(payloadOf(sealed), 'base64'))
    },
  }
}

/**
 * Development fallback so the main process can be run and tested outside
 * Electron. The key lives in a 0600 file next to the accounts file, which is
 * obfuscation against accidents, not against a local attacker. Prefer the OS
 * keychain for anything you care about.
 */
function devKeyfileBox(keyFile: string): SecretBox {
  let key: Buffer | undefined

  const loadKey = (): Buffer => {
    if (key) return key
    if (!existsSync(keyFile)) {
      mkdirSync(dirname(keyFile), { recursive: true })
      key = randomBytes(32)
      writeFileSync(keyFile, key, { mode: 0o600 })
      chmodSync(keyFile, 0o600)
    } else {
      key = readFileSync(keyFile)
      if (key.length !== 32) {
        throw new Error(`Corrupt dev key at ${keyFile}: expected 32 bytes, got ${key.length}`)
      }
    }
    return key
  }

  return {
    kind: 'dev-keyfile',
    seal(plain) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', loadKey(), iv)
      const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
      return `${PREFIX}:dev-keyfile:${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')}`
    },
    open(sealed) {
      const raw = Buffer.from(payloadOf(sealed), 'base64')
      const iv = raw.subarray(0, 12)
      const tag = raw.subarray(12, 28)
      const encrypted = raw.subarray(28)
      const decipher = createDecipheriv('aes-256-gcm', loadKey(), iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
    },
  }
}

function payloadOf(sealed: string): string {
  const parts = sealed.split(':')
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    throw new Error('Unrecognized sealed secret format')
  }
  return parts[2]!
}

export interface CreateSecretBoxOptions {
  /** Overrides the key location; only meaningful for the dev-keyfile box. */
  keyFile?: string
  /** Forces a specific backend instead of probing for Electron. */
  force?: SecretBoxKind
}

export function createSecretBox(options: CreateSecretBoxOptions = {}): SecretBox {
  if (options.force !== 'dev-keyfile') {
    const keychain = tryOsKeychain()
    if (keychain) return keychain
  }
  return devKeyfileBox(options.keyFile ?? getDevKeyFile())
}
