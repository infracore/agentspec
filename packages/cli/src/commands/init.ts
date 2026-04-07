import type { Command } from 'commander'
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import chalk from 'chalk'
import * as p from '@clack/prompts'
import { printHeader } from '../utils/output.js'
import {
  PROVIDER_DEFAULTS,
  generateManifest,
  generateSystemPrompt,
  generateEnvExample,
  collectRequiredEnvVars,
  fetchAvailableModels,
  type InitOptions,
} from './init-helpers.js'

// ── Private helpers ────────────────────────────────────────────────────────────

function buildDefaultOptions(): InitOptions {
  return {
    name: 'my-agent',
    description: 'An AI agent',
    version: '0.1.0',
    provider: 'openai',
    modelId: 'gpt-4o-mini',
    includeMemory: false,
    includeApi: false,
    includeObservability: false,
    includeGuardrails: true,
    includeEval: false,
    includeToolsStarter: false,
  }
}

async function runPhase1(): Promise<{
  name: string
  description: string
  version: string
  provider: string
  modelId: string
}> {
  const basics = await p.group(
    {
      name: () =>
        p.text({
          message: 'Agent name (slug)',
          placeholder: 'my-agent',
          validate: (v) =>
            /^[a-z0-9-]+$/.test(v) ? undefined : 'Must be lowercase slug (a-z, 0-9, -)',
        }),
      description: () =>
        p.text({
          message: 'Description',
          placeholder: 'An AI agent that...',
        }),
      version: () =>
        p.text({
          message: 'Version',
          placeholder: '0.1.0',
          initialValue: '0.1.0',
        }),
      provider: () =>
        p.select({
          message: 'Model provider',
          options: [
            { value: 'openai', label: 'OpenAI' },
            { value: 'anthropic', label: 'Anthropic' },
            { value: 'groq', label: 'Groq' },
            { value: 'google', label: 'Google' },
            { value: 'mistral', label: 'Mistral' },
            { value: 'azure', label: 'Azure OpenAI' },
          ],
        }),
    },
    {
      onCancel: () => {
        p.cancel('Init cancelled.')
        process.exit(0)
      },
    },
  )

  const provider = String(basics.provider || 'openai')
  const modelId = await selectModel(provider)

  return {
    ...(basics as { name: string; description: string; version: string; provider: string }),
    modelId,
  }
}

async function selectModel(provider: string): Promise<string> {
  const s = p.spinner()
  s.start('Fetching available models...')
  const models = await fetchAvailableModels(provider)
  if (models && models.length > 0) {
    s.stop('Models loaded')
    const defaultModel = PROVIDER_DEFAULTS[provider]
    const selected = await p.select({
      message: 'Model',
      options: models.map((id) => ({ value: id, label: id })),
      initialValue: models.includes(defaultModel) ? defaultModel : models[0],
    })
    if (p.isCancel(selected)) {
      p.cancel('Init cancelled.')
      process.exit(0)
    }
    return String(selected)
  }

  s.stop('Could not fetch models')
  const modelId = await p.text({
    message: 'Model ID',
    placeholder: PROVIDER_DEFAULTS[provider] ?? 'gpt-4o-mini',
    initialValue: PROVIDER_DEFAULTS[provider] ?? 'gpt-4o-mini',
  })
  if (p.isCancel(modelId)) {
    p.cancel('Init cancelled.')
    process.exit(0)
  }
  return String(modelId)
}

interface Phase2Answers {
  includeMemory: boolean
  includeApi: boolean
  includeObservability: boolean
  includeGuardrails: boolean
  includeEval: boolean
  includeToolsStarter: boolean
}

async function runPhase2(): Promise<Phase2Answers> {
  const answers = await p.group(
    {
      includeMemory: () =>
        p.confirm({
          message: 'Include memory configuration?',
          initialValue: false,
        }),
      includeApi: () =>
        p.confirm({
          message: 'Include API endpoint configuration?',
          initialValue: false,
        }),
      includeObservability: () =>
        p.confirm({
          message: 'Include observability (tracing/logging)?',
          initialValue: false,
        }),
      includeGuardrails: () =>
        p.confirm({
          message: 'Include guardrails?',
          initialValue: true,
        }),
      includeEval: () =>
        p.confirm({
          message: 'Include evaluation configuration?',
          initialValue: false,
        }),
      includeToolsStarter: () =>
        p.confirm({
          message: 'Include starter tool template?',
          initialValue: false,
        }),
    },
    {
      onCancel: () => {
        p.cancel('Init cancelled.')
        process.exit(0)
      },
    },
  )

  return answers
}

