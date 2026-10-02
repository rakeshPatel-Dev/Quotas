# CLI

The CLI predates the UI and is still the fastest way to check quota from a
terminal or a script. It shares all its code with the desktop app, so anything
true here is true there.

```bash
npm run dev -- <command>
```

`npm run dev` is `tsx src/cli.ts`. Note the `--`: without it npm swallows your
arguments. If you prefer, `npx tsx src/cli.ts <command>` works identically.

| Command | Effect |
| --- | --- |
| `add` | Opens your browser for Google sign-in, then stores the account. |
| `accounts` | Lists stored accounts with status and tier. |
| `quota [email]` | Fetches and prints one account's quota. Defaults to the first stored account. |
| `quota --all` | Fetches every unpaused account, three at a time. |
| `import` | Adopts accounts from the `antigravity-usage` CLI's config. |
| `remove <email>` | Deletes an account and its tokens. |
| anything else | Prints usage, the data directory, and which encryption backend is active. |

## Examples

Add an account:

```bash
npm run dev -- add
```

Check one account by address:

```bash
npm run dev -- quota user@example.com
```

A masked address works too — `quota u***@example.com` matches — so you can
paste what the CLI printed without exposing the full address in your shell
history.

Check everything, then extract just the accounts that are low, for scripting:

```bash
npm run dev -- quota --all
```

Adopt an existing `antigravity-usage` install:

```bash
npm run dev -- import
```

That reads `$XDG_CONFIG_HOME/antigravity-usage/accounts` (default
`~/.config/antigravity-usage/accounts`) and migrates the accounts it finds.

## Why `--` matters for `remove`

```
npm run dev -- remove user@example.com
```

The `--` is required, otherwise npm passes `user@example.com` to npm itself.
This is noted in `FINDINGS.md` because it bit us once during development.

## `import` and duplicate accounts

`import` derives an account id the same way the OAuth flow does — a SHA-256 of
the lowercased address. Signing in through the UI after importing the same
Google account therefore updates one record instead of creating a duplicate.

## Where the CLI differs from the app

- **Encryption backend.** The CLI runs under plain Node, where Electron's
  `safeStorage` is unavailable, so it uses the AES-256-GCM keyfile fallback and
  reports `encryption: dev-keyfile`. The app under Electron uses the OS
  keychain when one is available. Both read the same `accounts.json`, and the
  sealed values are self-describing (`v1:os-keychain:…` vs `v1:dev-keyfile:…`),
  so a keychain-sealed store still opens under the keyfile box and vice versa —
  it just needs the matching key present.
- **Polling.** The CLI fetches once and exits. The app polls on a ~4-minute
  cycle. The CLI never writes a poll schedule.
- **Shared state.** Do not run the CLI while the app is open. Both write
  `accounts.json`, and while writes are atomic with backup rotation, the CLI
  process holds its own in-memory copy and will happily overwrite a change the
  app made.

## Exit codes

`0` on success, `1` on error, with the message on stderr. `--all` keeps going
past individual account failures: a failing account is reported and the rest
still print, because one broken account should not hide the others.