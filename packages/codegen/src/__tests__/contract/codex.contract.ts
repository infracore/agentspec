import { vi, beforeEach } from 'vitest'
import { runProviderContractTests } from './provider-contract.js'
import { CodexProvider } from '../../providers/codex.js'

const mockStream = vi.hoisted(() => vi.fn())

vi.mock('openai', () => {
  class MockOpenAI {
    beta = { chat: { completions: { stream: mockStream } } }
  }
  return { default: MockOpenAI }
})

function makeOpenAIStream(text: string) {
  async function* gen() {
    yield { choices: [{ delta: { content: text } }] }
  }
  return Object.assign(gen(), {
    finalChatCompletion: async () => ({ choices: [{ message: { content: text } }] }),
  })
}

beforeEach(() => vi.clearAllMocks())

runProviderContractTests(
  'CodexProvider',
  () => new CodexProvider('test-key'),
  (text: string) => makeOpenAIStream(text) as any,
  mockStream,
)
