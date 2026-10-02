# Live API findings (verified 2026-10-02)

Notes captured while building steps 1-3. These change the design in
`antigravity-quota-tracker-architecture.md`, so they are recorded here rather
than in the architecture doc.

## 1. `remainingFraction` is only returned for accounts that have real quota pools

`POST /v1internal:fetchAvailableModels` returns `quotaInfo.resetTime` for every
model, but `quotaInfo.remainingFraction` is **absent** unless the account is
enrolled in a tier with metered quota.

Measured across three real accounts:

| Account | Models | Models with `remainingFraction` | `loadCodeAssist.planInfo` |
|---|---|---|---|
| account-a | 27 | 4 (all internal `chat_*`/`tab_*`) | absent |
| account-b | 27 | 4 (all internal `chat_*`/`tab_*`) | absent |
| account-c | 27 | 27 (all real models) | absent |

So "show remaining quota per model" cannot be the base assumption. The parser
must treat `remainingFraction` as optional, which `ModelQuota.remainingFraction:
number | null` already does. Accounts with no fraction still get a usable reset
countdown.

The 4 models that always carry a fraction are internal plumbing (`chat_20706`,
`tab_flash_lite_preview`, ...) and are filtered out anyway.

**It is not tier-based.** Re-verified with `scripts/debugQuotaShape.ts`: all four
accounts report the identical `currentTier.id = "free-tier"` and
`paidTier.name = "Antigravity Starter Quota"`, yet one of them returns fractions
for all 27 models and the other three return them only on the filtered plumbing
ids. So the UI must not suggest that upgrading will make numbers appear; the
meter is provisioned per account by the server, and the only honest thing to show
for an account without it is the reset countdown.

Note when reading the CLI: `npm run dev -- quota --all` needs the `--`, or npm
consumes `--all` itself and the command silently falls back to one account.

## 2. Quota is per-pool, not per-model

On the one account with metered quota, the 27 models collapse to two pools:

- Gemini family: `remainingFraction: 1`, reset `2026-10-09T16:06:24Z`
- Claude + GPT-OSS family: `remainingFraction: 0.571697`, reset `2026-10-09T05:50:03Z`

Every model in a pool reports an identical fraction and reset time. Rendering 27
progress bars would be 25 duplicates of the same two numbers.

`parseQuota` therefore returns both the flat `quota: ModelQuota[]` (the shape in
the architecture doc) and a derived `pools: QuotaPool[]` grouped on
`(remainingFraction, resetAt)`. The UI renders pools. This matches what
`opencode-antigravity-quota` calls "smart grouping".

## 3. `loadCodeAssist` returns no plan info for these accounts

`planInfo`, `monthlyPromptCredits` and `availablePromptCredits` were all absent
for all three accounts, so prompt-credit percentages are unavailable here too.
`credits` is nullable for the same reason `remainingFraction` is.

## 4. OAuth details confirmed against the reference tool

From `antigravity-usage@0.2.8`:

- Auth: `https://accounts.google.com/o/oauth2/v2/auth`
- Token: `https://oauth2.googleapis.com/token`
- Scopes: `cloud-platform`, `userinfo.email` (we add `openid` so the token
  response carries an id token with a stable `sub`)
- Loopback redirect `http://127.0.0.1:<ephemeral>/callback` works against the
  shipped client id, so the port does not need registering.
- `prompt=consent` is required for a refresh token.
- `cloudaicompanionProject` appears as both a bare string and `{ id }`.

We add PKCE (S256) on top of the reference implementation, which does not use
it. Verified working against the live token endpoint via the `import` path.

## 5. Account id

The reference tool keys accounts by email and never requests `openid`, so it has
no `sub`. We request `openid`, use `sub` when present, and fall back to a SHA-256
hash of the lowercased email so an imported account and a later browser sign-in
of the same Google account resolve to one record instead of two.
