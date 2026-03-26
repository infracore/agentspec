# Code Generation

Generate runnable, framework-specific agent code from a single `agent.yaml` manifest.

## Overview

`@agentspec/codegen` reads your `agent.yaml` manifest, selects an LLM provider, and produces a complete, ready-to-run project — source files, dependencies, environment templates, and a README. You never write boilerplate by hand; the manifest is the source of truth.

---

## 1. Quick Start

```bash
# Generate a LangGraph agent from your manifest
agentspec generate agent.yaml --framework langgraph

# Output lands in ./generated/ by default
cd generated && pip install -r requirements.txt && python server.py
```

No configuration needed if you have the Claude CLI installed and logged in. AgentSpec auto-detects your auth.

---

## 2. How It Works

```
agent.yaml
    │
    ▼
┌─────────────────────────────────┐
│  @agentspec/codegen             │
│                                 │
│  resolveProvider()              │◄── Claude subscription / API key / Codex
│  loadSkill('langgraph')         │◄── src/skills/langgraph.md
│  buildContext(manifest)         │
│  provider.stream(system, user)  │
│  extractGeneratedAgent(result)  │
└─────────────────────────────────┘
    │
    ▼
{ files: { 'agent.py': '...', 'requirements.txt': '...', ... } }
    │
    ▼
agentspec generate --output ./generated/
```

**Step by step:**

1. **Resolve provider** — auto-detects Claude subscription (CLI), Anthropic API key, or OpenAI Codex
2. **Load skill** — reads a framework-specific Markdown guide (e.g., `langgraph.md`) that tells the LLM how to generate code
3. **Build context** — serializes the manifest JSON + any context files into a prompt
4. **Stream** — sends the prompt to the provider and streams back the response
5. **Parse** — extracts the JSON file map from the LLM response and writes files to disk

This approach covers **all manifest fields** without exhaustive TypeScript templates. When the schema evolves, the skill file captures it in plain Markdown, not code.

---

## 3. Providers

AgentSpec supports three codegen providers. Auto-detection tries them in order:

| Provider | Env var needed | How it works |
|----------|---------------|--------------|
| **Claude subscription** | None — uses `claude` CLI | First priority. Free with Pro/Max plan. |
| **Anthropic API** | `ANTHROPIC_API_KEY` | Direct API call. Pay per token. |
| **OpenAI Codex** | `OPENAI_API_KEY` | Uses OpenAI's API. |

### Force a specific provider

```bash
# Via CLI flag
agentspec generate agent.yaml --framework langgraph --provider anthropic-api

# Via env var
export AGENTSPEC_CODEGEN_PROVIDER=claude-sub       # force subscription
export AGENTSPEC_CODEGEN_PROVIDER=anthropic-api    # force API key
export AGENTSPEC_CODEGEN_PROVIDER=codex            # use OpenAI Codex
```

### Check your auth status

```bash
agentspec claude-status
```

See the [Claude Authentication guide](../guides/claude-auth) for full details, CI setup, and overrides.

---

## 4. Available Frameworks

| Framework | Language | Generated files | Status |
|-----------|----------|-----------------|--------|
| `langgraph` | Python | `agent.py`, `tools.py`, `guardrails.py`, `server.py`, `eval_runner.py`, `requirements.txt`, `.env.example`, `README.md` | Available |
| `crewai` | Python | `crew.py`, `tools.py`, `guardrails.py`, `requirements.txt`, `.env.example`, `README.md` | Available |
| `mastra` | TypeScript | `src/agent.ts`, `src/tools.ts`, `mastra.config.ts`, `package.json`, `.env.example`, `README.md` | Available |

```bash
# Pick your framework
agentspec generate agent.yaml --framework langgraph
agentspec generate agent.yaml --framework crewai
agentspec generate agent.yaml --framework mastra

# Preview without writing files
agentspec generate agent.yaml --framework langgraph --dry-run

# Custom output directory
agentspec generate agent.yaml --framework langgraph --output ./my-agent/

# Override model
export ANTHROPIC_MODEL=claude-sonnet-4-6
agentspec generate agent.yaml --framework langgraph
```

See the per-framework docs for generated file details:
- [LangGraph](../adapters/langgraph.md)
- [CrewAI](../adapters/crewai.md)
- [Mastra](../adapters/mastra.md)

---

## 5. The Skill File

Each framework is a single Markdown file in `packages/codegen/src/skills/`:

```
src/skills/
├── langgraph.md   # Python LangGraph — complete field mapping guide
├── crewai.md      # Python CrewAI — crew.py, tools.py, guardrails.py
├── mastra.md      # TypeScript Mastra — src/agent.ts, src/tools.ts
├── helm.md        # Helm chart generation
└── scan.md        # Source code scanning (used by agentspec scan)
```

Adding a new framework means writing one `.md` file — not a new TypeScript package. The file describes:

- **Output format** — the exact JSON shape the LLM must return
- **File map** — which files to generate and under what conditions
- **Manifest-to-code mappings** — tables mapping `agent.yaml` fields to framework-specific code patterns
- **Reference syntax resolution** — how to handle `$env:`, `$secret:`, `$file:`, `$func:` in the generated code
- **Quality checklist** — invariants the LLM must verify before returning output

