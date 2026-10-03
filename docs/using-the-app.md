# Using the app

The whole UI is one screen: a sticky summary bar, then a grid of account cards.
There are no menus, no navigation, and nothing hidden behind a hover except the
Remove label, which fades in on hover and is always reachable by keyboard.

## Common tasks

### Add your first account

1. Click **Add your first account** in the middle of the window (or **Add
   account** in the top right — the same button).
2. Your default browser opens at Google's sign-in page. Choose an account and
   approve the permissions.
3. The app is listening on a local port while this happens; Google redirects
   back to it and the card appears as soon as you approve.

Sign-in happens in the browser, not in the app. If nothing comes back, the
browser tab usually says the page can be closed — that is normal.

The card fetches quota immediately, then keeps itself up to date: each account
is polled about every four minutes, with up to 30 seconds of random offset so
accounts do not all hit Google at the same instant. You do not need to leave the
window open for this to work.

### Add more accounts

Repeat the same step. There is no limit in the app. Each Google account you add
becomes its own card, is polled independently, and fails independently — one
broken account never blanks the others.

The same Google account can only be added once per machine. Signing in again
with an account you already track **updates** it in place rather than creating a
duplicate, keeping its position and its last known quota.

### Remove an account

1. On the card, click **Remove** (bottom right of the card; the label is faint
   until you hover or focus it).
2. The button turns into **Remove** / **Cancel** — click **Remove** again to
   confirm.

This deletes the account, its encrypted refresh token, and its quota history from
this machine. It cannot be undone.

Removing it here only clears the local copy. The permission you granted still
exists in your Google account. To revoke it properly, remove Antigravity Quotas
from your Google account's security page.

### Stop tracking an account without deleting it

Click **Pause** on the card. A paused account:

- keeps its last known quota on screen, clearly labelled `paused`
- is not polled at all
- is skipped by **Refresh all**
- stays paused across restarts

Click **Resume** to bring it back. Resuming fetches immediately rather than
waiting for the next scheduled poll. This is the right choice for an account you
are deliberately not using, as opposed to one you have finished with.

### Fix an expired sign-in

When Google rejects a refresh token — after a password change, a revoked grant,
or a long period of inactivity — the card reads **Sign-in expired**. The app
pauses that account on its own, because retrying a revoked token can never
succeed.

Click **Re-sign in** on the card. That reopens your browser for a fresh Google
sign-in; pick the **same** account, and the card updates in place with its quota
history intact.

### Force an update

- **Refresh** on a card fetches that one account now.
- **Refresh all** in the summary bar fetches every unpaused account, three at a
  time.

Both are disabled while a fetch is already running. Polling happens on its own,
so you rarely need these; they are for checking a change immediately.

### Find the account you care about

Use the **Soonest / Lowest** toggle in the summary bar.

Accounts at or below 5% remaining are pinned to the top in *both* modes, so
whatever you are hunting for is never below something already broken. Paused
accounts sink to the bottom, because a paused account has nothing to act on.
The toggle only decides how everything below that ranks.

### Start completely over

Quit the app, then delete `~/.antigravity-quota-tracker/`, which holds the
accounts file and, on Linux or when running from source, the encryption key.
Relaunching gives you an empty dashboard. Google is not contacted during this
and no grant is revoked, so re-adding accounts means signing in again.

To keep several independent sets of accounts, point
`ANTIGRAVITY_TRACKER_DATA_DIR` at a different directory before launching.

## The summary bar

Top left is the app name. Under it, the only facts worth knowing at a glance:

```
2 low · 1 unmetered · 5 of 6 metered · next reset 4h 12m
```

| Fragment | Meaning |
| --- | --- |
| `N low` | Accounts at or below 5% remaining on any pool. Yellow. |
| `N unmetered` | Accounts Google returns no percentage for. Shown in grey, deliberately not counted as an error. |
| `X of Y metered` | How many accounts report a real remaining fraction. |
| `next reset …` | Countdown to the soonest reset across all accounts. Ticks live, no refresh needed. |

