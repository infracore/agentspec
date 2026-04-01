/**
 * Tests for GET /usage — token usage aggregation from the audit ring.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildControlPlaneApp } from '../control-plane/index.js'
import { AuditRing } from '../audit-ring.js'
import { testManifest } from './fixtures.js'

describe('GET /usage', () => {
  let app: FastifyInstance
  let ring: AuditRing

  beforeEach(async () => {
    ring = new AuditRing()
    app = await buildControlPlaneApp(testManifest, ring, { opaUrl: null })
  })

  it('returns 200 with empty totals when ring has no model calls', async () => {
    const res = await app.inject({ method: 'GET', url: '/usage' })
    expect(res.statusCode).toBe(200)

    const body = res.json()
    expect(body.totalTokens).toBe(0)
    expect(body.totalCalls).toBe(0)
    expect(body.models).toEqual([])
    expect(body.sampleSize).toBe(0)
  })

  it('sums tokens across multiple audit entries', async () => {
    ring.push({
      requestId: 'r1',
      timestamp: new Date().toISOString(),
      method: 'POST',
      path: '/chat',
      modelCalls: [{ modelId: 'openai/gpt-4o', tokenCount: 100 }],
    })
    ring.push({
      requestId: 'r2',
      timestamp: new Date().toISOString(),
      method: 'POST',
      path: '/chat',
      modelCalls: [{ modelId: 'openai/gpt-4o', tokenCount: 250 }],
    })

    const res = await app.inject({ method: 'GET', url: '/usage' })
    const body = res.json()

    expect(body.totalTokens).toBe(350)
    expect(body.totalCalls).toBe(2)
    expect(body.models).toHaveLength(1)
    expect(body.models[0]).toEqual({
      modelId: 'openai/gpt-4o',
      totalTokens: 350,
      callCount: 2,
    })
    expect(body.sampleSize).toBe(2)
  })

  it('groups by modelId correctly', async () => {
    ring.push({
      requestId: 'r1',
      timestamp: new Date().toISOString(),
      method: 'POST',
      path: '/chat',
      modelCalls: [
        { modelId: 'openai/gpt-4o', tokenCount: 100 },
        { modelId: 'anthropic/claude-sonnet-4-6', tokenCount: 200 },
      ],
    })
    ring.push({
      requestId: 'r2',
      timestamp: new Date().toISOString(),
      method: 'POST',
      path: '/chat',
      modelCalls: [{ modelId: 'openai/gpt-4o', tokenCount: 50 }],
    })

    const res = await app.inject({ method: 'GET', url: '/usage' })
    const body = res.json()

    expect(body.totalTokens).toBe(350)
    expect(body.totalCalls).toBe(3)
    expect(body.models).toHaveLength(2)

    const gpt = body.models.find((m: { modelId: string }) => m.modelId === 'openai/gpt-4o')
    const claude = body.models.find((m: { modelId: string }) => m.modelId === 'anthropic/claude-sonnet-4-6')

    expect(gpt).toEqual({ modelId: 'openai/gpt-4o', totalTokens: 150, callCount: 2 })
    expect(claude).toEqual({ modelId: 'anthropic/claude-sonnet-4-6', totalTokens: 200, callCount: 1 })
  })

  it('safely skips entries without modelCalls', async () => {
    ring.push({
      requestId: 'r1',
      timestamp: new Date().toISOString(),
      method: 'GET',
      path: '/health',
      // no modelCalls
    })
    ring.push({
      requestId: 'r2',
      timestamp: new Date().toISOString(),
      method: 'POST',
      path: '/chat',
      modelCalls: [{ modelId: 'openai/gpt-4o', tokenCount: 500 }],
    })

    const res = await app.inject({ method: 'GET', url: '/usage' })
    const body = res.json()

    expect(body.totalTokens).toBe(500)
    expect(body.totalCalls).toBe(1)
    expect(body.sampleSize).toBe(2)
  })
})