async function runPhase3(phase2: {
  includeMemory: boolean
  includeApi: boolean
  includeObservability: boolean
}): Promise<{
  memoryBackend?: 'in-memory' | 'redis' | 'sqlite'
  apiType?: 'rest' | 'mcp'
  apiPort?: number
  tracingBackend?: 'langfuse' | 'otel' | 'datadog'
}> {
  const result: {
    memoryBackend?: 'in-memory' | 'redis' | 'sqlite'
    apiType?: 'rest' | 'mcp'
    apiPort?: number
    tracingBackend?: 'langfuse' | 'otel' | 'datadog'
  } = {}

  if (phase2.includeMemory) {
    const backend = await p.select({
      message: 'Memory backend',
      options: [
        { value: 'in-memory', label: 'In-memory (no persistence)' },
        { value: 'redis', label: 'Redis' },
        { value: 'sqlite', label: 'SQLite' },
      ],
    })
    if (p.isCancel(backend)) {
      p.cancel('Init cancelled.')
      process.exit(0)
    }
    result.memoryBackend = backend as 'in-memory' | 'redis' | 'sqlite'
  }

  if (phase2.includeApi) {
    const apiType = await p.select({
      message: 'API type',
      options: [
        { value: 'rest', label: 'REST (OpenAI-compatible)' },
        { value: 'mcp', label: 'MCP (Model Context Protocol)' },
      ],
    })
    if (p.isCancel(apiType)) {
      p.cancel('Init cancelled.')
      process.exit(0)
    }
    result.apiType = apiType as 'rest' | 'mcp'

    const port = await p.text({
      message: 'API port',
      placeholder: '3000',
      initialValue: '3000',
      validate: (v) => {
        const n = parseInt(v, 10)
        return isNaN(n) || n < 1 || n > 65535 ? 'Must be a valid port (1-65535)' : undefined
      },
    })
    if (p.isCancel(port)) {
      p.cancel('Init cancelled.')
      process.exit(0)
    }
    result.apiPort = parseInt(String(port), 10)
  }

  if (phase2.includeObservability) {
    const backend = await p.select({
      message: 'Tracing backend',
      options: [
        { value: 'langfuse', label: 'Langfuse' },
        { value: 'otel', label: 'OpenTelemetry (OTLP)' },
        { value: 'datadog', label: 'Datadog' },
      ],
    })
    if (p.isCancel(backend)) {
      p.cancel('Init cancelled.')
      process.exit(0)
    }
    result.tracingBackend = backend as 'langfuse' | 'otel' | 'datadog'
  }

  return result
}

function scaffoldFiles(outDir: string, opts: InitOptions): void {
  const promptsDir = join(outDir, 'prompts')
  const systemMdPath = join(promptsDir, 'system.md')
  const envExamplePath = join(outDir, '.env.example')

  const envVars = collectRequiredEnvVars(opts)

  mkdirSync(promptsDir, { recursive: true })

  if (existsSync(systemMdPath)) {
    p.log.warn(`Skipped prompts/system.md (already exists)`)
  } else {
    writeFileSync(systemMdPath, generateSystemPrompt(opts.name, opts.description), 'utf-8')
  }

  if (existsSync(envExamplePath)) {
    p.log.warn(`Skipped .env.example (already exists)`)
  } else {
    writeFileSync(envExamplePath, generateEnvExample(opts.name, envVars), 'utf-8')
  }
}

// ── Public command registration ────────────────────────────────────────────────

export function registerInitCommand(program: Command): void {
  program
    .command('init [dir]')
    .description('Interactive wizard to create a new agent.yaml manifest')
    .option('--yes', 'Skip prompts, create a minimal manifest')
    .action(async (dir: string = '.', cmdOpts: { yes?: boolean }) => {
      const outDir = resolve(dir)
      const outFile = join(outDir, 'agent.yaml')

      printHeader('AgentSpec Init')

      if (existsSync(outFile) && !cmdOpts.yes) {
        const overwrite = await p.confirm({
          message: `agent.yaml already exists at ${outFile}. Overwrite?`,
          initialValue: false,
        })
        if (!overwrite || p.isCancel(overwrite)) {
          p.cancel('Init cancelled.')
          return
        }
      }

      let opts: InitOptions

      if (cmdOpts.yes) {
        opts = buildDefaultOptions()
      } else {
        p.intro(chalk.cyan('Creating your agent.yaml'))

        const phase1 = await runPhase1()
        const phase2 = await runPhase2()
        const phase3 = await runPhase3(phase2)

        opts = {
          name: String(phase1.name || 'my-agent'),
          description: String(phase1.description || 'An AI agent'),
          version: String(phase1.version || '0.1.0'),
          provider: String(phase1.provider || 'openai'),
          modelId: String(phase1.modelId || 'gpt-4o-mini'),
          includeMemory: Boolean(phase2.includeMemory),
          includeApi: Boolean(phase2.includeApi),
          includeObservability: Boolean(phase2.includeObservability),
          includeGuardrails: Boolean(phase2.includeGuardrails),
          includeEval: Boolean(phase2.includeEval),
          includeToolsStarter: Boolean(phase2.includeToolsStarter),
          ...phase3,
        }
      }

      const yaml = generateManifest(opts)
      writeFileSync(outFile, yaml, 'utf-8')

      scaffoldFiles(outDir, opts)

      if (!cmdOpts.yes) p.outro(chalk.green(`✓ Created ${outFile}`))
      else console.log(chalk.green(`\n  ✓ Created ${outFile}\n`))

      console.log(chalk.gray('  Next steps:'))
      console.log(chalk.gray(`    1. Edit ${outFile} to customize your agent`))
      console.log(chalk.gray(`    2. Run: npx agentspec validate agent.yaml`))
      console.log(chalk.gray(`    3. Run: npx agentspec health agent.yaml`))
      console.log(chalk.gray(`    4. Run: npx agentspec audit agent.yaml`))
      console.log()
    })
}
