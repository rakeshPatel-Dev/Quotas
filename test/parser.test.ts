import { describe, expect, it } from 'vitest'
import codeAssistFixture from './fixtures/loadCodeAssist.json' with { type: 'json' }
import modelsFixture from './fixtures/fetchAvailableModels.json' with { type: 'json' }
import {
  ApiShapeError,
  classifyFamily,
  isTrackableModel,
  parseQuota,
  parseResetTime,
} from '../src/main/quota/parser.js'
import { extractProjectId } from '../src/main/quota/cloudcode.js'

const NOW = Date.parse('2026-10-02T18:00:00Z')

describe('parseQuota', () => {
  it('normalizes a real response into sorted model quotas', () => {
    const result = parseQuota(codeAssistFixture, modelsFixture, NOW)

    expect(result.planType).toBe('premium')
    expect(result.credits).toEqual({ available: 450, monthly: 500, remainingFraction: 0.9 })
    expect(result.quota.map((q) => q.modelId)).toEqual([
      'claude-opus-4-1-thinking',
      'claude-sonnet-4-5',
      'gemini-3-pro',
      'gemini-3-flash',
    ])
  })

  it('carries remaining fraction and an absolute reset time', () => {
    const sonnet = parseQuota(codeAssistFixture, modelsFixture, NOW).quota.find(
      (q) => q.modelId === 'claude-sonnet-4-5',
    )

    expect(sonnet).toEqual({
      modelId: 'claude-sonnet-4-5',
      label: 'Claude Sonnet 4.5',
      family: 'claude',
      remainingFraction: 0.62,
      resetAt: Date.parse('2026-10-03T04:00:00Z'),
      isExhausted: false,
    })
  })

  it('marks a zero fraction as exhausted even without an explicit flag', () => {
    const flash = parseQuota(codeAssistFixture, modelsFixture, NOW).quota.find(
      (q) => q.modelId === 'gemini-3-flash',
    )
    expect(flash?.isExhausted).toBe(true)
    expect(flash?.remainingFraction).toBe(0)
  })

  it('drops internal, image, lite and quota-less models', () => {
    const ids = parseQuota(codeAssistFixture, modelsFixture, NOW).quota.map((q) => q.modelId)
    for (const dropped of [
      'chat_session_scratch',
      'tab_autocomplete',
      'gemini-2.5-flash-lite',
      'imagen-4-generation',
      'rev-preview-model',
      'gemini-3-pro-noquota',
    ]) {
      expect(ids).not.toContain(dropped)
    }
  })

  it('returns an empty list rather than throwing on an empty response', () => {
    const result = parseQuota({}, {}, NOW)
    expect(result.quota).toEqual([])
    expect(result.credits).toBeNull()
    expect(result.planType).toBeUndefined()
  })

  it('throws ApiShapeError when the response no longer matches', () => {
    expect(() => parseQuota({ planInfo: { monthlyPromptCredits: 'lots' } }, {}, NOW)).toThrow(
      ApiShapeError,
    )
    expect(() => parseQuota({}, { models: 'not-an-object' }, NOW)).toThrow(ApiShapeError)
  })

  it('keeps the raw response on the error so it can be logged locally', () => {
    const raw = { models: 42 }
    try {
      parseQuota({}, raw, NOW)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiShapeError)
      expect((err as ApiShapeError).raw).toEqual(raw)
    }
  })

  it('clamps out-of-range fractions instead of rendering broken bars', () => {
    const { quota } = parseQuota(
      {},
      {
        models: {
          weird: { quotaInfo: { remainingFraction: 1.4 } },
          weirder: { quotaInfo: { remainingFraction: -0.2 } },
        },
      },
      NOW,
    )
    expect(quota[0]?.remainingFraction).toBe(1)
    expect(quota[1]?.remainingFraction).toBe(0)
  })

  it('survives unknown extra fields from a future API version', () => {
    const { quota } = parseQuota(
      { somethingNew: true, planInfo: { planType: 'ultra', extra: 1 } },
      { models: { a: { quotaInfo: { remainingFraction: 0.5 }, newField: 'x' } }, topLevelExtra: 2 },
      NOW,
    )
    expect(quota).toHaveLength(1)
  })
})

describe('parseResetTime', () => {
  it('parses a future timestamp', () => {
    expect(parseResetTime('2026-10-03T04:00:00Z', NOW)).toBe(Date.parse('2026-10-03T04:00:00Z'))
  })

  it('returns null for a past timestamp rather than a negative countdown', () => {
    expect(parseResetTime('2026-10-01T04:00:00Z', NOW)).toBeNull()
  })

  it('returns null for missing or unparseable values', () => {
    expect(parseResetTime(undefined, NOW)).toBeNull()
    expect(parseResetTime('not-a-date', NOW)).toBeNull()
  })
})

describe('classifyFamily', () => {
  it.each([
    ['claude-sonnet-4-5', 'Claude Sonnet 4.5', 'claude'],
    ['gemini-3-pro', 'Gemini 3 Pro', 'gemini-pro'],
    ['gemini-3-flash', 'Gemini 3 Flash', 'gemini-flash'],
    ['gpt-oss', 'GPT OSS', 'other'],
  ])('classifies %s as %s', (modelId, label, expected) => {
    expect(classifyFamily(modelId, label)).toBe(expected)
  })
})

describe('isTrackableModel', () => {
  it('requires quota info', () => {
    expect(isTrackableModel('gemini-3-pro', false)).toBe(false)
    expect(isTrackableModel('gemini-3-pro', true)).toBe(true)
  })
})

describe('extractProjectId', () => {
  it('handles both string and object forms', () => {
    expect(extractProjectId('rising-ember-123')).toBe('rising-ember-123')
    expect(extractProjectId({ id: 'rising-ember-123' })).toBe('rising-ember-123')
    expect(extractProjectId({})).toBeUndefined()
    expect(extractProjectId('')).toBeUndefined()
    expect(extractProjectId(undefined)).toBeUndefined()
  })
})
