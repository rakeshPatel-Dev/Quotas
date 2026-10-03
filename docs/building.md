# Building

## Scripts

| Script | What it does |
| --- | --- |
| `npm run build` | Builds the renderer (Vite), bundles the preload (esbuild, CJS), compiles main + shared (tsc). |
| `npm run dist` | `build` then electron-builder for the host platform. |
| `npm run dist:linux` | AppImage + deb + rpm. |
| `npm run dist:mac` | dmg, x64 and arm64. Requires macOS. |
| `npm run dist:win` | NSIS `.exe` installer. |
| `npm run dist:all` | Every target above, for the host platform. |
| `npm run dist:appimage` | Same as `dist:linux` but AppImage-only. |
| `npm run dist:deb` | Builds a `.deb` only. Fails without `libcrypt.so.1`; see below. |
| `npm run pack` | `build` then `electron-builder --dir`, an unpacked directory. Fast, no installer. |
| `npm run icon` | Regenerates `build/icon.png`. |
| `npm run typecheck` | Typechecks main/shared and the renderer separately. |
| `npm test` | Vitest, 82 tests. |
| `npm run app` | Runs Electron against the built `dist/`. |
| `npm run app:dev` | Runs Electron against the Vite dev server. |

`npm run app` deliberately loads the built files rather than guessing from
`app.isPackaged`. Running from source is still a production-style load, so it
never silently requires a dev server.

## The three build steps

`npm run build` runs three tools because the app has three kinds of source:

1. **Vite** builds `src/renderer` (React, TSX, Tailwind) into
   `dist/renderer/`, with `base: './'` so assets resolve over `file://` inside
   an asar archive as well as from a dev server.
2. **esbuild** bundles `src/preload/index.ts` to `dist/preload/index.cjs`. The
   `.cjs` extension is not cosmetic: Electron only runs a sandboxed preload as
   CommonJS, and the rest of the project is ESM.
3. **tsc** compiles `src/main` and `src/shared` to `dist/` as ESM, keeping the
   module graph intact so `import.meta.url` path resolution still works for the
   renderer and preload files.

## Packaging

electron-builder reads its config from the `build` field in `package.json`.

Only two runtime dependencies are shipped: `zod` and `p-limit`. React, React
DOM, Zustand and both font packages are devDependencies because Vite bundles
them into the renderer output — shipping them again inside the asar would be
dead weight.

The renderer, main process and both fonts all live inside `app.asar`. Account
data does not: it stays in `~/.antigravity-quota-tracker/`, outside the archive,
so upgrading the app never touches your tokens.

### Current platform support

Targets macOS (x64 + arm64), Windows x64 and Linux x64. `.dmg` requires a macOS
host; everything else builds anywhere the toolchain allows.

On Linux, `.deb` and `.rpm` shell out to electron-builder's bundled Ruby `fpm`
and to `rpmbuild` respectively:

- `fpm` needs `libcrypt.so.1`. Debian/Ubuntu have it; Arch ships only
  `libcrypt.so.2`, so `.deb` fails there with `error while loading shared
  libraries`. That is a packaging-tool limitation, not an app fault.
- `rpm` needs `rpmbuild` (`apt install rpm`). GitHub's Ubuntu runners include
  it, and the release workflow guards for it anyway.

The AppImage has no such dependencies, which makes it the reliable local target
and the reason Linux is covered three ways.

### Release automation

`.github/workflows/release.yml` builds on native runners — a `.dmg` cannot be
cross-compiled from Linux — then collects every artifact into one GitHub Release:

| Runner | Artifact |
| --- | --- |
| `macos-15-intel` | dmg x64 |
| `macos-15` | dmg arm64 |
| `windows-latest` | NSIS exe |
| `ubuntu-24.04` | AppImage, deb, rpm |

Trigger it by pushing a `v*` tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

`workflow_dispatch` also runs it manually, but only publishes a Release when the
ref is a tag. Labels are pinned deliberately: `macos-13` has been retired, and
`ubuntu-latest` moves to 26.04 in November 2026.

### Before publishing anywhere

`package.json` contains placeholder identity fields that will end up in package
metadata:

