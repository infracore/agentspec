import { vi, beforeEach } from 'vitest'
import { runProviderContractTests } from './provider-contract.js'
import { AnthropicApiProvider } from '../../providers/anthropic-api.js'

const mockStream = vi.hoisted(() => vi.fn())

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { stream: mockStream }
  }
  return { default: MockAnthropic }
})

async function* makeSuccessStream(text: string) {
  yield { type: 'content_block_delta', delta: { type: 'text_delta', text } }
  yield { type: 'message_stop' }
}

beforeEach(() => vi.clearAllMocks())

runProviderContractTests(
  'AnthropicApiProvider',
  () => new AnthropicApiProvider('test-key'),
  makeSuccessStream,
  mockStream,
)
