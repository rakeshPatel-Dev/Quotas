# Antigravity Multi-Account Quota Tracker: Architecture

A desktop app that lets you add many Antigravity (Google) accounts and shows each account's model quota and reset countdown in one dashboard, updating all accounts at once.

---

## 1. Goals and constraints

**Goals**

- Add any number of accounts, each with a different email.
- Show remaining quota per model family (Claude, Gemini Pro, Gemini Flash) for every account.
- Show a live countdown to each quota reset.
- One broken account must never affect the others.

**Constraints**

- There is no official public quota API. The app relies on the internal Cloud Code API endpoint (`fetchAvailableModels`) that existing community tools use. It can change or break without notice.
- Using many accounts through a non-official client may carry account risk. Use accounts you can afford to lose and check Google's terms.
- OAuth tokens give access to Google accounts, so they must be stored encrypted and never leave the machine.

---

## 2. High-level architecture

```
+----------------------------------------------------------+
|  RENDERER PROCESS (React UI)                             |
|  [Account cards]  [Countdown ticker]  [Add account]      |
+--------------------------+-------------------------------+
                           | IPC (preload bridge, no tokens)
+--------------------------v-------------------------------+
|  MAIN PROCESS (Node)                                     |
|  [Auth manager] [Token manager] [Quota client] [Scheduler]|
+-------+------------------+------------------+------------+
        |                  |                  |
 Google OAuth       Account store      Cloud Code API
 (external)      (encrypted tokens)      (external)
```

The UI only displays data. All tokens, network calls, and scheduling live in the main process.

---

## 3. Tech stack

| Layer | Choice |
|---|---|
| Shell | Electron (Tauri is an alternative) |
| UI | React + TypeScript + Tailwind |
| UI state | Zustand, one store keyed by account ID |
| Main process | Node + TypeScript |
| Token encryption | Electron `safeStorage` (OS keychain) |
| Persistence | JSON file, atomic writes |
| Validation | Zod for API responses |
| Concurrency | `p-limit` |
| Packaging | electron-builder |

---

## 4. Folder structure

```
src/
  main/
    index.ts              app bootstrap, window creation
    ipc.ts                IPC handlers (only bridge to the UI)
    auth/
      oauthFlow.ts        browser login + localhost redirect catcher
      tokenManager.ts     access token cache + per-account refresh lock
    quota/
      quotaClient.ts      calls to the quota endpoint
      parser.ts           raw response -> normalized ModelQuota[]
    scheduler/
      scheduler.ts        jittered polling, concurrency cap, backoff
    store/
      accountStore.ts     load/save, atomic writes, encryption
  preload/
    index.ts              exposes a safe window.api to the UI
  renderer/
    App.tsx
    store/useAccounts.ts
    components/
      AccountCard.tsx
      ModelQuotaRow.tsx   progress bar + countdown
      AddAccountButton.tsx
    hooks/useNow.ts       single shared 1s ticker
  shared/
    types.ts              Account, ModelQuota, IPC payloads
```

---

## 5. Data model

```ts
type ModelQuota = {
  modelId: string;            // e.g. claude, gemini-pro, gemini-flash
  remainingFraction: number;  // 0..1
  resetAt: number | null;     // UTC epoch ms
};

type Account = {
  id: string;                 // Google "sub" (never the email)
  email: string;
  refreshTokenEnc: string;    // encrypted blob
  projectId?: string;         // fetched per account, never shared
  quota: ModelQuota[];
  fetchedAt?: number;
  status: 'ok' | 'refreshing' | 'auth_error' | 'rate_limited' | 'error';
  lastError?: string;
  nextPollAt: number;         // per-account schedule
  backoffMs: number;          // per-account backoff
  paused: boolean;
};
```

Key rule: there is no global "current account". Every account carries its own credentials, schedule, backoff, and status.

---

## 6. Main process modules

### 6.1 Auth manager

- Opens the system browser to Google's consent page.
- Starts a temporary `127.0.0.1` server to catch the redirect.
- Uses PKCE and a random `state` value.
- Reads the Google user ID from the ID token and upserts the account by that ID, so adding the same email twice only updates it.
- OAuth client ID and scopes live in one config file. Copy these from a working open-source reference tool.

### 6.2 Token manager

`getAccessToken(accountId)`:

1. Return the cached token if it has more than 60 seconds left.
2. Otherwise refresh. Use a `Map<accountId, Promise<string>>` so simultaneous callers share one in-flight refresh.
3. On `invalid_grant`, mark the account `auth_error` and stop retrying.

```ts
const inflight = new Map<string, Promise<string>>();

function getValidAccessToken(a: Account) {
  if (a.accessExpiry && a.accessExpiry > Date.now() + 60_000)
    return Promise.resolve(a.accessToken!);
  if (!inflight.has(a.id)) {
    inflight.set(a.id, doRefresh(a).finally(() => inflight.delete(a.id)));
  }
  return inflight.get(a.id)!;
}
```

