// ── Constants ──────────────────────────────────────────────────────────────────

export const PROVIDER_DEFAULTS: Record<string, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-6',
  groq: 'llama-3.3-70b-versatile',
  google: 'gemini-2.0-flash',
  mistral: 'mistral-large-latest',
  azure: 'gpt-4o',
}

export const PROVIDER_ENV_KEYS: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  groq: 'GROQ_API_KEY',
  google: 'GOOGLE_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  azure: 'AZURE_OPENAI_API_KEY',
}

// ── Interface ──────────────────────────────────────────────────────────────────

export interface InitOptions {
  // Phase 1
  name: string
  description: string
  version: string
  provider: string
  modelId: string
  // Phase 2 toggles
  includeMemory: boolean
  includeApi: boolean
  includeObservability: boolean
  includeGuardrails: boolean
  includeEval: boolean
  includeToolsStarter: boolean
  // Phase 3 conditionals
  memoryBackend?: 'in-memory' | 'redis' | 'sqlite'
  apiType?: 'rest' | 'mcp'
  apiPort?: number
  tracingBackend?: 'langfuse' | 'otel' | 'datadog'
}

// ── Private section generators ─────────────────────────────────────────────────

function generateMetadataSection(opts: InitOptions): string {
  return `apiVersion: agentspec.io/v1
kind: AgentSpec

metadata:
  name: ${opts.name}
  version: ${opts.version}
  description: "${opts.description}"
  tags: []
  author: ""
  license: MIT

spec:`
}

function generateModelSection(opts: InitOptions): string {
  const apiKeyEnv = PROVIDER_ENV_KEYS[opts.provider] ?? `${opts.provider.toUpperCase()}_API_KEY`
  return `
  # ── MODEL ──────────────────────────────────────────────────────────────────
  model:
    provider: ${opts.provider}
    id: ${opts.modelId}
    apiKey: $env:${apiKeyEnv}
    parameters:
      temperature: 0.7
      maxTokens: 2000
    # Uncomment to add fallback:
    # fallback:
    #   provider: openai
    #   id: gpt-4o-mini
    #   apiKey: $env:OPENAI_API_KEY
    #   triggerOn: [rate_limit, timeout, error_5xx]
    #   maxRetries: 2`
}

function generatePromptsSection(): string {
  return `
  # ── PROMPTS ────────────────────────────────────────────────────────────────
  prompts:
    system: $file:prompts/system.md
    fallback: "I'm experiencing difficulties. Please try again."
    hotReload: false`
}

function generateToolsSection(include: boolean): string {
  if (include) {
    return `
  # ── TOOLS ────────────────────────────────────────────────────────────────
  tools:
    - name: my-tool
      type: function
      description: "Description of what this tool does"
      module: $file:tools/my_tool.py
      function: my_tool_function
      annotations:
        readOnlyHint: true
        destructiveHint: false`
  }
  return `
  # ── TOOLS (optional) ───────────────────────────────────────────────────────
  # tools:
  #   - name: my-tool
  #     type: function
  #     description: "Description of what this tool does"
  #     module: $file:tools/my_tool.py
  #     function: my_tool_function
  #     annotations:
  #       readOnlyHint: true
  #       destructiveHint: false`
}

function generateMemorySection(opts: InitOptions): string {
  const backend = opts.memoryBackend ?? 'in-memory'
  let connectionLine = ''
  if (backend === 'redis') {
    connectionLine = '\n      connection: $env:REDIS_URL'
  } else if (backend === 'sqlite') {
    connectionLine = '\n      connection: file:./data/memory.db'
  }

  return `
  # ── MEMORY ─────────────────────────────────────────────────────────────────
  memory:
    shortTerm:
      backend: ${backend}
      maxTurns: 20
      maxTokens: 8000${connectionLine}
    hygiene:
      piiScrubFields: []
      auditLog: false`
}

function generateApiSection(opts: InitOptions): string {
  const apiType = opts.apiType ?? 'rest'
  const port = opts.apiPort ?? 3000

  if (apiType === 'mcp') {
    return `
  # ── API ──────────────────────────────────────────────────────────────────
  api:
    type: mcp
    port: ${port}`
  }

  return `
  # ── API ──────────────────────────────────────────────────────────────────
  api:
    type: rest
    port: ${port}
    chat:
      path: /v1/chat
      protocol: openai-compatible
      streaming: true`
}

function generateGuardrailsSection(): string {
  return `
  # ── GUARDRAILS ─────────────────────────────────────────────────────────────
  guardrails:
    input:
      - type: prompt-injection
        action: reject
        sensitivity: high
    output:
      - type: toxicity-filter
        threshold: 0.7
        action: reject`
}

function generateEvalSection(): string {
  return `
  # ── EVALUATION ─────────────────────────────────────────────────────────────
  evaluation:
    framework: deepeval
    datasets:
      - name: qa-test
        path: $file:eval/datasets/qa.jsonl
    metrics:
      - faithfulness
      - hallucination
    thresholds:
      hallucination: 0.05
    ciGate: false`
}

