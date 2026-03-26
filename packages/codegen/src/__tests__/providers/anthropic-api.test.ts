import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CodegenError } from '../../provider.js'

// Mock must happen before import of the provider
const mockStream = vi.hoisted(() => vi.fn())

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { stream: mockStream }
  }
  return { default: MockAnthropic }
})

import { AnthropicApiProvider } from '../../providers/anthropic-api.js'

async function* makeTextStream(chunks: string[]) {
  for (const text of chunks) {
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text } }
  }
  yield { type: 'message_stop' }
}

beforeEach(() => vi.clearAllMocks())

describe('AnthropicApiProvider', () => {
  it('has name "anthropic-api"', () => {
    expect(new AnthropicApiProvider('key').name).toBe('anthropic-api')
  })

  it('yields delta chunks with accumulated text', async () => {
    mockStream.mockReturnValue(makeTextStream(['hello', ' world']))
    const chunks = []
    for await (const chunk of new AnthropicApiProvider('test-key').stream('sys', 'user', {})) {
      chunks.push(chunk)
    }
    const deltas = chunks.filter((c) => c.type === 'delta')
    expect(deltas.length).toBeGreaterThan(0)
    expect((deltas[deltas.length - 1]).accumulated).toBe('hello world')
  })

  it('yields done chunk at end with full result', async () => {
    mockStream.mockReturnValue(makeTextStream(['the result']))
    const chunks = []
    for await (const chunk of new AnthropicApiProvider('test-key').stream('sys', 'user', {})) {
      chunks.push(chunk)
    }
    const done = chunks.find((c) => c.type === 'done')
    expect(done?.result).toBe('the result')
  })

  it('throws CodegenError on generic SDK failure', async () => {
    mockStream.mockImplementation(() => { throw new Error('network error') })
    const gen = new AnthropicApiProvider('test-key').stream('sys', 'user', {})
    await expect(async () => {
      for await (const _ of gen) { /* consume */ }
    }).rejects.toBeInstanceOf(CodegenError)
  })
})
