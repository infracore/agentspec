# @agentspec/codegen

Provider-agnostic code generation for AgentSpec. Reads an `agent.yaml` manifest and generates complete, runnable agent code for any supported framework.

## Install

```bash
npm install @agentspec/codegen
```

## Quick Start

```typescript
import { generateCode, resolveProvider } from '@agentspec/codegen'
import { loadManifest } from '@agentspec/sdk'

const { manifest } = loadManifest('./agent.yaml')
const provider = resolveProvider() // auto-detects Claude CLI → API key → Codex

const result = await generateCode(manifest, {
  framework: 'langgraph',
  provider,
})

console.log(Object.keys(result.files)) // ['agent.py', 'tools.py', ...]
```

## Providers

Three built-in providers, auto-detected in priority order:

| Provider | Class | Requires |
|----------|-------|----------|
| Claude subscription | `ClaudeSubscriptionProvider` | `claude` CLI authenticated |
| Anthropic API | `AnthropicApiProvider` | `ANTHROPIC_API_KEY` env var |
| OpenAI Codex | `CodexProvider` | `OPENAI_API_KEY` env var |

### Auto-detection

```typescript
import { resolveProvider } from '@agentspec/codegen'

const provider = resolveProvider()          // auto-detect
const provider = resolveProvider('anthropic-api') // force specific provider
```

Override via env var: `AGENTSPEC_CODEGEN_PROVIDER=anthropic-api`

### Direct instantiation

```typescript
import { AnthropicApiProvider } from '@agentspec/codegen'

const provider = new AnthropicApiProvider('sk-ant-...', 'https://proxy.example.com')
```

## Frameworks

List available frameworks at runtime:

```typescript
import { listFrameworks } from '@agentspec/codegen'
console.log(listFrameworks()) // ['langgraph', 'crewai', 'mastra', ...]
```

Add a new framework by creating a skill file in `src/skills/<name>.md` — no TypeScript code needed.

## Streaming

Stream generation progress via `onChunk`:

```typescript
const result = await generateCode(manifest, {
  framework: 'langgraph',
  provider,
  onChunk: (chunk) => {
    if (chunk.type === 'delta') {
      process.stdout.write(chunk.text)
    }
  },
})
```

Chunk types:
- `delta` — text fragment with `text`, `accumulated`, and `elapsedSec`
- `heartbeat` — keep-alive with `elapsedSec`
- `done` — final result with `result` string and `elapsedSec`

## Utilities

### `collect(stream)`

Drain a provider stream to a single string:

```typescript
import { collect, resolveProvider } from '@agentspec/codegen'

const provider = resolveProvider()
const text = await collect(provider.stream(systemPrompt, userPrompt, {}))
```

### `repairYaml(provider, yaml, errors)`

Ask the LLM to fix schema validation errors in an `agent.yaml`:

```typescript
import { repairYaml, resolveProvider } from '@agentspec/codegen'

const fixed = await repairYaml(resolveProvider(), badYaml, validationErrors)
```

### `probeClaudeAuth()`

Diagnostic probe for Claude auth status (used by `agentspec claude-status`):

```typescript
import { probeClaudeAuth } from '@agentspec/codegen'

const report = await probeClaudeAuth()
console.log(report.cli.installed)    // true
console.log(report.env.resolvedMode) // 'cli' | 'api' | 'none'
```

## Error Handling

All errors are typed as `CodegenError` with a `code` property:

```typescript
import { CodegenError } from '@agentspec/codegen'

try {
  await generateCode(manifest, { framework: 'langgraph', provider })
} catch (err) {
  if (err instanceof CodegenError) {
    console.error(err.code, err.message)
    // err.code: 'auth_failed' | 'generation_failed' | 'parse_failed' | ...
  }
}
```

Error codes: `auth_failed`, `quota_exceeded`, `rate_limited`, `model_not_found`, `generation_failed`, `parse_failed`, `provider_unavailable`, `response_invalid`
