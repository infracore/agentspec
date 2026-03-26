import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ClaudeProbeReport } from '@agentspec/codegen'

// ── Mock @agentspec/codegen before any imports ────────────────────────────────

const mockProbeClaudeAuth = vi.fn()

vi.mock('@agentspec/codegen', () => ({
  probeClaudeAuth: mockProbeClaudeAuth,
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReport(resolvedMode: 'cli' | 'api' | 'none'): ClaudeProbeReport {
  return {
    cli: {
      installed: resolvedMode === 'cli',
      version: resolvedMode === 'cli' ? 'claude 2.1.81' : null,
      authenticated: resolvedMode === 'cli',
      authStatusRaw: null,
      accountEmail: resolvedMode === 'cli' ? 'user@example.com' : null,
      plan: resolvedMode === 'cli' ? 'Claude Pro' : null,
      activeModel: null,
    },
    api: {
      keySet: resolvedMode === 'api',
      keyPreview: resolvedMode === 'api' ? 'sk-a…ey' : null,
      baseURLSet: false,
      baseURL: null,
      keyValid: resolvedMode === 'api' ? true : null,
      probeStatus: resolvedMode === 'api' ? 200 : null,
      probeError: null,
    },
    env: {
      authModeOverride: null,
      modelOverride: null,
      resolvedMode,
      resolveError: resolvedMode === 'none' ? 'No Claude authentication found' : null,
    },
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let exitSpy: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let consoleLogSpy: any

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

describe('registerClaudeStatusCommand — --json output', () => {
  it('outputs valid JSON containing all top-level probe keys', async () => {
    mockProbeClaudeAuth.mockResolvedValue(makeReport('cli'))

    const { registerClaudeStatusCommand } = await import('../commands/claude-status.js')
    const { Command } = await import('commander')
    const program = new Command()
    program.exitOverride()
    registerClaudeStatusCommand(program)

    let capturedJson: string | undefined
    consoleLogSpy.mockImplementation((...args: unknown[]) => {
      capturedJson = String(args[0])
    })

    await expect(
      program.parseAsync(['node', 'agentspec', 'claude-status', '--json']),
    ).rejects.toThrow('process.exit(0)')

    expect(capturedJson).toBeDefined()
    const parsed = JSON.parse(capturedJson!) as ClaudeProbeReport
    expect(parsed).toHaveProperty('cli')
    expect(parsed).toHaveProperty('api')
    expect(parsed).toHaveProperty('env')
  })

  it('exits 0 when resolvedMode is cli', async () => {
    mockProbeClaudeAuth.mockResolvedValue(makeReport('cli'))

    const { registerClaudeStatusCommand } = await import('../commands/claude-status.js')
    const { Command } = await import('commander')
    const program = new Command()
    program.exitOverride()
    registerClaudeStatusCommand(program)

    await expect(
      program.parseAsync(['node', 'agentspec', 'claude-status', '--json']),
    ).rejects.toThrow('process.exit(0)')

    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('exits 0 when resolvedMode is api', async () => {
    mockProbeClaudeAuth.mockResolvedValue(makeReport('api'))

    const { registerClaudeStatusCommand } = await import('../commands/claude-status.js')
    const { Command } = await import('commander')
    const program = new Command()
    program.exitOverride()
    registerClaudeStatusCommand(program)

    await expect(
      program.parseAsync(['node', 'agentspec', 'claude-status', '--json']),
    ).rejects.toThrow('process.exit(0)')

    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('exits 1 when resolvedMode is none', async () => {
    mockProbeClaudeAuth.mockResolvedValue(makeReport('none'))

    const { registerClaudeStatusCommand } = await import('../commands/claude-status.js')
    const { Command } = await import('commander')
    const program = new Command()
    program.exitOverride()
    registerClaudeStatusCommand(program)

    await expect(
      program.parseAsync(['node', 'agentspec', 'claude-status', '--json']),
    ).rejects.toThrow('process.exit(1)')

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('JSON env.resolvedMode matches the report', async () => {
    mockProbeClaudeAuth.mockResolvedValue(makeReport('api'))

    const { registerClaudeStatusCommand } = await import('../commands/claude-status.js')
    const { Command } = await import('commander')
    const program = new Command()
    program.exitOverride()
    registerClaudeStatusCommand(program)

    let capturedJson: string | undefined
    consoleLogSpy.mockImplementation((...args: unknown[]) => {
      capturedJson = String(args[0])
    })

    await expect(
      program.parseAsync(['node', 'agentspec', 'claude-status', '--json']),
    ).rejects.toThrow()

    const parsed = JSON.parse(capturedJson!) as ClaudeProbeReport
    expect(parsed.env.resolvedMode).toBe('api')
    expect(parsed.env.resolveError).toBeNull()
  })

  it('JSON env.resolveError is set when resolvedMode is none', async () => {
    mockProbeClaudeAuth.mockResolvedValue(makeReport('none'))

    const { registerClaudeStatusCommand } = await import('../commands/claude-status.js')
    const { Command } = await import('commander')
    const program = new Command()
    program.exitOverride()
    registerClaudeStatusCommand(program)

    let capturedJson: string | undefined
    consoleLogSpy.mockImplementation((...args: unknown[]) => {
      capturedJson = String(args[0])
    })

    await expect(
      program.parseAsync(['node', 'agentspec', 'claude-status', '--json']),
    ).rejects.toThrow()

    const parsed = JSON.parse(capturedJson!) as ClaudeProbeReport
    expect(parsed.env.resolvedMode).toBe('none')
    expect(parsed.env.resolveError).toBeTruthy()
  })
})

// ── Tests: table mode (no --json) ─────────────────────────────────────────────

describe('registerClaudeStatusCommand — table output', () => {
  it('exits 1 when resolvedMode is none', async () => {
    mockProbeClaudeAuth.mockResolvedValue(makeReport('none'))

    const { registerClaudeStatusCommand } = await import('../commands/claude-status.js')
    const { Command } = await import('commander')
    const program = new Command()
    program.exitOverride()
    registerClaudeStatusCommand(program)

    await expect(
      program.parseAsync(['node', 'agentspec', 'claude-status']),
    ).rejects.toThrow('process.exit(1)')

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('exits 0 when resolvedMode is cli', async () => {
    mockProbeClaudeAuth.mockResolvedValue(makeReport('cli'))

    const { registerClaudeStatusCommand } = await import('../commands/claude-status.js')
    const { Command } = await import('commander')
    const program = new Command()
    program.exitOverride()
    registerClaudeStatusCommand(program)

    await expect(
      program.parseAsync(['node', 'agentspec', 'claude-status']),
    ).rejects.toThrow('process.exit(0)')

    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('exits 0 when resolvedMode is api', async () => {
    mockProbeClaudeAuth.mockResolvedValue(makeReport('api'))

    const { registerClaudeStatusCommand } = await import('../commands/claude-status.js')
    const { Command } = await import('commander')
    const program = new Command()
    program.exitOverride()
    registerClaudeStatusCommand(program)

    await expect(
      program.parseAsync(['node', 'agentspec', 'claude-status']),
    ).rejects.toThrow('process.exit(0)')

    expect(exitSpy).toHaveBeenCalledWith(0)
  })
})
