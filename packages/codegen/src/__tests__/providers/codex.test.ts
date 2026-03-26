import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CodegenError, type CodegenChunk } from '../../provider.js'

const mockStream = vi.hoisted(() => vi.fn())

vi.mock('openai', () => {
  class MockOpenAI {
    beta = { chat: { completions: { stream: mockStream } } }
  }
  return { default: MockOpenAI }
})

import { CodexProvider } from '../../providers/codex.js'

// OpenAI stream is an async iterable with a finalChatCompletion() method
function makeOpenAIStream(chunks: string[]) {
  async function* gen() {
    for (const content of chunks) {
      yield { choices: [{ delta: { content } }] }
    }
  }
  const iter = gen()
  return Object.assign(iter, {
    finalChatCompletion: async () => ({
      choices: [{ message: { content: chunks.join('') } }],
    }),
  })
}

beforeEach(() => vi.clearAllMocks())

describe('CodexProvider', () => {
  it('has name "codex"', () => {
    expect(new CodexProvider('key').name).toBe('codex')
  })

  it('yields delta chunks', async () => {
    mockStream.mockReturnValue(makeOpenAIStream(['hello', ' world']))
    const chunks = []
    for await (const c of new CodexProvider('test-key').stream('sys', 'user', {})) {
      chunks.push(c)
    }
    expect(chunks.some((c) => c.type === 'delta')).toBe(true)
  })

  it('yields done chunk with full accumulated text', async () => {
    mockStream.mockReturnValue(makeOpenAIStream(['hello', ' world']))
    const chunks: CodegenChunk[] = []
    for await (const c of new CodexProvider('test-key').stream('sys', 'user', {})) {
      chunks.push(c)
    }
    const done = chunks.find((c): c is CodegenChunk & { type: 'done' } => c.type === 'done')
    expect(done?.result).toBe('hello world')
  })

  it('throws CodegenError on failure', async () => {
    mockStream.mockImplementation(() => { throw new Error('openai error') })
    await expect(async () => {
      for await (const _ of new CodexProvider('key').stream('sys', 'user', {})) { /* consume */ }
    }).rejects.toBeInstanceOf(CodegenError)
  })
})
