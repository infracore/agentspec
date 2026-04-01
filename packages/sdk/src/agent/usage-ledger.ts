/** In-process token usage counter — aggregates LLM call tokens between heartbeat pushes. */

// ── Types (exported) ─────────────────────────────────────────────────────────

export interface ModelUsageEntry {
  modelId: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  callCount: number
}

export interface UsageSnapshot {
  windowStartedAt: string
  models: ModelUsageEntry[]
  totalTokens: number
  totalCalls: number
}

// ── Private helpers ──────────────────────────────────────────────────────────

function createEmptyEntry(modelId: string): ModelUsageEntry {
  return { modelId, promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 }
}

function buildSnapshot(
  counters: Map<string, ModelUsageEntry>,
  windowStart: Date,
): UsageSnapshot {
  // Shallow-copy each entry to avoid exposing mutable internal state
  const models = [...counters.values()].map((e) => ({ ...e }))
  let totalTokens = 0
  let totalCalls = 0
  for (const m of models) {
    totalTokens += m.totalTokens
    totalCalls += m.callCount
  }
  return {
    windowStartedAt: windowStart.toISOString(),
    models,
    totalTokens,
    totalCalls,
  }
}

// ── Public class ─────────────────────────────────────────────────────────────

export class UsageLedger {
  private counters = new Map<string, ModelUsageEntry>()
  private windowStart = new Date()

  /**
   * Record token usage for a single LLM call.
   * Call this once per LLM invocation with the model ID and token counts.
   */
  record(modelId: string, promptTokens: number, completionTokens: number): void {
    const p = Math.max(0, promptTokens)
    const c = Math.max(0, completionTokens)
    let entry = this.counters.get(modelId)
    if (!entry) {
      entry = createEmptyEntry(modelId)
      this.counters.set(modelId, entry)
    }
    entry.promptTokens += p
    entry.completionTokens += c
    entry.totalTokens += p + c
    entry.callCount += 1
  }

  /**
   * Return a frozen snapshot of the current usage window.
   *
   * @param reset - When true (default), clears all counters and starts a new
   *   window. Use reset=true in the heartbeat push so each window is shipped
   *   exactly once. Use reset=false for inspection without draining.
   */
  snapshot(reset = true): UsageSnapshot {
    const snap = buildSnapshot(this.counters, this.windowStart)
    if (reset) {
      this.counters = new Map()
      this.windowStart = new Date()
    }
    return snap
  }
}
