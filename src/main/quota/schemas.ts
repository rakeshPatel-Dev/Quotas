import { z } from 'zod'

/**
 * Zod schemas for the Cloud Code internal API.
 *
 * These are deliberately permissive: everything except the fields we actually
 * consume is optional or passed through. If Google renames a field we depend on,
 * validation fails loudly for that account instead of silently producing zeroes.
 */

const projectRef = z.union([z.string(), z.object({ id: z.string().optional() })])

export const loadCodeAssistSchema = z.object({
  codeAssistEnabled: z.boolean().optional(),
  planInfo: z
    .object({
      monthlyPromptCredits: z.number().optional(),
      planType: z.string().optional(),
    })
    .optional(),
  availablePromptCredits: z.number().optional(),
  cloudaicompanionProject: projectRef.optional(),
  currentTier: z.object({ id: z.string().optional() }).optional(),
  paidTier: z.object({ id: z.string().optional() }).optional(),
  allowedTiers: z.array(z.object({ id: z.string().optional(), isDefault: z.boolean().optional() })).optional(),
})

const quotaInfoSchema = z.object({
  remainingFraction: z.number().optional(),
  resetTime: z.string().optional(),
  isExhausted: z.boolean().optional(),
})

const modelInfoSchema = z.object({
  displayName: z.string().optional(),
  label: z.string().optional(),
  model: z.string().optional(),
  modelProvider: z.string().optional(),
  recommended: z.boolean().optional(),
  quotaInfo: quotaInfoSchema.optional(),
})

export const fetchAvailableModelsSchema = z.object({
  models: z.record(z.string(), modelInfoSchema).optional(),
  defaultAgentModelId: z.string().optional(),
})

export const onboardUserSchema = z.object({
  done: z.boolean().optional(),
  response: z.object({ cloudaicompanionProject: projectRef.optional() }).optional(),
})

export type LoadCodeAssistResponse = z.infer<typeof loadCodeAssistSchema>
export type FetchAvailableModelsResponse = z.infer<typeof fetchAvailableModelsSchema>
export type OnboardUserResponse = z.infer<typeof onboardUserSchema>
