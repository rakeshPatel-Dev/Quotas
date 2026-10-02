import { z } from 'zod'
import type { ModelFamily, ModelQuota, PromptCredits } from '../../shared/types.js'
import { groupIntoPools, type QuotaPool } from '../../shared/pools.js'
import {
  fetchAvailableModelsSchema,
  loadCodeAssistSchema,
  type FetchAvailableModelsResponse,
  type LoadCodeAssistResponse,
} from './schemas.js'

export type ParsedQuota = {
  planType?: string
  credits: PromptCredits | null
  /** Flat per-model list, as specified in the architecture doc. */
  quota: ModelQuota[]
  /**
   * Models grouped by shared quota state. See FINDINGS.md section 2: Google
   * reports one pool per family, not one pool per model, and every model in a
   * pool repeats the same fraction and reset time. This is what the UI renders.
   */
  pools: QuotaPool[]
}

/** Thrown when the API response no longer matches what we know how to read. */
export class ApiShapeError extends Error {
  constructor(
    readonly raw: unknown,
    message: string,
  ) {
    super(message)
    this.name = 'ApiShapeError'
  }
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/**
 * The API sends `resetTime` as a timestamp string. Anything unparseable, or
 * already in the past, becomes null rather than a bogus countdown.
 */
export function parseResetTime(resetTime: string | undefined, now: number): number | null {
  if (!resetTime) return null
  const parsed = Date.parse(resetTime)
  if (Number.isNaN(parsed)) return null
  return parsed > now ? parsed : null
}

export function classifyFamily(modelId: string, label: string): ModelFamily {
  const haystack = `${modelId} ${label}`.toLowerCase()
  if (haystack.includes('claude')) return 'claude'
  if (haystack.includes('flash')) return 'gemini-flash'
  if (haystack.includes('pro')) return 'gemini-pro'
  return 'other'
}

/**
 * Hides models the dashboard has no use for: internal agent plumbing, image
 * generation, autocomplete-only variants, and anything with no quota attached.
 */
export function isTrackableModel(modelId: string, hasQuotaInfo: boolean): boolean {
  if (!hasQuotaInfo) return false
  if (modelId.startsWith('chat_') || modelId.startsWith('tab_')) return false
  if (modelId.startsWith('rev')) return false
  if (modelId.includes('image')) return false
  if (modelId.includes('mquery') || modelId.includes('lite')) return false
  return true
}

const FAMILY_ORDER: Record<ModelFamily, number> = {
  claude: 0,
  'gemini-pro': 1,
  'gemini-flash': 2,
  other: 3,
}

/**
 * Raw API responses to a normalized snapshot. Validates first, so a response
 * that changed shape raises `ApiShapeError` and leaves the previous quota
 * untouched rather than rendering a wall of empty bars.
 */
export function parseQuota(
  rawCodeAssist: unknown,
  rawModels: unknown,
  now: number = Date.now(),
): ParsedQuota {
  const codeAssist = loadCodeAssistSchema.safeParse(rawCodeAssist)
  if (!codeAssist.success) {
    throw new ApiShapeError(rawCodeAssist, `loadCodeAssist shape changed: ${codeAssist.error.message}`)
  }
  const models = fetchAvailableModelsSchema.safeParse(rawModels)
  if (!models.success) {
    throw new ApiShapeError(rawModels, `fetchAvailableModels shape changed: ${models.error.message}`)
  }

  const quota = parseModels(models.data, now)

  return {
    planType: codeAssist.data.planInfo?.planType,
    credits: parseCredits(codeAssist.data),
    quota,
    pools: groupIntoPools(quota),
  }
}

export function parseCredits(
  response: LoadCodeAssistResponse,
): PromptCredits | null {
  const monthly = response.planInfo?.monthlyPromptCredits
  const available = response.availablePromptCredits
  if (monthly === undefined || available === undefined || monthly <= 0) return null
  return { available, monthly, remainingFraction: clamp01(available / monthly) }
}

export function parseModels(
  response: FetchAvailableModelsResponse,
  now: number,
): ModelQuota[] {
  const entries = Object.entries(response.models ?? {})

  const quota: ModelQuota[] = entries
    .filter(([modelId, info]) => isTrackableModel(modelId, info.quotaInfo !== undefined))
    .map(([modelId, info]) => {
      const label = info.displayName ?? info.label ?? modelId
      const fraction = info.quotaInfo?.remainingFraction
      return {
        modelId,
        label,
        family: classifyFamily(modelId, label),
        remainingFraction: fraction === undefined ? null : clamp01(fraction),
        resetAt: parseResetTime(info.quotaInfo?.resetTime, now),
        isExhausted: info.quotaInfo?.isExhausted ?? fraction === 0,
      }
    })

  quota.sort((a, b) => {
    const family = FAMILY_ORDER[a.family] - FAMILY_ORDER[b.family]
    return family !== 0 ? family : a.label.localeCompare(b.label)
  })

  return quota
}

export { fetchAvailableModelsSchema, groupIntoPools, loadCodeAssistSchema }
export type { QuotaPool }
export type { FetchAvailableModelsResponse, LoadCodeAssistResponse }
