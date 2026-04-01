import { describe, it, expect, beforeEach } from 'vitest'
import { UsageLedger } from '../agent/usage-ledger.js'
import type { UsageSnapshot, ModelUsageEntry } from '../agent/usage-ledger.js'

describe('UsageLedger', () => {
  let ledger: UsageLedger

  beforeEach(() => {
    ledger = new UsageLedger()
  })

  // ── record() ─────────────────────────────────────────────────────────────────

  it('accumulates tokens for the same model across multiple calls', () => {
    ledger.record('openai/gpt-4o', 100, 50)
    ledger.record('openai/gpt-4o', 200, 80)

    const snap = ledger.snapshot(false)
    expect(snap.models).toHaveLength(1)
    expect(snap.models[0]).toEqual<ModelUsageEntry>({
      modelId: 'openai/gpt-4o',
      promptTokens: 300,
      completionTokens: 130,
      totalTokens: 430,
      callCount: 2,
    })
  })

  it('tracks multiple models independently', () => {
    ledger.record('openai/gpt-4o', 100, 50)
    ledger.record('anthropic/claude-sonnet-4-6', 200, 80)
    ledger.record('openai/gpt-4o', 50, 20)

    const snap = ledger.snapshot(false)
    expect(snap.models).toHaveLength(2)

    const gpt = snap.models.find((m) => m.modelId === 'openai/gpt-4o')
    const claude = snap.models.find((m) => m.modelId === 'anthropic/claude-sonnet-4-6')

    expect(gpt).toEqual<ModelUsageEntry>({
      modelId: 'openai/gpt-4o',
      promptTokens: 150,
      completionTokens: 70,
      totalTokens: 220,
      callCount: 2,
    })
    expect(claude).toEqual<ModelUsageEntry>({
      modelId: 'anthropic/claude-sonnet-4-6',
      promptTokens: 200,
      completionTokens: 80,
      totalTokens: 280,
      callCount: 1,
    })
  })

  // ── snapshot() ────────────────────────────────────────────────────────────────

  it('returns correct aggregate totals', () => {
    ledger.record('openai/gpt-4o', 100, 50)
    ledger.record('anthropic/claude-sonnet-4-6', 200, 80)

    const snap = ledger.snapshot(false)
    expect(snap.totalTokens).toBe(430)
    expect(snap.totalCalls).toBe(2)
  })

  it('resets counters when snapshot(true) is called', () => {
    ledger.record('openai/gpt-4o', 100, 50)

    const first = ledger.snapshot(true)
    expect(first.totalTokens).toBe(150)
    expect(first.totalCalls).toBe(1)

    const second = ledger.snapshot(false)
    expect(second.models).toHaveLength(0)
    expect(second.totalTokens).toBe(0)
    expect(second.totalCalls).toBe(0)
  })

  it('does NOT reset counters when snapshot(false) is called', () => {
    ledger.record('openai/gpt-4o', 100, 50)

    ledger.snapshot(false)

    const snap = ledger.snapshot(false)
    expect(snap.totalTokens).toBe(150)
    expect(snap.totalCalls).toBe(1)
  })

  it('resets windowStartedAt after snapshot(true)', () => {
    const snap1 = ledger.snapshot(false)
    const window1 = snap1.windowStartedAt

    // Force a reset
    ledger.record('openai/gpt-4o', 10, 5)
    ledger.snapshot(true)

    // New window should have a >= timestamp
    const snap2 = ledger.snapshot(false)
    expect(new Date(snap2.windowStartedAt).getTime())
      .toBeGreaterThanOrEqual(new Date(window1).getTime())
  })

  it('returns empty snapshot when no calls have been recorded', () => {
    const snap = ledger.snapshot(false)

    expect(snap).toEqual<UsageSnapshot>({
      windowStartedAt: expect.any(String),
      models: [],
      totalTokens: 0,
      totalCalls: 0,
    })
  })

  it('defaults reset to true', () => {
    ledger.record('openai/gpt-4o', 100, 50)

    // Default parameter — should reset
    ledger.snapshot()

    const snap = ledger.snapshot(false)
    expect(snap.totalTokens).toBe(0)
  })

  it('windowStartedAt is a valid ISO-8601 string', () => {
    const snap = ledger.snapshot(false)
    expect(() => new Date(snap.windowStartedAt)).not.toThrow()
    expect(new Date(snap.windowStartedAt).toISOString()).toBe(snap.windowStartedAt)
  })
})