### 6.3 Quota client

- Input: access token and project ID. Output: normalized `ModelQuota[]`.
- All parsing and Zod validation live in `parser.ts`. If the API changes, only this file needs fixing.

### 6.4 Scheduler

This is what lets many accounts run at once.

```
tick every 5s:
  due = accounts.filter(a => !a.paused && a.nextPollAt <= now)
  run due accounts through a concurrency limiter (max 3)
  on success:    nextPollAt = now + 4min +/- random 30s; backoffMs = 0
  on 429:        backoffMs = min(backoffMs*2 || 30s, 30min); nextPollAt = now + backoffMs
  on auth_error: paused = true until the user logs in again
  after EACH account finishes: emit IPC 'account:updated' (don't wait for the rest)
```

Use `Promise.allSettled`, never `Promise.all`, so one failure cannot block the batch.

### 6.5 Account store

- In-memory map, saved with a debounce.
- Atomic writes: write a temp file, then rename.
- Keep one backup copy of the last good file.
- Refresh tokens encrypted with `safeStorage`.

---

## 7. IPC contract

The UI never touches tokens or the network. It only gets these calls through the preload script:

```ts
api.listAccounts(): Promise<PublicAccount[]>   // no tokens included
api.addAccount(): Promise<void>
api.removeAccount(id: string): Promise<void>
api.refresh(id: string | 'all'): Promise<void>
api.setPaused(id: string, paused: boolean): Promise<void>
api.onAccountUpdated(cb: (a: PublicAccount) => void): void   // pushed per account
```

---

## 8. Key flows

**Add account**
Click Add -> Auth manager opens browser -> redirect caught -> code exchanged -> user ID read -> account upserted -> immediate first quota fetch -> card appears.

**Poll cycle**
Scheduler picks due accounts -> token manager returns a valid token -> quota client fetches -> store updates -> IPC pushes that single account to the UI.

**Countdown**
A single `useNow()` hook ticks once per second for the whole UI. Each row computes `resetAt - now`. At zero, the row shows "refreshing" and requests a refresh for that account only. No API calls are made just to animate the timer.

---

## 9. UI design

One responsive grid of account cards. Each card shows:

- Email (with a mask option), status badge, "updated 2m ago"
- One row per model family: progress bar, percent remaining, countdown
- A "low" state when any pool drops below about 5%
- Actions: refresh, pause, remove, re-login

Top bar:

- Refresh all
- Sort toggle (most quota first, or soonest reset first)
- Summary, for example "4 of 7 accounts available"

---

## 10. Error handling

| Error | Behavior |
|---|---|
| Access token expired | Silent refresh, retry once |
| Refresh token revoked (`invalid_grant`) | Mark "re-login needed", stop polling that account |
| 403 / account restricted | Warning badge, stop polling that account |
| 429 | Exponential backoff for that account only |
| Network down | Keep last data, show "stale" with its age |
| Response shape changed | Zod fails, show "API changed" for that account, log the raw response locally |

Other rules:

- Store reset times as UTC epoch and format only at display time.
- Always keep the last known quota when a fetch fails, marked stale.
- Fetching runs in the main process, so the UI never freezes.

---

## 11. Security

- Tokens are encrypted with `safeStorage` and never sent to the renderer.
- `contextIsolation: true`, `nodeIntegration: false`, strict CSP.
- Add the accounts file to `.gitignore`. Never log tokens.
- Provide an "Export without tokens" option for safe backups and bug reports.
- Do not host this as a web service. Keep refresh tokens on the user's own machine.

---

## 12. Testing

- **Parser:** unit tests against saved sample API responses.
- **Scheduler:** fake clock tests for jitter, backoff, and pausing.
- **Token manager:** 10 simultaneous callers must trigger exactly one refresh.
- **Store:** simulate a crash mid-write and confirm the file is not corrupted.
- **Isolation:** one account returning errors must not change the others' data.

---

## 13. Build order

1. Account store and shared types
2. OAuth flow (add one account)
3. Token manager and quota client (print one account's quota to the console)
4. Scheduler with several accounts
5. IPC bridge and UI cards
6. Countdown, error states, polish
7. Packaging with electron-builder

---

## 14. Risks and open questions

- The quota endpoint is undocumented and may change or be blocked.
- Account bans are possible when using non-official clients, so use disposable accounts.
- OAuth client details must come from a reference implementation and should be reviewed before use.
- Decide the target OS (Windows, macOS, Linux) before packaging.

---

## 15. Reference projects

Community tools that already solve parts of this and are worth reading for endpoint and OAuth details:

- `antigravity-usage` (CLI, multi-account quota table)
- `antigravity-limit-checker` (portable Electron app)
- `opencode-antigravity-auth` and `opencode-antigravity-quota` (multi-account plugins)
