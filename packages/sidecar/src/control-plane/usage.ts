/**
 * GET /usage — aggregate token usage from the audit ring.
 *
 * Scans all entries in the ring buffer, sums modelCalls by modelId,
 * and returns a UsageResponse with per-model and aggregate totals.
 */

import type { FastifyInstance } from 'fastify'
import type { AuditRing, AuditEntry } from '../audit-ring.js'

// ── Types ────────────────────────────────────────────────────────────────────

interface UsageByModel {
  modelId: string
  totalTokens: number
  callCount: number
}

interface UsageResponse {
  models: UsageByModel[]
  totalTokens: number
  totalCalls: number
  sampleSize: number
}

// ── Private helpers ──────────────────────────────────────────────────────────

function aggregateFromRing(entries: AuditEntry[]): UsageResponse {
  const byModel = new Map<string, UsageByModel>()
  let totalTokens = 0
  let totalCalls = 0

  for (const entry of entries) {
    if (!entry.modelCalls) continue
    for (const call of entry.modelCalls) {
      let model = byModel.get(call.modelId)
      if (!model) {
        model = { modelId: call.modelId, totalTokens: 0, callCount: 0 }
        byModel.set(call.modelId, model)
      }
      model.totalTokens += call.tokenCount
      model.callCount += 1
      totalTokens += call.tokenCount
      totalCalls += 1
    }
  }

  return {
    models: [...byModel.values()],
    totalTokens,
    totalCalls,
    sampleSize: entries.length,
  }
}

// ── Route builder ────────────────────────────────────────────────────────────

export async function buildUsageRoutes(
  app: FastifyInstance,
  auditRing: AuditRing,
): Promise<void> {
  app.get('/usage', async (_request, reply) => {
    const entries = auditRing.getAll()
    const usage = aggregateFromRing(entries)
    return reply.code(200).send(usage)
  })
}
