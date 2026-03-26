import { execFileSync } from 'node:child_process'
import { CodegenError, type CodegenProvider } from './provider.js'
import { AnthropicApiProvider } from './providers/anthropic-api.js'
import { ClaudeSubscriptionProvider } from './providers/claude-sub.js'
import { CodexProvider } from './providers/codex.js'

function isClaudeCliAuthenticated(): boolean {
  try {
    const raw = execFileSync('claude', ['auth', 'status'], {
      stdio: 'pipe',
      timeout: 4000,
      windowsHide: true,
      encoding: 'utf-8',
    })
    const lower = (typeof raw === 'string' ? raw : '').toLowerCase()
    if (lower.includes('not logged in') || lower.includes('login required')) return false
    return true
  } catch {
    return false
  }
}

export function resolveProvider(override?: string): CodegenProvider {
  const mode = override ?? process.env['AGENTSPEC_CODEGEN_PROVIDER'] ?? 'auto'

  if (mode === 'claude-sub' || mode === 'claude-subscription') {
    return new ClaudeSubscriptionProvider()
  }

  if (mode === 'anthropic-api') {
    const apiKey = process.env['ANTHROPIC_API_KEY']
    if (!apiKey) throw new CodegenError('auth_failed', 'ANTHROPIC_API_KEY is not set')
    return new AnthropicApiProvider(apiKey, process.env['ANTHROPIC_BASE_URL'])
  }

  if (mode === 'codex') {
    const apiKey = process.env['OPENAI_API_KEY']
    if (!apiKey) throw new CodegenError('auth_failed', 'OPENAI_API_KEY is not set')
    return new CodexProvider(apiKey)
  }

  // auto: probe in priority order
  if (isClaudeCliAuthenticated()) return new ClaudeSubscriptionProvider()

  const anthropicKey = process.env['ANTHROPIC_API_KEY']
  if (anthropicKey)
    return new AnthropicApiProvider(anthropicKey, process.env['ANTHROPIC_BASE_URL'])

  const openaiKey = process.env['OPENAI_API_KEY']
  if (openaiKey) return new CodexProvider(openaiKey)

  throw new CodegenError(
    'provider_unavailable',
    'No codegen provider available.\n' +
      'Options:\n' +
      '  1. Authenticate Claude CLI: claude auth login\n' +
      '  2. Set ANTHROPIC_API_KEY\n' +
      '  3. Set OPENAI_API_KEY',
  )
}