function generateObservabilitySection(opts: InitOptions): string {
  const backend = opts.tracingBackend ?? 'langfuse'

  let tracingConfig: string
  if (backend === 'langfuse') {
    tracingConfig = `    backend: langfuse
      publicKey: $env:LANGFUSE_PUBLIC_KEY
      secretKey: $env:LANGFUSE_SECRET_KEY`
  } else if (backend === 'otel') {
    tracingConfig = `    backend: otel
      endpoint: $env:OTEL_EXPORTER_OTLP_ENDPOINT`
  } else {
    tracingConfig = `    backend: datadog
      endpoint: $env:DD_TRACE_AGENT_URL`
  }

  return `
  # ── OBSERVABILITY ──────────────────────────────────────────────────────────
  observability:
    tracing:
      ${tracingConfig}
    logging:
      level: info
      structured: true`
}

function generateComplianceSection(): string {
  return `
  # ── COMPLIANCE ─────────────────────────────────────────────────────────────
  compliance:
    packs:
      - owasp-llm-top10
      - model-resilience
      - memory-hygiene`
}

function generateRequiresSection(envVars: string[]): string {
  const envLines = envVars.map((v) => `      - ${v}`).join('\n')
  return `
  # ── RUNTIME REQUIREMENTS ───────────────────────────────────────────────────
  requires:
    envVars:
${envLines}
`
}

// ── Exported functions ─────────────────────────────────────────────────────────

export function collectRequiredEnvVars(opts: InitOptions): string[] {
  const vars: string[] = []

  const providerKey = PROVIDER_ENV_KEYS[opts.provider] ?? `${opts.provider.toUpperCase()}_API_KEY`
  vars.push(providerKey)

  if (opts.includeMemory && opts.memoryBackend === 'redis') {
    vars.push('REDIS_URL')
  }

  if (opts.includeObservability) {
    const backend = opts.tracingBackend ?? 'langfuse'
    if (backend === 'langfuse') {
      vars.push('LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY')
    } else if (backend === 'otel') {
      vars.push('OTEL_EXPORTER_OTLP_ENDPOINT')
    } else if (backend === 'datadog') {
      vars.push('DD_TRACE_AGENT_URL')
    }
  }

  return vars
}

export function generateManifest(opts: InitOptions): string {
  const envVars = collectRequiredEnvVars(opts)

  const sections: string[] = [
    generateMetadataSection(opts),
    generateModelSection(opts),
    generatePromptsSection(),
    generateToolsSection(opts.includeToolsStarter),
  ]

  if (opts.includeMemory) sections.push(generateMemorySection(opts))
  if (opts.includeApi) sections.push(generateApiSection(opts))
  if (opts.includeGuardrails) sections.push(generateGuardrailsSection())
  if (opts.includeEval) sections.push(generateEvalSection())
  if (opts.includeObservability) sections.push(generateObservabilitySection(opts))

  sections.push(generateComplianceSection())
  sections.push(generateRequiresSection(envVars))

  return sections.join('\n')
}

export function generateSystemPrompt(name: string, description: string): string {
  const title = name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

  return `# ${title}

${description}

## Instructions

- Be helpful and concise
- Follow the user's instructions carefully
- Ask for clarification when the request is ambiguous
`
}

export async function fetchAvailableModels(provider: string): Promise<string[] | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      signal: controller.signal,
    })
    if (!res.ok) return null

    const json = (await res.json()) as { data?: { id: string }[] }
    if (!json.data || !Array.isArray(json.data)) return null

    const prefix = provider + '/'
    return json.data
      .map((m) => m.id)
      .filter((id) => id.startsWith(prefix) && !id.endsWith(':free'))
      .map((id) => id.slice(prefix.length))
      .sort()
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

export function generateEnvExample(name: string, envVars: string[]): string {
  const placeholders: Record<string, string> = {
    OPENAI_API_KEY: 'sk-your-openai-api-key',
    ANTHROPIC_API_KEY: 'sk-ant-your-anthropic-api-key',
    GROQ_API_KEY: 'gsk_your-groq-api-key',
    GOOGLE_API_KEY: 'your-google-api-key',
    MISTRAL_API_KEY: 'your-mistral-api-key',
    AZURE_OPENAI_API_KEY: 'your-azure-openai-api-key',
    REDIS_URL: 'redis://localhost:6379',
    LANGFUSE_PUBLIC_KEY: 'pk-lf-your-langfuse-public-key',
    LANGFUSE_SECRET_KEY: 'sk-lf-your-langfuse-secret-key',
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
    DD_TRACE_AGENT_URL: 'http://localhost:8126',
  }

  const lines = [`# Environment variables for ${name}`]
  for (const v of envVars) {
    lines.push(`${v}=${placeholders[v] ?? 'your-value-here'}`)
  }
  return lines.join('\n') + '\n'
}
