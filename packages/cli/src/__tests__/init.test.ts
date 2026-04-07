/**
 * Unit tests for init-helpers.ts — all pure function tests, no mocking needed.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  PROVIDER_DEFAULTS,
  PROVIDER_ENV_KEYS,
  generateManifest,
  collectRequiredEnvVars,
  generateSystemPrompt,
  generateEnvExample,
  fetchAvailableModels,
  type InitOptions,
} from '../commands/init-helpers.js'

// ── Test helpers ─────────────────────────────────────────────────────────────

function baseOpts(overrides: Partial<InitOptions> = {}): InitOptions {
  return {
    name: 'test-agent',
    description: 'A test agent',
    version: '0.1.0',
    provider: 'openai',
    modelId: 'gpt-4o-mini',
    includeMemory: false,
    includeApi: false,
    includeObservability: false,
    includeGuardrails: false,
    includeEval: false,
    includeToolsStarter: false,
    ...overrides,
  }
}

// ── PROVIDER_DEFAULTS ────────────────────────────────────────────────────────

describe('PROVIDER_DEFAULTS', () => {
  it('maps openai to gpt-4o-mini', () => {
    expect(PROVIDER_DEFAULTS.openai).toBe('gpt-4o-mini')
  })

  it('maps anthropic to claude-sonnet-4-6', () => {
    expect(PROVIDER_DEFAULTS.anthropic).toBe('claude-sonnet-4-6')
  })

  it('maps groq to llama-3.3-70b-versatile', () => {
    expect(PROVIDER_DEFAULTS.groq).toBe('llama-3.3-70b-versatile')
  })

  it('maps google to gemini-2.0-flash', () => {
    expect(PROVIDER_DEFAULTS.google).toBe('gemini-2.0-flash')
  })

  it('maps mistral to mistral-large-latest', () => {
    expect(PROVIDER_DEFAULTS.mistral).toBe('mistral-large-latest')
  })

  it('maps azure to gpt-4o', () => {
    expect(PROVIDER_DEFAULTS.azure).toBe('gpt-4o')
  })
})

// ── PROVIDER_ENV_KEYS ────────────────────────────────────────────────────────

describe('PROVIDER_ENV_KEYS', () => {
  it('maps openai to OPENAI_API_KEY', () => {
    expect(PROVIDER_ENV_KEYS.openai).toBe('OPENAI_API_KEY')
  })

  it('maps anthropic to ANTHROPIC_API_KEY', () => {
    expect(PROVIDER_ENV_KEYS.anthropic).toBe('ANTHROPIC_API_KEY')
  })

  it('maps groq to GROQ_API_KEY', () => {
    expect(PROVIDER_ENV_KEYS.groq).toBe('GROQ_API_KEY')
  })

  it('maps google to GOOGLE_API_KEY', () => {
    expect(PROVIDER_ENV_KEYS.google).toBe('GOOGLE_API_KEY')
  })

  it('maps mistral to MISTRAL_API_KEY', () => {
    expect(PROVIDER_ENV_KEYS.mistral).toBe('MISTRAL_API_KEY')
  })

  it('maps azure to AZURE_OPENAI_API_KEY', () => {
    expect(PROVIDER_ENV_KEYS.azure).toBe('AZURE_OPENAI_API_KEY')
  })
})

// ── generateManifest — always-present sections ──────────────────────────────

describe('generateManifest — always-present sections', () => {
  const yaml = generateManifest(baseOpts())

  it('includes apiVersion header', () => {
    expect(yaml).toContain('apiVersion: agentspec.io/v1')
  })

  it('includes kind AgentSpec', () => {
    expect(yaml).toContain('kind: AgentSpec')
  })

  it('includes metadata section', () => {
    expect(yaml).toContain('metadata:')
    expect(yaml).toContain('name: test-agent')
  })

  it('includes model section', () => {
    expect(yaml).toContain('model:')
    expect(yaml).toContain('provider: openai')
  })

  it('includes prompts section', () => {
    expect(yaml).toContain('prompts:')
    expect(yaml).toContain('$file:prompts/system.md')
  })

  it('includes compliance and requires sections', () => {
    expect(yaml).toContain('compliance:')
    expect(yaml).toContain('requires:')
  })
})

// ── generateManifest — conditional sections ─────────────────────────────────

describe('generateManifest — conditional sections', () => {
  it('excludes memory when includeMemory is false', () => {
    const yaml = generateManifest(baseOpts({ includeMemory: false }))
    expect(yaml).not.toMatch(/^\s+memory:/m)
  })

  it('includes memory when includeMemory is true', () => {
    const yaml = generateManifest(baseOpts({ includeMemory: true, memoryBackend: 'in-memory' }))
    expect(yaml).toContain('memory:')
  })

  it('excludes api when includeApi is false', () => {
    const yaml = generateManifest(baseOpts({ includeApi: false }))
    expect(yaml).not.toMatch(/^\s+api:/m)
  })

  it('includes api when includeApi is true', () => {
    const yaml = generateManifest(baseOpts({ includeApi: true, apiType: 'rest' }))
    expect(yaml).toContain('api:')
  })

  it('excludes observability when includeObservability is false', () => {
    const yaml = generateManifest(baseOpts({ includeObservability: false }))
    expect(yaml).not.toContain('observability:')
  })

  it('includes observability when includeObservability is true', () => {
    const yaml = generateManifest(
      baseOpts({ includeObservability: true, tracingBackend: 'langfuse' }),
    )
    expect(yaml).toContain('observability:')
  })
})

// ── generateManifest — model section ────────────────────────────────────────

describe('generateManifest — model section', () => {
  it('uses the specified provider', () => {
    const yaml = generateManifest(baseOpts({ provider: 'anthropic', modelId: 'claude-sonnet-4-6' }))
    expect(yaml).toContain('provider: anthropic')
  })

  it('uses the specified model ID', () => {
    const yaml = generateManifest(baseOpts({ modelId: 'gpt-4o' }))
    expect(yaml).toContain('id: gpt-4o')
  })

  it('references the correct env var for apiKey', () => {
    const yaml = generateManifest(baseOpts({ provider: 'anthropic' }))
    expect(yaml).toContain('$env:ANTHROPIC_API_KEY')
  })

  it('includes temperature and maxTokens parameters', () => {
    const yaml = generateManifest(baseOpts())
    expect(yaml).toContain('temperature: 0.7')
    expect(yaml).toContain('maxTokens: 2000')
  })
})

// ── generateManifest — tools section ────────────────────────────────────────

describe('generateManifest — tools section', () => {
  it('shows commented-out tools when includeToolsStarter is false', () => {
    const yaml = generateManifest(baseOpts({ includeToolsStarter: false }))
    expect(yaml).toContain('# tools:')
  })

  it('shows uncommented tools section when includeToolsStarter is true', () => {
    const yaml = generateManifest(baseOpts({ includeToolsStarter: true }))
    expect(yaml).toMatch(/^\s+tools:/m)
    expect(yaml).toContain('name: my-tool')
  })
})

// ── generateManifest — memory backends ──────────────────────────────────────

describe('generateManifest — memory backends', () => {
  it('generates in-memory backend without connection line', () => {
    const yaml = generateManifest(baseOpts({ includeMemory: true, memoryBackend: 'in-memory' }))
    expect(yaml).toContain('backend: in-memory')
    expect(yaml).not.toContain('connection:')
  })

  it('generates redis backend with REDIS_URL connection', () => {
    const yaml = generateManifest(baseOpts({ includeMemory: true, memoryBackend: 'redis' }))
    expect(yaml).toContain('backend: redis')
    expect(yaml).toContain('connection: $env:REDIS_URL')
  })

  it('generates sqlite backend with file connection', () => {
    const yaml = generateManifest(baseOpts({ includeMemory: true, memoryBackend: 'sqlite' }))
    expect(yaml).toContain('backend: sqlite')
    expect(yaml).toContain('connection: file:./data/memory.db')
  })
})

// ── generateManifest — memory hygiene ───────────────────────────────────────

describe('generateManifest — memory hygiene', () => {
  const yaml = generateManifest(baseOpts({ includeMemory: true, memoryBackend: 'in-memory' }))

  it('includes piiScrubFields', () => {
    expect(yaml).toContain('piiScrubFields: []')
  })

  it('includes auditLog', () => {
    expect(yaml).toContain('auditLog: false')
  })
})

// ── generateManifest — API variants ─────────────────────────────────────────

describe('generateManifest — API variants', () => {
  it('generates rest API with streaming and chat path', () => {
    const yaml = generateManifest(baseOpts({ includeApi: true, apiType: 'rest', apiPort: 3000 }))
    expect(yaml).toContain('type: rest')
    expect(yaml).toContain('streaming: true')
    expect(yaml).toContain('path: /v1/chat')
  })

  it('generates mcp API without chat config', () => {
    const yaml = generateManifest(baseOpts({ includeApi: true, apiType: 'mcp', apiPort: 3000 }))
    expect(yaml).toContain('type: mcp')
    expect(yaml).not.toContain('streaming:')
  })

  it('uses default port 3000 when apiPort is not specified', () => {
    const yaml = generateManifest(baseOpts({ includeApi: true, apiType: 'rest' }))
    expect(yaml).toContain('port: 3000')
  })

  it('uses custom port when specified', () => {
    const yaml = generateManifest(baseOpts({ includeApi: true, apiType: 'rest', apiPort: 8080 }))
    expect(yaml).toContain('port: 8080')
  })
})

// ── generateManifest — observability backends ───────────────────────────────

describe('generateManifest — observability backends', () => {
  it('generates langfuse config with public/secret keys', () => {
    const yaml = generateManifest(
      baseOpts({ includeObservability: true, tracingBackend: 'langfuse' }),
    )
    expect(yaml).toContain('backend: langfuse')
    expect(yaml).toContain('$env:LANGFUSE_PUBLIC_KEY')
    expect(yaml).toContain('$env:LANGFUSE_SECRET_KEY')
  })

  it('generates otel config with OTLP endpoint', () => {
    const yaml = generateManifest(baseOpts({ includeObservability: true, tracingBackend: 'otel' }))
    expect(yaml).toContain('backend: otel')
    expect(yaml).toContain('$env:OTEL_EXPORTER_OTLP_ENDPOINT')
  })

  it('generates datadog config with agent URL', () => {
    const yaml = generateManifest(
      baseOpts({ includeObservability: true, tracingBackend: 'datadog' }),
    )
    expect(yaml).toContain('backend: datadog')
    expect(yaml).toContain('$env:DD_TRACE_AGENT_URL')
  })
})

// ── generateManifest — guardrails content ───────────────────────────────────

describe('generateManifest — guardrails content', () => {
  const yaml = generateManifest(baseOpts({ includeGuardrails: true }))

  it('includes prompt-injection input guardrail', () => {
    expect(yaml).toContain('type: prompt-injection')
    expect(yaml).toContain('action: reject')
  })

  it('includes toxicity-filter output guardrail', () => {
    expect(yaml).toContain('type: toxicity-filter')
    expect(yaml).toContain('threshold: 0.7')
  })
})

// ── generateManifest — eval content ─────────────────────────────────────────

describe('generateManifest — eval content', () => {
  const yaml = generateManifest(baseOpts({ includeEval: true }))

  it('includes deepeval framework', () => {
    expect(yaml).toContain('framework: deepeval')
  })

  it('includes faithfulness and hallucination metrics', () => {
    expect(yaml).toContain('- faithfulness')
    expect(yaml).toContain('- hallucination')
  })
})

// ── generateManifest — compliance ───────────────────────────────────────────

describe('generateManifest — compliance', () => {
  const yaml = generateManifest(baseOpts())

  it('includes owasp-llm-top10 pack', () => {
    expect(yaml).toContain('- owasp-llm-top10')
  })

  it('includes model-resilience and memory-hygiene packs', () => {
    expect(yaml).toContain('- model-resilience')
    expect(yaml).toContain('- memory-hygiene')
  })
})

// ── collectRequiredEnvVars ──────────────────────────────────────────────────

describe('collectRequiredEnvVars', () => {
  it('includes provider API key for openai', () => {
    const vars = collectRequiredEnvVars(baseOpts({ provider: 'openai' }))
    expect(vars).toContain('OPENAI_API_KEY')
  })

  it('includes provider API key for anthropic', () => {
    const vars = collectRequiredEnvVars(baseOpts({ provider: 'anthropic' }))
    expect(vars).toContain('ANTHROPIC_API_KEY')
  })

  it('includes AZURE_OPENAI_API_KEY for azure (not AZURE_API_KEY)', () => {
    const vars = collectRequiredEnvVars(baseOpts({ provider: 'azure' }))
    expect(vars).toContain('AZURE_OPENAI_API_KEY')
    expect(vars).not.toContain('AZURE_API_KEY')
  })

  it('includes REDIS_URL when memory backend is redis', () => {
    const vars = collectRequiredEnvVars(
      baseOpts({ includeMemory: true, memoryBackend: 'redis' }),
    )
    expect(vars).toContain('REDIS_URL')
  })

  it('does not include REDIS_URL when memory is in-memory', () => {
    const vars = collectRequiredEnvVars(
      baseOpts({ includeMemory: true, memoryBackend: 'in-memory' }),
    )
    expect(vars).not.toContain('REDIS_URL')
  })

  it('does not include REDIS_URL when memory is disabled', () => {
    const vars = collectRequiredEnvVars(baseOpts({ includeMemory: false }))
    expect(vars).not.toContain('REDIS_URL')
  })

  it('includes langfuse keys for langfuse tracing', () => {
    const vars = collectRequiredEnvVars(
      baseOpts({ includeObservability: true, tracingBackend: 'langfuse' }),
    )
    expect(vars).toContain('LANGFUSE_PUBLIC_KEY')
    expect(vars).toContain('LANGFUSE_SECRET_KEY')
  })

  it('includes OTEL endpoint for otel tracing', () => {
    const vars = collectRequiredEnvVars(
      baseOpts({ includeObservability: true, tracingBackend: 'otel' }),
    )
    expect(vars).toContain('OTEL_EXPORTER_OTLP_ENDPOINT')
  })

  it('includes DD agent URL for datadog tracing', () => {
    const vars = collectRequiredEnvVars(
      baseOpts({ includeObservability: true, tracingBackend: 'datadog' }),
    )
    expect(vars).toContain('DD_TRACE_AGENT_URL')
  })

  it('combines provider key + redis + langfuse keys', () => {
    const vars = collectRequiredEnvVars(
      baseOpts({
        provider: 'groq',
        includeMemory: true,
        memoryBackend: 'redis',
        includeObservability: true,
        tracingBackend: 'langfuse',
      }),
    )
    expect(vars).toEqual([
      'GROQ_API_KEY',
      'REDIS_URL',
      'LANGFUSE_PUBLIC_KEY',
      'LANGFUSE_SECRET_KEY',
    ])
  })
})

// ── generateSystemPrompt ────────────────────────────────────────────────────

describe('generateSystemPrompt', () => {
  const prompt = generateSystemPrompt('my-cool-agent', 'A helpful assistant')

  it('title-cases the name in the heading', () => {
    expect(prompt).toContain('# My Cool Agent')
  })

  it('includes the description in the body', () => {
    expect(prompt).toContain('A helpful assistant')
  })

  it('includes instructions section', () => {
    expect(prompt).toContain('## Instructions')
    expect(prompt).toContain('Be helpful and concise')
  })
})

// ── generateEnvExample ──────────────────────────────────────────────────────

describe('generateEnvExample', () => {
  const envFile = generateEnvExample('my-agent', ['OPENAI_API_KEY', 'REDIS_URL'])

  it('includes header comment with agent name', () => {
    expect(envFile).toContain('# Environment variables for my-agent')
  })

  it('includes OPENAI_API_KEY with placeholder', () => {
    expect(envFile).toContain('OPENAI_API_KEY=sk-your-openai-api-key')
  })

  it('includes REDIS_URL with localhost placeholder', () => {
    expect(envFile).toContain('REDIS_URL=redis://localhost:6379')
  })

  it('uses generic placeholder for unknown env vars', () => {
    const output = generateEnvExample('agent', ['CUSTOM_VAR'])
    expect(output).toContain('CUSTOM_VAR=your-value-here')
  })

  it('places each env var on its own line', () => {
    const lines = envFile.split('\n').filter((l) => l && !l.startsWith('#'))
    expect(lines).toHaveLength(2)
  })
})

// ── Section ordering ────────────────────────────────────────────────────────

describe('section ordering', () => {
  const yaml = generateManifest(
    baseOpts({
      includeMemory: true,
      memoryBackend: 'in-memory',
      includeGuardrails: true,
      includeObservability: true,
      tracingBackend: 'langfuse',
    }),
  )

  it('places model before memory', () => {
    const modelIdx = yaml.indexOf('model:')
    const memoryIdx = yaml.indexOf('memory:')
    expect(modelIdx).toBeLessThan(memoryIdx)
  })

  it('places compliance before requires', () => {
    const complianceIdx = yaml.indexOf('compliance:')
    const requiresIdx = yaml.indexOf('requires:')
    expect(complianceIdx).toBeLessThan(requiresIdx)
  })
})

// ── Edge cases ──────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('handles empty description', () => {
    const yaml = generateManifest(baseOpts({ description: '' }))
    expect(yaml).toContain('description: ""')
  })

  it('handles hyphenated name', () => {
    const yaml = generateManifest(baseOpts({ name: 'my-complex-agent-v2' }))
    expect(yaml).toContain('name: my-complex-agent-v2')
  })

  it('produces valid manifest with all toggles false', () => {
    const yaml = generateManifest(baseOpts())
    expect(yaml).toContain('apiVersion: agentspec.io/v1')
    expect(yaml).not.toContain('memory:')
    expect(yaml).not.toMatch(/^\s+api:/m)
    expect(yaml).not.toContain('guardrails:')
    expect(yaml).not.toContain('evaluation:')
    expect(yaml).not.toContain('observability:')
  })

  it('produces valid manifest with all toggles true', () => {
    const yaml = generateManifest(
      baseOpts({
        includeMemory: true,
        memoryBackend: 'redis',
        includeApi: true,
        apiType: 'rest',
        apiPort: 4000,
        includeObservability: true,
        tracingBackend: 'otel',
        includeGuardrails: true,
        includeEval: true,
        includeToolsStarter: true,
      }),
    )
    expect(yaml).toContain('memory:')
    expect(yaml).toContain('api:')
    expect(yaml).toContain('observability:')
    expect(yaml).toContain('guardrails:')
    expect(yaml).toContain('evaluation:')
    expect(yaml).toMatch(/^\s+tools:/m)
  })
})

// ── fetchAvailableModels ────────────────────────────────────────────────────

describe('fetchAvailableModels', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function mockFetch(data: { id: string }[]): void {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data }),
    }) as unknown as typeof fetch
  }

  it('returns filtered models for a provider', async () => {
    mockFetch([
      { id: 'openai/gpt-4o' },
      { id: 'openai/gpt-4o-mini' },
      { id: 'anthropic/claude-sonnet-4-6' },
    ])
    const models = await fetchAvailableModels('openai')
    expect(models).toEqual(['gpt-4o', 'gpt-4o-mini'])
  })

  it('strips provider prefix from model IDs', async () => {
    mockFetch([{ id: 'anthropic/claude-opus-4-6' }])
    const models = await fetchAvailableModels('anthropic')
    expect(models).toEqual(['claude-opus-4-6'])
  })

  it('excludes models with :free suffix', async () => {
    mockFetch([
      { id: 'google/gemini-2.0-flash' },
      { id: 'google/gemini-2.0-flash:free' },
    ])
    const models = await fetchAvailableModels('google')
    expect(models).toEqual(['gemini-2.0-flash'])
  })

  it('returns null on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as unknown as typeof fetch
    const models = await fetchAvailableModels('openai')
    expect(models).toBeNull()
  })

  it('returns null when response is not ok', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }) as unknown as typeof fetch
    const models = await fetchAvailableModels('openai')
    expect(models).toBeNull()
  })
})
