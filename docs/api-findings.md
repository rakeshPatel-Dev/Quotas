# API findings

Verified against the live Google API on 2026-10-02 using real accounts. These
findings contradict the original architecture document in two places, and both
contradictions changed the UI.

The raw evidence is in `../FINDINGS.md`. This page is the distilled version.

## 1. `remainingFraction` is provisioned per account, not per tier

The original assumption was that quota meters appear only on paid tiers and that
free accounts have nothing to show. That is wrong, or at least not the useful
distinction.

Every account tested was on the same free tier, yet some returned percentages and
some did not. On the accounts that *did* return them, the meters appeared only on
a filtered subset of internal model ids (`chat_*`, `tab_*`) — never on the
user-facing model names in the UI.

This is why the app shows `unmetered` rather than `0%`. An account with no
returned fraction has no quota pool Google is willing to report on; treating that
as zero remaining would be a lie, and it would sort those accounts to the top as
if they were about to break.

If your account has never run a model, it will show no pools at all. That is the
same situation, one step further along.

## 2. Quota is metered per pool, not per model

Models share meters. Several models, sometimes across different families and
tiers, can resolve to one pool with a single `remainingFraction` and a single
reset time.

Two consequences shaped the renderer:

- A naive per-model list would show several identical bars per account, which
  reads as noise or as a bug.
- Pools can mix families, so a label like `Gemini 3 Pro` would be wrong for a pool
  containing Claude models too.

`shared/pools.ts` groups models into pools, and `QuotaPool.families` is an array
for exactly this reason. Labels render as `Claude + GPT-OSS · 3 models` when a
pool spans families. `poolTitle()` in that module owns the formatting.

The low-quota threshold is `LOW_QUOTA_THRESHOLD = 0.05` — 5% remaining. Below
that a bar is yellow; at zero it is red.

## 3. `loadCodeAssist` returns no plan information

The call succeeds for free-tier accounts but returns nothing that identifies a
plan. The UI therefore falls back to a derived label: `Starter quota` when the
account reports meters, `No usage meter` when it does not. This is a guess
labelled as such, not a plan read from Google.

## 4. OAuth details confirmed

Scopes, PKCE parameters and the token exchange match the reference community tool
(`antigravity-usage`). Nothing here needed correcting.

## Debugging this yourself

`scripts/debugQuotaShape.ts` prints the *shape* of a quota response for every
stored account — which keys exist, which models carry fractions, no credentials
or token values:

```bash
npx tsx scripts/debugQuotaShape.ts
```

Use it when an account shows `unmetered` and you want to know whether Google sent
nothing, sent something unparseable, or sent a shape the parser has not seen. If
a Google release changes the response shape, this is the first thing to run.

## Why this is fragile

There is no public Antigravity quota API. `quota/cloudcode.ts` targets
`cloudcode-pa.googleapis.com`, an internal endpoint that can change or disappear
without notice. The responses are undocumented and the model ids in them are
internal strings with no stability guarantee.

When a release breaks it, the likely symptoms are accounts flipping to
`unmetered` or to `Failed` with a schema validation error. See
[troubleshooting.md](troubleshooting.md).