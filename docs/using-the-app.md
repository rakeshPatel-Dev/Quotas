# Using the app

The whole UI is one screen: a sticky summary bar, then a grid of account cards.
There are no menus, no navigation, and nothing hidden behind a hover except the
Remove label, which fades in on hover and is always reachable by keyboard.

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
| `Sign-in expired` | red | The refresh token was rejected. | Click **Re-sign in** on the card. |
| `Failed` | red | Fetch failed for another reason. | Read the message in the red box on the card. |

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

**Actions.** `Pause` stops polling an account without deleting it, which is the
one you want for an account you are deliberately not using. `Refresh` fetches
that account now. `Remove` asks for confirmation, then deletes the account and
its tokens.

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
- **No per-model breakdown.** Google's data is per-pool, so a per-model view
  would be fabricated.

## Keyboard

Everything is reachable with Tab, and focused controls get a visible outline.
Enter or Space activates a button. Remove requires a second confirming click
rather than a modal, so there is nothing to dismiss.