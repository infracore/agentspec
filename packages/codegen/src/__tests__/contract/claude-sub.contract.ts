import { vi, beforeEach } from 'vitest'
import { runProviderContractTests } from './provider-contract.js'
import { ClaudeSubscriptionProvider } from '../../providers/claude-sub.js'

const mockQuery = vi.hoisted(() => vi.fn())
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mockQuery }))

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

beforeEach(() => vi.clearAllMocks())

runProviderContractTests(
  'ClaudeSubscriptionProvider',
  () => new ClaudeSubscriptionProvider(),
  makeSuccessStream,
  mockQuery,
)
