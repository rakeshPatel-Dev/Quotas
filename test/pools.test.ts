import { describe, expect, it } from 'vitest'
import meteredFixture from './fixtures/meteredModels.json' with { type: 'json' }
import unmeteredFixture from './fixtures/unmeteredModels.json' with { type: 'json' }
import { parseQuota } from '../src/main/quota/parser.js'
import { groupIntoPools, hasQuotaData, isLowQuota, poolTitle } from '../src/shared/pools.js'
import type { ModelFamily, ModelQuota } from '../src/shared/types.js'

const NOW = Date.parse('2026-10-02T18:00:00Z')

const model = (over: Partial<ModelQuota> & Pick<ModelQuota, 'modelId'>): ModelQuota => ({
  label: over.modelId,
  family: 'other',
  remainingFraction: null,
  resetAt: null,
  isExhausted: false,
  ...over,
})

describe('groupIntoPools', () => {
  it('collapses models that share a fraction and reset time into one pool', () => {
    const { pools, quota } = parseQuota({}, meteredFixture, NOW)

    expect(quota).toHaveLength(6)
    expect(pools).toHaveLength(2)

    const [claude, gemini] = pools
    expect(claude?.remainingFraction).toBeCloseTo(0.5717, 3)
    // Model ids arrive in the sorted quota order: family, then label.
    expect(claude?.modelIds).toEqual([
      'claude-opus-4-6-thinking',
      'claude-sonnet-4-6',
      'gpt-oss-120b-medium',
    ])
    expect(gemini?.remainingFraction).toBe(1)
    expect(gemini?.modelIds).toHaveLength(3)
  })

  it('merges across float noise in the reported fraction', () => {
    // gpt-oss reports 0.5716971 where Claude reports 0.571697; same pool.
    const pools = groupIntoPools([
      model({ modelId: 'a', remainingFraction: 0.571697, resetAt: 1 }),
      model({ modelId: 'b', remainingFraction: 0.5716971, resetAt: 1 }),
    ])
    expect(pools).toHaveLength(1)
  })

  it('keeps pools with the same fraction but different reset times apart', () => {
    const pools = groupIntoPools([
      model({ modelId: 'a', remainingFraction: 1, resetAt: 100 }),
      model({ modelId: 'b', remainingFraction: 1, resetAt: 200 }),
    ])
    expect(pools).toHaveLength(2)
  })

  it('keeps pools with the same reset time but different fractions apart', () => {
    const pools = groupIntoPools([
      model({ modelId: 'a', remainingFraction: 0.2, resetAt: 100 }),
      model({ modelId: 'b', remainingFraction: 0.8, resetAt: 100 }),
    ])
    expect(pools).toHaveLength(2)
  })

  it('lists a duplicate display name once per pool', () => {
    const pools = groupIntoPools([
      model({ modelId: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro', remainingFraction: 1 }),
      model({ modelId: 'gemini-3.1-pro-low', label: 'Gemini 3.1 Pro', remainingFraction: 1 }),
    ])
    expect(pools[0]?.labels).toEqual(['Gemini 3.1 Pro'])
    expect(pools[0]?.modelIds).toHaveLength(2)
  })

  it('sorts emptiest pools first and reset-only pools last', () => {
    const pools = groupIntoPools([
      model({ modelId: 'full', remainingFraction: 1, resetAt: 100 }),
      model({ modelId: 'empty', remainingFraction: 0, resetAt: 100 }),
      model({ modelId: 'half', remainingFraction: 0.5, resetAt: 100 }),
      model({ modelId: 'unknown', remainingFraction: null, resetAt: 200 }),
    ])
    expect(pools.map((p) => p.modelIds[0])).toEqual(['empty', 'half', 'full', 'unknown'])
  })

  it('never merges a model with no fraction into one that has a fraction', () => {
    const pools = groupIntoPools([
      model({ modelId: 'metered', remainingFraction: 1, resetAt: 100 }),
      model({ modelId: 'unmetered', remainingFraction: null, resetAt: 100 }),
    ])
    expect(pools).toHaveLength(2)
  })

  it('returns nothing for an empty model list', () => {
    expect(groupIntoPools([])).toEqual([])
  })

  it('collapses an account with no metered quota into one reset-only pool per reset time', () => {
    // This is what the live API actually returns for two of the three test
    // accounts: resetTime present, remainingFraction absent (see FINDINGS.md).
    const { pools, quota } = parseQuota({}, unmeteredFixture, NOW)

    expect(pools.every((pool) => pool.remainingFraction === null)).toBe(true)
    expect(pools).toHaveLength(2)

    const [claude, gemini] = pools
    expect(claude?.modelIds).toEqual([
      'claude-opus-4-6-thinking',
      'claude-sonnet-4-6',
      'gpt-oss-120b-medium',
    ])
    expect(claude?.resetAt).toBe(Date.parse('2026-10-09T05:50:03Z'))
    expect(gemini?.modelIds).toEqual([
      'gemini-3.1-pro-high',
      'gemini-3-flash',
    ])

    // Every tracked model lands in exactly one pool, and internal models that
    // do carry a fraction are still filtered out.
    expect(pools.reduce((sum, pool) => sum + pool.modelIds.length, 0)).toBe(quota.length)
    expect(quota.map((q) => q.modelId)).not.toContain('chat_20706')
    expect(quota.map((q) => q.modelId)).not.toContain('tab_flash_lite_preview')
    expect(quota.map((q) => q.modelId)).not.toContain('gemini-3.1-flash-image')
  })
})

describe('pool metadata', () => {
  const model = (
    modelId: string,
    label: string,
    family: ModelFamily,
    remainingFraction: number | null,
    resetAt: number | null,
  ): ModelQuota => ({ modelId, label, family, remainingFraction, resetAt, isExhausted: remainingFraction === 0 })

  it('a pool keeps every family it meters instead of degrading to "other"', () => {
    const pools = groupIntoPools([
      model('claude-opus', 'Claude Opus', 'claude', 0.5, 1000),
      model('gpt-oss', 'GPT-OSS 120B', 'other', 0.5, 1000),
    ])

    expect(pools).toHaveLength(1)
    expect(pools[0]!.families).toEqual(['claude', 'other'])
  })

  it('gemini pro and flash collapse to one Gemini token in the title', () => {
    const pools = groupIntoPools([
      model('gemini-pro', 'Gemini 2.5 Pro', 'gemini-pro', 1, 1000),
      model('gemini-flash', 'Gemini 2.5 Flash', 'gemini-flash', 1, 1000),
    ])

    expect(poolTitle(pools[0]!)).toBe('Gemini · 2 models')
  })

  it('title names both families when a pool spans them', () => {
    const [pool] = groupIntoPools([
      model('claude-opus', 'Claude Opus', 'claude', 1, 1000),
      model('gemini-pro', 'Gemini 2.5 Pro', 'gemini-pro', 1, 1000),
      model('gemini-flash', 'Gemini 2.5 Flash', 'gemini-flash', 1, 1000),
      model('x', 'X', 'other', 1, 1000),
      model('y', 'Y', 'other', 1, 1000),
      model('z', 'Z', 'other', 1, 1000),
    ])
    expect(poolTitle(pool!)).toBe('Claude + Gemini + X · 6 models')
  })

  it('names an unrecognised model from its own label', () => {
    const [pool] = groupIntoPools([
      model('claude-opus', 'Claude Opus 4.6 (Thinking)', 'claude', 0.57, 1000),
      model('gpt-oss', 'GPT-OSS 120B (Medium)', 'other', 0.57, 1000),
    ])
    expect(poolTitle(pool!)).toBe('Claude + GPT-OSS · 2 models')
  })

  it('a single-family pool is labelled by that family', () => {
    const [pool] = groupIntoPools([model('m', 'Gemini 2.5 Flash', 'gemini-flash', 1, 1000)])
    expect(poolTitle(pool!)).toBe('Gemini Flash')
  })

  it('hasQuotaData is false when no pool reports a fraction', () => {
    const pools = groupIntoPools([model('claude-opus', 'Claude Opus', 'claude', null, 1000)])
    expect(hasQuotaData(pools)).toBe(false)
  })

  it('isLowQuota ignores reset-only pools and fires at the threshold', () => {
    const resetOnly = groupIntoPools([model('m', 'M', 'claude', null, 1000)])
    expect(isLowQuota(resetOnly)).toBe(false)

    const exact = groupIntoPools([model('m', 'M', 'claude', 0.05, 1000)])
    expect(isLowQuota(exact)).toBe(true)

    const healthy = groupIntoPools([model('m', 'M', 'claude', 0.06, 1000)])
    expect(isLowQuota(healthy)).toBe(false)
  })
})
