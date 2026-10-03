# Getting started

## Option A: install a prebuilt release

Get the files from the
[GitHub Releases page](https://github.com/rakeshPatel-Dev/Quotas/releases). Pick
the row that matches your platform. All builds are x64 except the Apple Silicon
`.dmg`.

### macOS

Download the `.dmg` — `-arm64` for Apple Silicon, plain for Intel — open it, and
drag **Antigravity Quotas** into Applications.

It is unsigned, so the first launch is blocked:

> Right-click the app in Applications → **Open** → **Open** in the dialog.

Only needed once. `xattr -d com.apple.quarantine` on the app also works.

### Windows

Download `Antigravity Quotas Setup <version>.exe` and run it. The installer
offers a directory and installs per-user, so no administrator rights are needed.

SmartScreen will warn on first run; choose **More info** → **Run anyway**.

### Debian / Ubuntu

```bash
sudo apt install ./antigravity-quota-tracker_<version>_amd64.deb
```

Use `apt install ./file.deb` rather than `dpkg -i` so dependencies resolve.

### Fedora / openSUSE

```bash
sudo dnf install ./antigravity-quota-tracker-<version>.x86_64.rpm
```

### Any Linux x64 (AppImage)

Portable, nothing installed:

```bash
chmod +x Antigravity\ Quotas-*.AppImage
./Antigravity\ Quotas-*.AppImage
```

The AppImage registers a `.desktop` entry and icon on first run. If your desktop
environment does not pick it up, copy them out of the mounted image:

```bash
APPIMAGE=./Antigravity\ Quotas-*.AppImage
"$APPIMAGE" --appimage-extract >/dev/null
sudo cp squashfs-root/*.desktop /usr/share/applications/
sudo cp squashfs-root/*.png /usr/share/icons/hicolor/1024x1024/apps/
sudo update-desktop-database /usr/share/applications 2>/dev/null || true
rm -rf squashfs-root
```

### First run

The app opens on a single window with a summary bar and one card per account.
With no accounts yet, the middle of the window has a single button.

**Click Add your first account.** Your default browser opens at Google's sign-in
page. Choose an account and approve the permissions; the app is listening on a
local port while this happens, so the card appears the moment you approve. If
the browser says the page can be closed, that is normal.

Only the refresh token is stored, encrypted with your OS keychain. No password
is ever seen by the app.

To add more accounts, click **Add account** in the top right and repeat. The same
Google account can only be added once per machine; signing in again with an
account you already track updates it in place rather than duplicating it.

Each account is polled about every four minutes on its own schedule, with a
random offset so a dozen accounts do not all hit Google at the same instant.
Three accounts are fetched concurrently and a failing account backs off on its
own, so one broken account never affects the rest. You can leave the window
closed; polling resumes when you reopen it.

Accounts are per-machine and live in `~/.antigravity-quota-tracker/`. Upgrading
the app never touches them, so reinstalling is always safe.

What to do next:

- To pause, refresh, re-sign in or remove an account, see
  **[using-the-app.md](using-the-app.md)**.
- If sign-in did not complete or a card reads `Sign-in expired`, see
  **[troubleshooting.md](troubleshooting.md)**.

## Option B: build it yourself

You need Node 20 or newer.

```bash
npm install
npm run icon      # generate build/icon.png
npm run dist      # packages for whichever platform you are on -> release/
```

Per-platform scripts: `dist:linux` (AppImage + deb + rpm), `dist:mac`,
`dist:win`, or `dist:all` for everything.

A `.dmg` can only be produced on macOS. On Linux, `.deb` and `.rpm` additionally
need `rpmbuild` installed, and electron-builder's bundled Ruby needs
`libcrypt.so.1` — present on Debian/Ubuntu, absent on Arch, where a
`libcrypt.so.1` failure is a packaging-tool problem, not an app one. See
[building.md](building.md).

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

The dashboard should show one card per signed-in account, each with at least one
quota pool row. Two things confirm data is live rather than cached:

- the summary bar shows `X of Y metered`, where X counts accounts Google returns
  a real percentage for
- each card shows how long ago it was fetched

A card reading `Failed`, `Throttled`, or `Sign-in expired` is reporting a real
problem, not a broken install. The red box on the card carries the underlying
message, and [troubleshooting.md](troubleshooting.md) maps those to fixes. If you
are running from source, the reason is also logged to the terminal that launched
the app with a `[store]` or scheduler prefix.

Not every account will show a percentage. Google provisions meters per account,
so some legitimately report only a reset time and appear as `unmetered`. That is
explained in [api-findings.md](api-findings.md).

## Requirements and limits

- macOS (x64 or Apple Silicon), Windows x64, or Linux x64. Linux `.deb` and
  `.rpm` additionally need `rpmbuild` on the build machine. See
  [building.md](building.md).
- A Google account that has used Antigravity. Accounts that have never run a
  model return no quota pools at all and will show as *unmetered*.
- Network access to `accounts.google.com` (sign-in) and
  `cloudcode-pa.googleapis.com` (quota).
- Each account is polled every ~4 minutes plus jitter, three accounts at a time.
  Adding many accounts multiplies your request volume against Google.

Next: [using-the-app.md](using-the-app.md).