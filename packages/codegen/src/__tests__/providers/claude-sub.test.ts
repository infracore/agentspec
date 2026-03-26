import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CodegenError } from '../../provider.js'

const mockQuery = vi.hoisted(() => vi.fn())
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mockQuery }))

import { ClaudeSubscriptionProvider } from '../../providers/claude-sub.js'

async function* makeSuccessStream(text: string) {
  yield {
    type: 'assistant' as const,
    message: { content: [{ type: 'text', text }] },
    parent_tool_use_id: null,
    session_id: 'test',
  }
  yield {
    type: 'result' as const,
    subtype: 'success' as const,
    result: text,
    is_error: false,
    duration_ms: 100,
    duration_api_ms: 90,
    num_turns: 1,
    session_id: 'test',
    total_cost_usd: 0,
    usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    permission_denials: [],
  }
}

async function* makeErrorStream(subtype: 'error_max_turns' | 'error_during_execution') {
  yield {
    type: 'result' as const,
    subtype,
    is_error: true,
    duration_ms: 100,
    duration_api_ms: 90,
    num_turns: 1,
    session_id: 'test',
    total_cost_usd: 0,
    usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    permission_denials: [],
  }
}

beforeEach(() => vi.clearAllMocks())

describe('ClaudeSubscriptionProvider', () => {
  it('has name "claude-subscription"', () => {
    expect(new ClaudeSubscriptionProvider().name).toBe('claude-subscription')
  })

  it('yields delta chunks from assistant messages', async () => {
    mockQuery.mockReturnValue(makeSuccessStream('hello'))
    const chunks = []
    for await (const c of new ClaudeSubscriptionProvider().stream('sys', 'user', {})) {
      chunks.push(c)
    }
    expect(chunks.some((c) => c.type === 'delta')).toBe(true)
  })

  it('yields done chunk with the result', async () => {
    mockQuery.mockReturnValue(makeSuccessStream('final text'))
    const chunks = []
    for await (const c of new ClaudeSubscriptionProvider().stream('sys', 'user', {})) {
      chunks.push(c)
    }
    const done = chunks.find((c) => c.type === 'done')
    expect(done?.result).toBe('final text')
  })

  it('throws CodegenError on error_during_execution', async () => {
    mockQuery.mockReturnValue(makeErrorStream('error_during_execution'))
    await expect(async () => {
      for await (const _ of new ClaudeSubscriptionProvider().stream('sys', 'user', {})) { /* consume */ }
    }).rejects.toBeInstanceOf(CodegenError)
  })

  it('translates quota errors to CodegenError quota_exceeded', async () => {
    mockQuery.mockImplementation(() => { throw new Error('usage limit reached') })
    await expect(async () => {
      for await (const _ of new ClaudeSubscriptionProvider().stream('sys', 'user', {})) { /* consume */ }
    }).rejects.toMatchObject({ code: 'quota_exceeded' })
  })

  it('translates auth errors to CodegenError auth_failed', async () => {
    mockQuery.mockImplementation(() => { throw new Error('not logged in') })
    await expect(async () => {
      for await (const _ of new ClaudeSubscriptionProvider().stream('sys', 'user', {})) { /* consume */ }
    }).rejects.toMatchObject({ code: 'auth_failed' })
  })

  it('passes settingSources:[] and cwd to query()', async () => {
    mockQuery.mockReturnValue(makeSuccessStream('ok'))
    for await (const _ of new ClaudeSubscriptionProvider().stream('sys', 'user', {})) { /* consume */ }
    const [{ options }] = mockQuery.mock.calls[0] as [{ prompt: string; options: Record<string, unknown> }][]
    expect(options['settingSources']).toEqual([])
    expect(typeof options['cwd']).toBe('string')
  })
})
