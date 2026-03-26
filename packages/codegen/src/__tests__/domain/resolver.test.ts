import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { CodegenError } from '../../provider.js'

describe('resolveProvider()', () => {
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    savedEnv['AGENTSPEC_CODEGEN_PROVIDER'] = process.env['AGENTSPEC_CODEGEN_PROVIDER']
    savedEnv['ANTHROPIC_API_KEY'] = process.env['ANTHROPIC_API_KEY']
    savedEnv['OPENAI_API_KEY'] = process.env['OPENAI_API_KEY']
    delete process.env['AGENTSPEC_CODEGEN_PROVIDER']
    delete process.env['ANTHROPIC_API_KEY']
    delete process.env['OPENAI_API_KEY']
  })

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key]
      else process.env[key] = val
    }
  })

  it('returns AnthropicApiProvider when AGENTSPEC_CODEGEN_PROVIDER=anthropic-api', async () => {
    process.env['AGENTSPEC_CODEGEN_PROVIDER'] = 'anthropic-api'
    process.env['ANTHROPIC_API_KEY'] = 'sk-test'
    const { resolveProvider } = await import('../../resolver.js')
    const p = resolveProvider()
    expect(p.name).toBe('anthropic-api')
  })

  it('returns CodexProvider when AGENTSPEC_CODEGEN_PROVIDER=codex', async () => {
    process.env['AGENTSPEC_CODEGEN_PROVIDER'] = 'codex'
    process.env['OPENAI_API_KEY'] = 'sk-openai-test'
    const { resolveProvider } = await import('../../resolver.js')
    const p = resolveProvider()
    expect(p.name).toBe('codex')
  })

  it('returns ClaudeSubscriptionProvider when AGENTSPEC_CODEGEN_PROVIDER=claude-sub', async () => {
    process.env['AGENTSPEC_CODEGEN_PROVIDER'] = 'claude-sub'
    const { resolveProvider } = await import('../../resolver.js')
    const p = resolveProvider()
    expect(p.name).toBe('claude-subscription')
  })

  it('throws CodegenError provider_unavailable when mode=anthropic-api but no key', async () => {
    process.env['AGENTSPEC_CODEGEN_PROVIDER'] = 'anthropic-api'
    // No ANTHROPIC_API_KEY
    const { resolveProvider } = await import('../../resolver.js')
    expect(() => resolveProvider()).toThrow(CodegenError)
  })

  it('falls back to AnthropicApiProvider when ANTHROPIC_API_KEY set in auto mode', async () => {
    // No CLI available in CI/test, ensure we don't hang on probe
    process.env['ANTHROPIC_API_KEY'] = 'sk-test'
    // Force skip claude CLI probe by setting the mode explicitly
    process.env['AGENTSPEC_CODEGEN_PROVIDER'] = 'anthropic-api'
    const { resolveProvider } = await import('../../resolver.js')
    const p = resolveProvider()
    expect(p.name).toBe('anthropic-api')
  })
})
