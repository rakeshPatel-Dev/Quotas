import type { ModelFamily, ModelQuota } from './types.js'

/**
 * Models that share a quota pool, collapsed into one row.
 *
 * Google meters quota per pool, not per model: every model in a pool reports an
 * identical remaining fraction and reset time. Rendering one bar per model would
 * be mostly duplicates. See FINDINGS.md section 2.
 */
export type QuotaPool = {
  /** Stable identity for the pool within one account. */
  key: string
  modelIds: string[]
  labels: string[]
  /**
   * Distinct families present in the pool. A pool is a meter, not a model list,
   * so it legitimately mixes families (Claude + GPT-OSS on one plan, Gemini Pro
   * + Flash on another). Keeping the set avoids collapsing both to 'other'.
   */
  families: ModelFamily[]
  /** null means Google reported no remaining-quota number for this pool. */
  remainingFraction: number | null
  /** UTC epoch ms, or null when no usable reset time was reported. */
  resetAt: number | null
  isExhausted: boolean
}

/**
 * Groups models into pools by `(remainingFraction, resetAt)`.
 *
 * Fractions are rounded to whole percent before grouping so float noise across a
 * pool does not split it into several near-identical rows.
 */
export function groupIntoPools(quota: ModelQuota[]): QuotaPool[] {
  const pools = new Map<string, QuotaPool>()

  for (const model of quota) {
    const fraction = model.remainingFraction
    const key = `${fraction === null ? 'none' : Math.round(fraction * 100)}|${model.resetAt ?? 'none'}`
    const existing = pools.get(key)

    if (existing) {
      existing.modelIds.push(model.modelId)
      // Distinct model ids can share a display name; showing it twice on a pool
      // row adds nothing.
      if (!existing.labels.includes(model.label)) existing.labels.push(model.label)
      if (!existing.families.includes(model.family)) existing.families.push(model.family)
      continue
    }

    pools.set(key, {
      key,
      modelIds: [model.modelId],
      labels: [model.label],
      families: [model.family],
      remainingFraction: fraction,
      resetAt: model.resetAt,
      isExhausted: model.isExhausted,
    })
  }

  return [...pools.values()].sort((a, b) => {
    // Pools with a known fraction first, emptiest first; reset-only pools last.
    if (a.remainingFraction === null && b.remainingFraction !== null) return 1
    if (b.remainingFraction === null && a.remainingFraction !== null) return -1
    if (a.remainingFraction !== b.remainingFraction) {
      return (a.remainingFraction ?? 0) - (b.remainingFraction ?? 0)
    }
    return (a.resetAt ?? Infinity) - (b.resetAt ?? Infinity)
  })
}

/** Fraction below which a pool counts as low. */
export const LOW_QUOTA_THRESHOLD = 0.05

/** True when any pool on the account is empty or nearly empty. */
export function isLowQuota(pools: QuotaPool[]): boolean {
  return pools.some(
    (pool) => pool.remainingFraction !== null && pool.remainingFraction <= LOW_QUOTA_THRESHOLD,
  )
}

/** True when at least one pool reports an actual remaining-quota number. */
export function hasQuotaData(pools: QuotaPool[]): boolean {
  return pools.some((pool) => pool.remainingFraction !== null)
}

/* ------------------------------------------------------------------ */
/* Pool presentation labels. Live here rather than in the renderer so the CLI
   and the UI name pools identically. */

const FAMILY_LABEL: Record<ModelFamily, string> = {
  claude: 'Claude',
  'gemini-pro': 'Gemini Pro',
  'gemini-flash': 'Gemini Flash',
  other: 'Other models',
}

/** Gemini Pro and Flash are both just "Gemini" once a pool mixes them. */
const FAMILY_TOKEN: Record<ModelFamily, string> = {
  claude: 'Claude',
  'gemini-pro': 'Gemini',
  'gemini-flash': 'Gemini',
  other: 'Other',
}

/** Substrings that mean a family already has a better name than "Other". */
const FAMILY_KEYWORDS = ['claude', 'gemini', 'flash', 'pro']

/**
 * Names the unrecognised models in a pool from their own labels, so a mixed
 * pool reads "Claude + GPT-OSS" rather than the vague "Claude + Other".
 */
function otherToken(labels: string[]): string {
  for (const label of labels) {
    const head = label.split(/[\s(]/)[0]
    if (!head) continue
    const lower = head.toLowerCase()
    if (FAMILY_KEYWORDS.some((keyword) => lower.includes(keyword))) continue
    return head
  }
  return 'Other'
}

/**
 * Pool title. Pool rows are named by the families they meter, not by the model
 * names inside them, so a single-family label stays specific ("Gemini Flash")
 * while a mixed pool lists both ("Claude + GPT-OSS").
 */
export function poolTitle(pool: QuotaPool): string {
  const count = pool.modelIds.length
  const families = [...new Set(pool.families)]

  let base: string
  if (families.length === 1) {
    base = FAMILY_LABEL[families[0] as ModelFamily]
  } else {
    // There are only four families, so every token fits without truncating.
    const tokens = [...new Set(families.map((f) => (f === 'other' ? otherToken(pool.labels) : FAMILY_TOKEN[f])))]
    base = tokens.join(' + ')
  }

  return count > 1 ? `${base} · ${count} models` : base
}