### Add a new framework

```bash
# 1. Create the skill
touch packages/codegen/src/skills/autogen.md

# 2. Rebuild to copy it to dist/
pnpm --filter @agentspec/codegen build

# 3. Use it immediately
agentspec generate agent.yaml --framework autogen
```

See `packages/codegen/src/skills/langgraph.md` for a comprehensive reference implementation.

---

## 6. The GeneratedAgent Output

All generation returns the same `GeneratedAgent` shape from `@agentspec/sdk`:

```typescript
interface GeneratedAgent {
  framework: string                 // which framework produced this
  files: Record<string, string>    // filename → file contents
  installCommands: string[]        // ordered setup commands
  envVars: string[]                // env vars the generated code requires
  readme: string                   // README contents
}
```

`files` is a flat map. Keys are output filenames and values are complete file contents. The CLI writes each key/value pair to `--output <dir>`.

---

## 7. Programmatic Usage

Use `@agentspec/codegen` directly from TypeScript:

```typescript
import { generateCode, resolveProvider } from '@agentspec/codegen'
import { loadManifest } from '@agentspec/sdk'

const { manifest } = loadManifest('./agent.yaml')
const provider = resolveProvider()          // auto-detect

const result = await generateCode(manifest, {
  framework: 'langgraph',
  provider,
  onChunk: (chunk) => {
    if (chunk.type === 'delta') {
      process.stdout.write(chunk.text)      // stream progress
    }
  },
})

console.log(Object.keys(result.files))      // ['agent.py', 'tools.py', ...]
```

### Custom provider

```typescript
import { AnthropicApiProvider } from '@agentspec/codegen'

const provider = new AnthropicApiProvider(
  process.env.ANTHROPIC_API_KEY!,
  process.env.ANTHROPIC_BASE_URL,           // optional proxy
)

const result = await generateCode(manifest, {
  framework: 'crewai',
  provider,
})
```

---

## 8. Static Adapters (SDK)

The `FrameworkAdapter` interface in `@agentspec/sdk` is available for deterministic, offline adapters:

```typescript
import { registerAdapter, type FrameworkAdapter } from '@agentspec/sdk'

const myAdapter: FrameworkAdapter = {
  framework: 'my-framework',
  version: '0.1.0',
  generate(manifest) {
    return {
      framework: 'my-framework',
      files: { 'agent.py': generateAgentPy(manifest) },
      installCommands: ['pip install -r requirements.txt'],
      envVars: manifest.spec.requires?.envVars ?? [],
      readme: '...',
    }
  },
}

registerAdapter(myAdapter)
```

Static adapters are useful for:
- Deterministic output (no API call, no token cost)
- Offline environments
- Narrow/well-defined manifest subsets

---

## 9. Field Mapping Reference

Every manifest field maps to a concept in generated code. Exact class names vary by framework; skill files contain the full per-framework tables.

| `agent.yaml` field | Generated code concept |
|--------------------|----------------------|
| `spec.model.provider` + `spec.model.id` | LLM client instantiation |
| `spec.model.apiKey` | `os.environ.get("VAR_NAME")` — never embedded as a literal |
| `spec.model.parameters.temperature` | LLM temperature setting |
| `spec.model.parameters.maxTokens` | LLM max tokens |
| `spec.model.fallback` | Fallback LLM chain |
| `spec.prompts.system` (`$file:`) | System prompt loaded from file at runtime |
| `spec.prompts.variables[]` | Prompt template variable injection |
| `spec.tools[]` | Tool functions bound to the LLM |
| `spec.memory.shortTerm.backend` | Memory / checkpointer backend |
| `spec.guardrails.input[]` | Input validation middleware |
| `spec.guardrails.output[]` | Output validation middleware |
| `spec.observability.tracing.backend` | Tracing / callback setup |
| `spec.evaluation.*` | Eval harness generation |
| `spec.api.*` | FastAPI / HTTP server generation |
| `spec.requires.envVars[]` | Startup env var validation |
| `spec.subagents[]` | Sub-agent invocation stubs |

### Reference prefix resolution

| Manifest value | Generated code |
|----------------|----------------|
| `$env:GROQ_API_KEY` | `os.environ.get("GROQ_API_KEY")` |
| `$secret:my-key` | `os.environ.get("AGENTSPEC_SECRET_MY_KEY")` |
| `$file:prompts/system.md` | Open the file at runtime |
| `$func:now_iso` | `datetime.utcnow().isoformat()` |

---

## See also

- [Claude Authentication](../guides/claude-auth) — subscription vs API key, CI setup, overrides
- [LangGraph adapter](../adapters/langgraph.md) — generated files and manifest mapping
- [CrewAI adapter](../adapters/crewai.md) — generated files and manifest mapping
- [Mastra adapter](../adapters/mastra.md) — generated files and manifest mapping
- [The agent.yaml manifest](./manifest.md) — manifest structure and reference syntax
- [agentspec generate CLI reference](../reference/cli.md)