Countdowns are computed from a local clock and a stored reset timestamp, so they
keep counting down between fetches without any network traffic.

If the first fragment is `0 low`, it is omitted rather than shown. A summary with
nothing wrong in it stays quiet.

Top right has three controls:

- **Soonest / Lowest** — sort order for accounts that are not low on quota.
  Low-quota accounts are always pinned to the top regardless of this setting.
- **Refresh all** — fetch every unpaused account now. Reads `Refreshing…` while
  in flight and is disabled during a fetch.
- **Add account** — opens your browser for Google sign-in.

## Account cards

One card per signed-in account. Card width is fluid, minimum 360px.

**Header.** Your email address, then a status marker. Under that, the plan tier
(or `No usage meter`) and how long ago the data was fetched, so stale numbers are
always obvious.

**Status markers.** A healthy account shows nothing at all — its own numbers
already say it is fine. Anything else gets a small coloured square and a word:

| Marker | Colour | What it means | What to do |
| --- | --- | --- | --- |
| `Syncing` | grey, pulsing | A fetch is in flight. | Nothing. |
| `Throttled` | amber | Google rate-limited this account. | Wait; the app backs off on its own. |
| `Sign-in expired` | red | The refresh token was rejected, so the account is paused. | Click **Re-sign in** on the card. |
| `Failed` | red | Fetch failed for another reason. | Read the message in the red box on the card. |

`Sign-in expired` always implies the account is also paused, because no amount
of retrying will fix a revoked token.

**Quota pools.** Each row is one shared pool, not one model:

```
Gemini 3 Pro (5m)                              62%
████████████████████████████░░░░░░░░░░░░░░░░░  4h 12m
```

- The bar is green above 5%, yellow at or below 5%, red at zero.
- A percentage that Google does not report renders as a full-width hairline and
  the word `unmetered`, never as `0%`. This is the single most confusing thing
  about the underlying API; see [api-findings.md](api-findings.md).
- The number on the right is time until that pool resets.
- A pool can span several model families and tiers. Those are named together, as
  `Claude + GPT-OSS · 3 models`, instead of repeating near-identical rows.

**Actions.** Four controls sit in a row along the bottom of every card.

- **Re-sign in** appears only when sign-in has expired. It reopens the browser
  for a fresh Google sign-in and updates that card in place.
- **Pause** stops polling an account without deleting it, which is the one you
  want for an account you are deliberately not using. It becomes **Resume**.
- **Refresh** fetches that account now.
- **Remove** asks for confirmation, then deletes the account and its tokens.

**Low accounts sort first** and get a yellow left edge, so a run of accounts
about to hit a limit is visible without reading any numbers.

## Sorting and pausing

Both sort modes put low-quota accounts at the very top, ahead of everything
else. Below that, `Soonest` orders by the soonest reset and `Lowest` orders by
the smallest remaining percentage; unmetered accounts rank last in both, since
they have no percentage to compare. Paused accounts sink below active ones,
because a paused account has nothing to act on.

Note that only *low quota* drives this ordering. A throttled or failed account
keeps its position — those need reading the marker for, not reordering.

Pausing persists. A paused account keeps its last known quota numbers on screen,
stops being polled, and is skipped by `Refresh all`. Click `Resume` to bring it
back.

## What is not in the UI

- **No masking toggle.** Emails are always shown in full. This is a single-user
  local app, not a screen-share surface.
- **No historical charts.** You see current remaining and time to reset, nothing
  about the last week. Trend data is not stored.
- **No notifications.** Nothing fires when a pool runs low; you have to look.
- **No export or backup button.** The only copy is
  `~/.antigravity-quota-tracker/`. Copy that directory if you want a backup; it
  is already encrypted. It cannot be restored onto a different machine or OS,
  because the encryption is tied to your login via the OS keychain.
- **No per-model breakdown.** Google's data is per-pool, so a per-model view
  would be fabricated.

## Keyboard

Everything is reachable with Tab, and focused controls get a visible outline.
Enter or Space activates a button. Remove requires a second confirming click
rather than a modal, so there is nothing to dismiss.
