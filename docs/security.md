# Security

What touches disk, what is encrypted, and where the trust boundaries are.

## What is stored, and where

Everything lives in one directory:

```
~/.antigravity-quota-tracker/
  accounts.json       0600 — account records, refresh tokens sealed
  accounts.json.bak   0600 — previous good copy
  dev.key             0600 — AES-256-GCM key, only when the keychain is unavailable
```

Override the location with `ANTIGRAVITY_TRACKER_DATA_DIR`, which is how tests
and throwaway profiles stay out of your real data.

The whole directory is gitignored, and so are `*.accounts.json`, `dev.key` and
`samples-private/`.

## What is never stored

- **Access tokens.** Held in memory for the process lifetime only. The store
  keeps an expiry *hint*, not the token, because a refresh token is enough to get
  a new access token and an access token expires in an hour.
- **Anything in the renderer.** The renderer receives `PublicAccount`, which is a
  distinct type with `refreshTokenEnc` and `accessExpiry` stripped. The IPC
  contract only ever passes `PublicAccount`, so there is no code path that hands
  a secret to the renderer.

## How tokens are protected

`store/secretBox.ts` picks a backend at startup and labels it.

**OS keychain (preferred).** Under Electron, `safeStorage` encrypts with a key
held by the OS credential store. The app prefers this whenever
`safeStorage.isEncryptionAvailable()` returns true, and the store records which
backend it used, so you always know which is in play.

**AES-256-GCM keyfile (fallback).** Under plain Node — the CLI — or when no
keychain is available, secrets are sealed with AES-256-GCM using a random 32-byte
key in a `0600` file next to the accounts file.

Be clear-eyed about what that fallback is: **obfuscation against accidents, not
against an attacker with filesystem access.** Anyone who can read `dev.key` can
read `accounts.json` and decrypt every refresh token. It exists so that tokens
are never sitting in plaintext during development, and so the app still works on
systems with no keyring.

Sealed values are self-describing strings:

```
v1:os-keychain:<base64>
v1:dev-keyfile:<base64>
```

The `kind` in the prefix means a store written under one backend is recognisable
under the other. Switching backends does not corrupt the file, though you still
need the matching key to read values sealed with the old one.

## Electron hardening

| Setting | Value | Why |
| --- | --- | --- |
| `contextIsolation` | `true` | The preload's globals and the page's globals are separate worlds. |
| `nodeIntegration` | `false` | The renderer has no `require`. |
| `sandbox` | `true` | The renderer runs in an OS sandbox. |
| `preload` | `.cjs` | Electron only loads sandboxed preloads as CommonJS; the rest of the project is ESM. |

The preload exposes a fixed set of methods over `contextBridge`. There is no
generic `invoke(channel, args)` escape hatch — the renderer can only call the
specific operations that exist.

### Content Security Policy

Production is a `default-src 'none'` with an explicit allowlist:

```
default-src 'none';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self';
connect-src 'self'
```

`'unsafe-inline'` is needed for styles because React sets inline styles, and
Tailwind's injected stylesheet is same-origin. Scripts get no `unsafe-inline` and
no `unsafe-eval`; the renderer uses no dynamic import, no workers and no eval, so
neither is needed. `connect-src 'self'` is sufficient because the renderer makes
no network requests at all.

Dev relaxes this, because the Vite client needs an inline preamble and an HMR
websocket.

### Navigation

`setWindowOpenHandler` denies every window and sends the URL to the system
browser. `will-navigate` blocks any navigation away from the loaded page, again
handing external URLs to the browser. The renderer cannot navigate itself or pop
windows.

### Permissions

`setPermissionRequestHandler` denies everything — camera, geolocation,
notifications, all of it. The app needs none of them.

### Fonts

Inter and JetBrains Mono are self-hosted from `src/renderer/fonts/`, Latin
subsets only, about 87 KB together. No CDN, no Google Fonts request, and
`font-src 'self'` holds. Beyond that, the CSS fallback stack is generic
(`ui-sans-serif, system-ui, sans-serif`), so no system font is resolved by name.

## OAuth

`src/main/config.ts` ships the public installed-app client credentials that the
Antigravity desktop client uses, which the community tools also reuse. Google
does not treat a desktop client's secret as secret — it ships in every install
of the app — but you should point this at your own client:

```bash
export ANTIGRAVITY_OAUTH_CLIENT_ID=...
export ANTIGRAVITY_OAUTH_CLIENT_SECRET=...
```

Your client must be an "installed application" with the same scopes plus a
loopback redirect URI registered.

The flow uses PKCE with `state` verification and a loopback redirect catcher. The
browser is only ever used for the consent screen; the code is redeemed
server-side.

## Write safety

`AccountStore` writes atomically: serialize, write to `accounts.json.tmp` with
mode `0600`, then `rename` over `accounts.json`. A crash mid-write therefore
leaves either the old file or the new one, never a truncated file. The previous
good copy is kept as `accounts.json.bak` and used automatically if the primary
is unreadable. Writes are debounced and serialized so two flushes cannot
interleave their renames.

## Honest limitations

- **The keyfile fallback is not real protection.** See above.
- **`accounts.json` is plaintext-structured.** An attacker can read which
  accounts you have and when you last polled them, even though the tokens inside
  are sealed.
- **Quota comes from an undocumented endpoint.** See
  [api-findings.md](api-findings.md).
- **No code signing.** The AppImage is unsigned, so some distributions will warn.
  See [building.md](building.md) for what that involves.
- **Many accounts means many requests.** Polling is polite by default (3
  concurrent, ~4 minutes apart), but adding accounts multiplies traffic against
  an internal Google API.