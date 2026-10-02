# Getting started

## Option A: use a prebuilt AppImage (no tooling)

1. Download `Antigravity Quotas-<version>.AppImage`.
2. Make it executable:

   ```bash
   chmod +x Antigravity\ Quotas-*.AppImage
   ```

3. Run it:

   ```bash
   ./Antigravity\ Quotas-*.AppImage
   ```

4. Add an account with **Add account** in the top right. Your browser opens for
   Google sign-in. The app stores only the refresh token, encrypted.

If your desktop environment offers "Open With" after download, pick it once and
skip steps 2 and 3.

### Make it launchable from your app menu

The AppImage registers a `.desktop` entry and icon on first run. If your
environment does not pick it up, copy the entry and icon out of the mounted
AppImage:

```bash
APPIMAGE=./Antigravity\ Quotas-*.AppImage
"$APPIMAGE" --appimage-extract >/dev/null
sudo cp squashfs-root/*.desktop /usr/share/applications/
sudo cp squashfs-root/*.png /usr/share/icons/hicolor/1024x1024/apps/
sudo update-desktop-database /usr/share/applications 2>/dev/null || true
rm -rf squashfs-root
```

## Option B: build it yourself

You need Node 20 or newer.

```bash
npm install
npm run icon      # generate build/icon.png
npm run dist      # produces release/Antigravity Quotas-<version>.AppImage
```

If `npm run dist` reports a `.deb` failure about `libcrypt.so.1`, that is
electron-builder's bundled Ruby, not your app. Build the AppImage on its own
with `npm run dist:appimage`. See [building.md](building.md) for details.

## Option C: run from source

Useful while developing. Two terminals:

```bash
npm run dev            # terminal 1: Vite dev server on :5273
npm run app:dev        # terminal 2: Electron, pointed at the dev server
```

`npm run app` (without `:dev`) always loads the built renderer from `dist/`. It
never assumes a dev server is running, so it is the right command for a quick
local check after `npm run build`.

## Verifying it works

The dashboard should show one card per signed-in account. If a card reads
`error`, open the terminal that launched the app: the reason is logged with a
`[store]` or scheduler prefix, and [troubleshooting.md](troubleshooting.md)
maps common messages to fixes.

To check the CLI path independently of the UI:

```bash
npm run dev -- accounts
npm run dev -- quota --all
```

## Requirements and limits

- **Linux x64** for the current build. See [building.md](building.md) for other
  platforms.
- A Google account that has used Antigravity. Accounts that have never run a
  model return no quota pools at all and will show as *unmetered*.
- Network access to `accounts.google.com` (sign-in) and
  `cloudcode-pa.googleapis.com` (quota).
- Each account is polled every ~4 minutes plus jitter, three accounts at a time.
  Adding many accounts multiplies your request volume against Google.

Next: [using-the-app.md](using-the-app.md).