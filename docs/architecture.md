# Architecture

The original design document is `../antigravity-quota-tracker-architecture.md`.
This is the as-built version. Where the two disagree, this one reflects what the
code does and the design doc reflects what was planned — and
[api-findings.md](api-findings.md) explains why two of the plan's assumptions had
to change.

## Shape

Two processes, one direction of authority.

```
                    IPC (typed, PublicAccount only)
   ┌────────────────────────────────────────────────┐
   │                                                │
   ▼                                                │
┌───────────────┐                          ┌─────────┴────────┐
│  Renderer     │                          │  Main process    │
│  React 19     │                          │  Electron        │
│  Zustand      │                          │                  │
│  no network   │                          │  scheduler       │
│  no fs        │                          │  token manager   │
└───────────────┘                          │  Cloud Code API  │
                                           │  account store   │
                                           └──────────────────┘
```

The renderer never opens a socket and never touches the filesystem. Every fetch,
every file write, and every token operation happens in main and comes back over
IPC as a `PublicAccount` with the secrets already stripped. That is the whole
security model: a renderer compromise leaks no credentials, because the renderer
never had any.

## Layout

```
src/
  shared/
    types.ts          Account, ModelQuota, PublicAccount, QuotaPool, IPC contract
    pools.ts          grouping models into pools, low-quota threshold, labels
  main/
    index.ts          app lifecycle, window, CSP, service wiring
    ipc.ts            typed IPC handlers
    addAccount.ts     sign-in flow shared by the CLI and the UI
    config.ts         OAuth client, endpoints, data dir
    auth/
      oauthFlow.ts    PKCE + state, loopback catcher, token exchange
      tokenManager.ts access token cache, single-flight refresh
      importAccounts.ts   migration from antigravity-usage
    quota/
      schemas.ts      Zod schemas for Cloud Code responses
      parser.ts       raw response -> ModelQuota[] -> QuotaPool[]
      cloudcode.ts    loadCodeAssist / fetchAvailableModels / onboardUser
      service.ts      fetches one account, folds failures into status
    scheduler/
      scheduler.ts    per-account polling, jitter, backoff, concurrency cap
    store/
      accountStore.ts atomic writes, backup rotation, debounce
      secretBox.ts    OS keychain or AES-GCM keyfile
  preload/
    index.ts          contextBridge API, bundled to CJS
  renderer/
    main.tsx, index.css, index.html
    store.ts          Zustand state, initStore, selectors
    hooks/useNow.ts   one ticking clock shared by all countdowns
    lib/format.ts     countdown and relative-time formatting
    components/       App, TopBar, AccountCard, PoolRow, StatusChip
    fonts/            self-hosted Inter + JetBrains Mono (Latin subsets)
  cli.ts              verification CLI
```

## Decisions worth knowing

**Pool grouping lives in `shared/`.** Both the parser and the renderer need to
turn a flat model list into pools. Putting it in `shared/pools.ts` means the CLI
and the UI can never disagree about what "low quota" means.

**One clock, not N.** `useNow` publishes a single ticking timestamp that every
countdown reads. N per-card timers would drift and re-render independently for
no benefit.

**The scheduler publishes per account, not per batch.** `scheduler.ts` emits
`account:updated` as each fetch settles, so cards fill in progressively instead
of waiting for the slowest account.

**Backoff is per account.** Each account carries its own `nextPollAt` and
`backoffMs`. A rate-limited account delays only itself: 30s, doubling, capped at
30 minutes.

**Jitter is mandatory.** Every successful poll adds up to 30s of random spread.
Without it, every account added at the same time would be fetched at the same
time forever.

**Concurrency is capped at 3** in both the scheduler and the CLI's `--all` path.
This is politeness to Google's API, not a performance limit.

**Colour carries exactly one meaning.** The status ladder is four distinct steps
(healthy / caution / warn / critical) and nothing decorative uses them. A healthy
account has no badge at all. See [using-the-app.md](using-the-app.md).

**No rounded corners.** A global `border-radius: 0` plus the absence of any
`rounded-*` utility. This is a deliberate choice, not an oversight.

## Renderer security posture

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- Preload exposes a fixed set of methods via `contextBridge`, nothing dynamic
- Production CSP is `default-src 'none'` with an explicit allowlist; the renderer
  needs no `connect-src` beyond `'self'` because it makes no network requests
- Navigation and `window.open` are both blocked; external URLs go to the system
  browser via `shell.openExternal`
- Permission requests (camera, geolocation, notifications) are all denied

One deviation from a common default: `app.disableHardwareAcceleration()` is
deliberately **not** called. On the development machine the software fallback
(SwiftShader) is unusable, so disabling acceleration makes the GPU process die
at startup with `GPU process isn't usable. Goodbye.` and the app core-dumps. The
resulting `ozone-platform=wayland is not compatible with Vulkan` log line on
mixed Wayland/X11 sessions is cosmetic.

## Tests

82 tests across five files, all pure-logic with no Electron or network:

| File | Covers |
| --- | --- |
| `test/parser.test.ts` | Cloud Code response shapes, including the malformed and empty ones |
| `test/pools.test.ts` | grouping, mixed families, the 5% threshold, unmetered handling |
| `test/scheduler.test.ts` | timing, jitter, backoff, concurrency, per-account isolation |
| `test/tokenManager.test.ts` | single-flight refresh, expiry, seal/open round-trip |
| `test/accountStore.test.ts` | atomic writes, backup rotation, debounce, corruption recovery |

There are no renderer or IPC integration tests. That is the main testing gap:
the UI is verified by running it against live data, not by assertions.