- `author.email`
- `homepage`
- `build.linux.maintainer`

They exist because electron-builder refuses to build a `.deb` without a
maintainer address. `homepage` and `repository` now point at
`rakeshPatel-Dev/Quotas`; `author.email` is still `patel@localhost`.

### The bundled OAuth client

A released build must be able to sign in without the user configuring anything,
so the binary ships an OAuth client from `src/main/oauthClient.ts`. Desktop
("installed application") clients cannot keep a secret — Google treats the
loopback redirect as the boundary — which is why every Electron and browser app
embeds one.

Resolution order at startup:

1. `ANTIGRAVITY_OAUTH_CLIENT_ID` / `..._SECRET`, including from `.env`
2. the client in `src/main/oauthClient.ts`

**Before tagging a release, that file must contain a working client.** It ships
with `REPLACE_WITH_YOUR_OWN_*` placeholders, and `assertOAuthConfigured()` throws
on them, so an unconfigured build reports the real problem instead of failing at
Google's consent screen with `invalid_client`.

### How the client reaches a release

The client is **not committed.** GitHub push protection blocks any push whose
diff contains a `GOCSPX-` string, and a secret in history cannot be withdrawn
afterwards — it would need another force-push and rewrite. So:

1. Add two repository secrets under **Settings → Secrets and variables →
   Actions**:
   - `ANTIGRAVITY_OAUTH_CLIENT_ID`
   - `ANTIGRAVITY_OAUTH_CLIENT_SECRET`
2. Tag a release. The workflow runs `scripts/bundleOAuthClient.mjs --require`,
   which writes the values into `src/main/oauthClient.ts` on the runner before
   electron-builder packages. `--require` exits non-zero if either secret is
   absent, so a misconfigured run fails instead of publishing six installers
   that cannot sign in.

Locally, `npm run dist` runs the same script without `--require`; with a `.env`
present it picks the values up from there, and with neither it leaves the
placeholders and `assertOAuthConfigured()` catches it.

To issue a client:

1. Google Cloud Console → create or pick a project.
2. Enable the **Cloud Code API** (`cloudcode.googleapis.com`).
3. Credentials → **Create credentials** → **OAuth client ID**.
4. Application type must be **Desktop app**. A Web application client will not
   work: Google rejects loopback redirects for that type.
5. Add the scopes listed in `oauthConfig.scopes`. Desktop clients need no
   registered redirect URI — any loopback port is allowed.
6. Put the id and secret in the two Actions secrets.

Everyone who installs the app shares that one client, and its quota and
revocation are yours to own. Rotate it from the Cloud Console if it leaks;
nothing in the repository needs rewriting when you do.

Nothing is signed or notarized. macOS builds want a Developer ID certificate and
`notarize` before distribution; Windows builds want an Authenticode certificate
or SmartScreen will keep warning users. See the security notes in
[security.md](security.md).

## The icon

`build/icon.png` is generated by `scripts/makeIcon.ts`, not hand-drawn: a
1024×1024 charcoal tile with three stacked bars in white, green and yellow,
echoing a `PoolRow` in the UI. It is written as a hand-rolled PNG (zlib deflate
plus CRC32 chunks) to avoid pulling an image library into the dependency tree
for one asset.

Regenerate it after changing the palette:

```bash
npm run icon
```

## Verifying a build

```bash
npm run typecheck && npm test && npm run pack
./release/linux-unpacked/antigravity-quota-tracker
```

To confirm the packaged app renders real data rather than just starting up, use
the screenshot hook. It boots the real app, waits for account cards to appear,
writes a PNG and exits:

```bash
ANTIGRAVITY_TRACKER_SCREENSHOT=/tmp/check.png \
  ./release/linux-unpacked/antigravity-quota-tracker
```

The hook reads an environment variable and is inert unless it is set. There is
also `npm run screenshot` for the unpacked-source case.

## Adding another platform

The `build.linux` block is the only platform config. For macOS or Windows, add
the corresponding block; the `files`, `asar` and `extraMetadata` keys are
cross-platform. A macOS build additionally needs `mac.category`, and signing or
notarisation if you intend to distribute it.