import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import type { ProviderProbeReport } from '@agentspec/codegen'

// ── Mock @agentspec/codegen before any imports ────────────────────────────────

const mockProbeProviders = vi.fn()

vi.mock('@agentspec/codegen', () => ({
  probeProviders: mockProbeProviders,
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReport(provider: string | null): ProviderProbeReport {
  return {
    claudeCli: {
      installed: provider === 'claude-subscription',
      version: provider === 'claude-subscription' ? 'claude 2.1.81' : null,
      authenticated: provider === 'claude-subscription',
      authStatusRaw: null,
      accountEmail: provider === 'claude-subscription' ? 'user@example.com' : null,
      plan: provider === 'claude-subscription' ? 'Claude Pro' : null,
      activeModel: null,
    },
    anthropicApi: {
      keySet: provider === 'anthropic-api',
      keyPreview: provider === 'anthropic-api' ? 'sk-a…ey' : null,
      baseURLSet: false,
      baseURL: null,
      keyValid: provider === 'anthropic-api' ? true : null,
      probeStatus: provider === 'anthropic-api' ? 200 : null,
      probeError: null,
    },
    env: {
      providerOverride: null,
      modelOverride: null,
      resolvedProvider: provider,
      resolveError: provider === null ? 'No codegen provider available' : null,
    },
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let exitSpy: MockInstance
let consoleLogSpy: MockInstance

beforeEach(() => {
  vi.clearAllMocks()
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(
    ((..._args: unknown[]) => { throw new Error(`process.exit(${_args[0]})`) }) as unknown as typeof process.exit
  )
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation((..._args) => {})
  vi.spyOn(console, 'error').mockImplementation((..._args) => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Tests: --json mode ────────────────────────────────────────────────────────

describe('registerProviderStatusCommand — --json output', () => {
  it('outputs valid JSON containing all top-level probe keys', async () => {
    mockProbeProviders.mockResolvedValue(makeReport('claude-subscription'))

    const { registerProviderStatusCommand } = await import('../commands/provider-status.js')
    const { Command } = await import('commander')
    const program = new Command()
    program.exitOverride()
    registerProviderStatusCommand(program)

    let capturedJson: string | undefined
    consoleLogSpy.mockImplementation((...args: unknown[]) => {
      capturedJson = String(args[0])
    })

    await expect(
      program.parseAsync(['node', 'agentspec', 'provider-status', '--json']),
    ).rejects.toThrow('process.exit(0)')

    expect(capturedJson).toBeDefined()
    const parsed = JSON.parse(capturedJson!) as ProviderProbeReport
    expect(parsed).toHaveProperty('claudeCli')
    expect(parsed).toHaveProperty('anthropicApi')
    expect(parsed).toHaveProperty('env')
  })

  it('exits 0 when resolvedProvider is claude-subscription', async () => {
    mockProbeProviders.mockResolvedValue(makeReport('claude-subscription'))

    const { registerProviderStatusCommand } = await import('../commands/provider-status.js')
    const { Command } = await import('commander')
    const program = new Command()
    program.exitOverride()
    registerProviderStatusCommand(program)

    await expect(
      program.parseAsync(['node', 'agentspec', 'provider-status', '--json']),
    ).rejects.toThrow('process.exit(0)')

    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('exits 0 when resolvedProvider is anthropic-api', async () => {
    mockProbeProviders.mockResolvedValue(makeReport('anthropic-api'))

    const { registerProviderStatusCommand } = await import('../commands/provider-status.js')
    const { Command } = await import('commander')
    const program = new Command()
    program.exitOverride()
    registerProviderStatusCommand(program)

    await expect(
      program.parseAsync(['node', 'agentspec', 'provider-status', '--json']),
    ).rejects.toThrow('process.exit(0)')

    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('exits 1 when resolvedProvider is null', async () => {
    mockProbeProviders.mockResolvedValue(makeReport(null))

    const { registerProviderStatusCommand } = await import('../commands/provider-status.js')
    const { Command } = await import('commander')
    const program = new Command()
    program.exitOverride()
    registerProviderStatusCommand(program)

    await expect(
      program.parseAsync(['node', 'agentspec', 'provider-status', '--json']),
    ).rejects.toThrow('process.exit(1)')

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('JSON env.resolvedProvider matches the report', async () => {
    mockProbeProviders.mockResolvedValue(makeReport('anthropic-api'))

    const { registerProviderStatusCommand } = await import('../commands/provider-status.js')
    const { Command } = await import('commander')
    const program = new Command()
    program.exitOverride()
    registerProviderStatusCommand(program)

    let capturedJson: string | undefined
    consoleLogSpy.mockImplementation((...args: unknown[]) => {
      capturedJson = String(args[0])
    })

    await expect(
      program.parseAsync(['node', 'agentspec', 'provider-status', '--json']),
    ).rejects.toThrow()

    const parsed = JSON.parse(capturedJson!) as ProviderProbeReport
    expect(parsed.env.resolvedProvider).toBe('anthropic-api')
    expect(parsed.env.resolveError).toBeNull()
  })

  it('JSON env.resolveError is set when resolvedProvider is null', async () => {
    mockProbeProviders.mockResolvedValue(makeReport(null))

    const { registerProviderStatusCommand } = await import('../commands/provider-status.js')
    const { Command } = await import('commander')
    const program = new Command()
    program.exitOverride()
    registerProviderStatusCommand(program)

    let capturedJson: string | undefined
    consoleLogSpy.mockImplementation((...args: unknown[]) => {
      capturedJson = String(args[0])
    })

    await expect(
      program.parseAsync(['node', 'agentspec', 'provider-status', '--json']),
    ).rejects.toThrow()

    const parsed = JSON.parse(capturedJson!) as ProviderProbeReport
    expect(parsed.env.resolvedProvider).toBeNull()
    expect(parsed.env.resolveError).toBeTruthy()
  })
})

// ── Tests: table mode (no --json) ─────────────────────────────────────────────

describe('registerProviderStatusCommand — table output', () => {
  it('exits 1 when resolvedProvider is null', async () => {
    mockProbeProviders.mockResolvedValue(makeReport(null))

    const { registerProviderStatusCommand } = await import('../commands/provider-status.js')
    const { Command } = await import('commander')
    const program = new Command()
    program.exitOverride()
    registerProviderStatusCommand(program)

    await expect(
      program.parseAsync(['node', 'agentspec', 'provider-status']),
    ).rejects.toThrow('process.exit(1)')

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('exits 0 when resolvedProvider is claude-subscription', async () => {
    mockProbeProviders.mockResolvedValue(makeReport('claude-subscription'))

    const { registerProviderStatusCommand } = await import('../commands/provider-status.js')
    const { Command } = await import('commander')
    const program = new Command()
    program.exitOverride()
    registerProviderStatusCommand(program)

    await expect(
      program.parseAsync(['node', 'agentspec', 'provider-status']),
    ).rejects.toThrow('process.exit(0)')

    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('exits 0 when resolvedProvider is anthropic-api', async () => {
    mockProbeProviders.mockResolvedValue(makeReport('anthropic-api'))

    const { registerProviderStatusCommand } = await import('../commands/provider-status.js')
    const { Command } = await import('commander')
    const program = new Command()
    program.exitOverride()
    registerProviderStatusCommand(program)

    await expect(
      program.parseAsync(['node', 'agentspec', 'provider-status']),
    ).rejects.toThrow('process.exit(0)')

    expect(exitSpy).toHaveBeenCalledWith(0)
  })
})
