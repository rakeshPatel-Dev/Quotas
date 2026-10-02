# Antigravity Quotas

Desktop dashboard for tracking Antigravity model quota across many Google
accounts. One card per account, grouped by shared quota pool, with live countdowns
to the next reset.

![Charcoal dashboard with square account cards and green/yellow quota bars](docs/screenshot.png)

> **No public API.** This reads an undocumented Google endpoint that can change
> or disappear without notice. See [Caveats](#caveats).

## Install

Grab the AppImage and run it:

```bash
chmod +x Antigravity\ Quotas-*.AppImage
./Antigravity\ Quotas-*.AppImage
```

Then click **Add account** and sign in with Google in your browser. Only the
refresh token is stored, encrypted.

Existing accounts are picked up automatically from `~/.antigravity-quota-tracker/`.

Full setup, including desktop-menu integration and running from source:
**[docs/getting-started.md](docs/getting-started.md)**

## Build it yourself

Requires Node 20+.

```bash
npm install
npm run dist          # -> release/Antigravity Quotas-<version>.AppImage
```

Linux x64 is the tested target. Details and troubleshooting:
**[docs/building.md](docs/building.md)**

## Using it

The screen is a summary bar plus one card per account.

```
2 low · 1 unmetered · 5 of 6 metered · next reset 4h 12m
```

Cards sort low-quota accounts to the top automatically and give them a yellow
left edge. Status colours mean exactly one thing each:

| Colour | Meaning |
| --- | --- |
| green | healthy quota |
| yellow | at or below 5% remaining |
| amber | Google rate-limited the account |
| red | sign-in expired, or the fetch failed |

A pool Google does not report a percentage for renders as a hairline labelled
*unmetered*, never as `0%`. Accounts that need attention sort first in both
orderings; the Soonest/Lowest toggle only decides what ranks below them.

Full walkthrough: **[docs/using-the-app.md](docs/using-the-app.md)**

## CLI

The CLI predates the UI and is still the quickest way to check quota from a
script. Note the `--`, without which npm eats your arguments.

```bash
npm run dev -- add              # sign in with Google
npm run dev -- accounts         # list stored accounts
npm run dev -- quota            # fetch one account's quota
npm run dev -- quota --all      # every unpaused account, 3 at a time
npm run dev -- import           # adopt accounts from the antigravity-usage CLI
npm run dev -- remove <email>
npm run dev -- help
```

Reference: **[docs/cli.md](docs/cli.md)**

## Development

```bash
npm run dev        # Vite dev server
npm run app:dev    # Electron against the dev server
npm run app        # Electron against the built dist/
npm test           # 82 tests
npm run typecheck
```

The renderer never opens a socket and never touches the filesystem. Every fetch
and every write happens in the main process and returns over IPC as a
`PublicAccount` with secrets stripped. Architecture:
**[docs/architecture.md](docs/architecture.md)**

## Security

- Refresh tokens are sealed before touching disk: `safeStorage` (OS keychain)
  under Electron, AES-256-GCM with a `0600` keyfile under the CLI. The store
  records which backend is in play, and sealed values are self-describing so both
  can open the same file.
- Access tokens stay in memory. The store keeps an expiry hint, not the token.
- The renderer runs sandboxed with `contextIsolation`, no Node integration, a
  `default-src 'none'` CSP, and navigation and window-open both blocked.
- Data lives in `~/.antigravity-quota-tracker/` (override with
  `ANTIGRAVITY_TRACKER_DATA_DIR`), is gitignored, and is never inside the app
  bundle — upgrading never touches your tokens.
- Inter and JetBrains Mono are self-hosted, so no third-party requests leave the
  machine.

The keyfile fallback is obfuscation against accidents, not against someone with
filesystem access. Full detail, including honest limitations:
**[docs/security.md](docs/security.md)**

## Two things worth knowing

**Quota is metered per pool, not per model.** Several models, sometimes across
different families, share one pool with one percentage and one reset time. The
UI groups them and labels mixed pools like `Claude + GPT-OSS · 3 models`.

**Meters are provisioned per account, not per tier.** Accounts on the same free
tier can differ: some return a remaining percentage, some return none. Evidence
and reasoning: **[docs/api-findings.md](docs/api-findings.md)**, raw notes in
[`FINDINGS.md`](FINDINGS.md).

## Documentation

| | |
| --- | --- |
| [docs/README.md](docs/README.md) | Index |
| [docs/getting-started.md](docs/getting-started.md) | Install, first run, dev setup |
| [docs/using-the-app.md](docs/using-the-app.md) | Every control and colour |
| [docs/cli.md](docs/cli.md) | Command reference |
| [docs/building.md](docs/building.md) | Scripts, packaging, icons |
| [docs/architecture.md](docs/architecture.md) | As-built design |
| [docs/security.md](docs/security.md) | Storage, encryption, trust boundaries |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Symptoms and fixes |
| [docs/api-findings.md](docs/api-findings.md) | Live API behaviour |

Also: [`FINDINGS.md`](FINDINGS.md) (raw API observations) and
[`antigravity-quota-tracker-architecture.md`](antigravity-quota-tracker-architecture.md)
(original design).

## Caveats

- **The quota endpoint is internal and undocumented.** It can change or vanish
  without notice, and nothing here is guaranteed to keep working.
- **No code signing.** The AppImage is unsigned, so some distributions warn.
- **Many accounts means many requests.** Polling is polite by default — three
  concurrent, ~4 minutes apart with jitter — but adding accounts multiplies
  traffic against Google's API.
- **Using many accounts through a non-official client carries account risk.**
  Use accounts you can afford to lose, and check Google's terms.