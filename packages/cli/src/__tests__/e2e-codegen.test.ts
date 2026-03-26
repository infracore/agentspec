/**
 * End-to-end tests for the codegen pipeline.
 *
 * These tests verify cross-package functionality:
 *   resolver → provider → provider-probe → provider-status
 *
 * They spawn the real CLI via tsx so every layer is exercised.
 */

import { execa } from 'execa'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '../../../..')
const tsxBin = join(repoRoot, 'node_modules/.bin/tsx')
const cliSrc = join(repoRoot, 'packages/cli/src/cli.ts')
const exampleManifest = join(repoRoot, 'examples/gymcoach/agent.yaml')

async function runCli(args: string[], env?: Record<string, string>) {
  return execa(tsxBin, [cliSrc, ...args], {
    cwd: repoRoot,
    reject: false,
    timeout: 15_000,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', ...env },
  })
}

// ── Provider resolution via AGENTSPEC_CODEGEN_PROVIDER ──────────────────────

describe('provider resolution (E2E)', () => {
  it('generate exits 1 when forced to anthropic-api without key', async () => {
    const result = await runCli(
      ['generate', exampleManifest, '--framework', 'langgraph'],
      { ANTHROPIC_API_KEY: '', AGENTSPEC_CODEGEN_PROVIDER: 'anthropic-api' },
    )
    expect(result.exitCode).toBe(1)
    const output = result.stdout + result.stderr
    expect(output).toContain('ANTHROPIC_API_KEY')
  })

  it('generate exits 1 when forced to codex without key', async () => {
    const result = await runCli(
      ['generate', exampleManifest, '--framework', 'langgraph'],
      { ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', AGENTSPEC_CODEGEN_PROVIDER: 'codex' },
    )
    expect(result.exitCode).toBe(1)
    const output = result.stdout + result.stderr
    expect(output).toContain('OPENAI_API_KEY')
  })

  it('generate --provider flag overrides env var', async () => {
    const result = await runCli(
      ['generate', exampleManifest, '--framework', 'langgraph', '--provider', 'anthropic-api'],
      { ANTHROPIC_API_KEY: '', AGENTSPEC_CODEGEN_PROVIDER: 'codex', OPENAI_API_KEY: 'sk-fake' },
    )
    expect(result.exitCode).toBe(1)
    // --provider anthropic-api should take precedence over env var codex
    const output = result.stdout + result.stderr
    expect(output).toContain('ANTHROPIC_API_KEY')
  })
})

// ── provider-status JSON pipeline ─────────────────────────────────────────────

describe('provider-status JSON pipeline (E2E)', () => {
  it('returns valid JSON with all sections', async () => {
    const result = await runCli(
      ['provider-status', '--json'],
      { ANTHROPIC_API_KEY: '', AGENTSPEC_CODEGEN_PROVIDER: '' },
    )
    // May exit 0 or 1 depending on whether claude CLI is installed locally
    const json = JSON.parse(result.stdout)
    expect(json).toHaveProperty('claudeCli')
    expect(json).toHaveProperty('anthropicApi')
    expect(json).toHaveProperty('env')
    expect(json.env).toHaveProperty('resolvedProvider')
    expect(json.env).toHaveProperty('providerOverride')
    expect(json.env).toHaveProperty('modelOverride')
  })

  it('env.providerOverride reflects AGENTSPEC_CODEGEN_PROVIDER', async () => {
    const result = await runCli(
      ['provider-status', '--json'],
      { AGENTSPEC_CODEGEN_PROVIDER: 'anthropic-api', ANTHROPIC_API_KEY: 'sk-ant-fake' },
    )
    const json = JSON.parse(result.stdout)
    expect(json.env.providerOverride).toBe('anthropic-api')
  })

  it('resolvedProvider is null when no provider is available', async () => {
    const result = await runCli(
      ['provider-status', '--json'],
      {
        ANTHROPIC_API_KEY: '',
        OPENAI_API_KEY: '',
        AGENTSPEC_CODEGEN_PROVIDER: 'anthropic-api',
      },
    )
    // Forced to anthropic-api but no key → resolveProvider throws → resolvedProvider=null
    const json = JSON.parse(result.stdout)
    expect(json.env.resolvedProvider).toBeNull()
    expect(json.env.resolveError).toBeTruthy()
    expect(result.exitCode).toBe(1)
  })

  it('exits 0 when a provider resolves successfully', async () => {
    const result = await runCli(
      ['provider-status', '--json'],
      { ANTHROPIC_API_KEY: 'sk-ant-fake-key-for-test', AGENTSPEC_CODEGEN_PROVIDER: 'anthropic-api' },
    )
    const json = JSON.parse(result.stdout)
    expect(json.env.resolvedProvider).toBe('anthropic-api')
    expect(result.exitCode).toBe(0)
  })
})

// ── Framework listing ───────────────────────────────────────────────────────

describe('framework listing (E2E)', () => {
  it('generate rejects unknown framework with available list', async () => {
    const result = await runCli(
      ['generate', exampleManifest, '--framework', 'nonexistent-framework'],
    )
    expect(result.exitCode).toBe(1)
    const output = result.stdout + result.stderr
    expect(output).toMatch(/not supported/i)
    expect(output).toContain('langgraph')
  })
})
