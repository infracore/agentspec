import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock child_process before importing the module
const mockExecFileSync = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}))

// Mock resolver to avoid real CLI probing
const mockResolveProvider = vi.hoisted(() => vi.fn())
vi.mock('../../resolver.js', () => ({
  resolveProvider: mockResolveProvider,
}))

// Mock global fetch for API key probing
const mockFetch = vi.hoisted(() => vi.fn())
vi.stubGlobal('fetch', mockFetch)

import { probeClaudeAuth } from '../../auth-probe.js'

describe('probeClaudeAuth()', () => {
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    vi.clearAllMocks()
    // Save and clear env vars
    for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'AGENTSPEC_CLAUDE_AUTH_MODE', 'ANTHROPIC_MODEL']) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key]
      else process.env[key] = val
    }
  })

  describe('CLI probe', () => {
    it('reports installed=false when claude is not on PATH', async () => {
      mockExecFileSync.mockImplementation(() => { throw new Error('not found') })
      mockResolveProvider.mockImplementation(() => { throw new Error('none') })

      const report = await probeClaudeAuth()
      expect(report.cli.installed).toBe(false)
      expect(report.cli.version).toBeNull()
      expect(report.cli.authenticated).toBe(false)
    })

    it('reports installed=true and parses version', async () => {
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (args[0] === '--version') return '2.1.84 (Claude Code)'
        if (args[0] === 'auth' && args[1] === 'status') return '{"loggedIn": true, "email": "user@test.com", "subscriptionType": "max"}'
        return ''
      })
      mockResolveProvider.mockReturnValue({ name: 'claude-subscription' })

      const report = await probeClaudeAuth()
      expect(report.cli.installed).toBe(true)
      expect(report.cli.version).toBe('2.1.84 (Claude Code)')
    })

    it('detects authentication from JSON output', async () => {
      mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === '--version') return '2.1.84'
        if (args[0] === 'auth') return '{"loggedIn": true, "email": "user@test.com"}'
        return ''
      })
      mockResolveProvider.mockReturnValue({ name: 'claude-subscription' })

      const report = await probeClaudeAuth()
      expect(report.cli.authenticated).toBe(true)
    })

    it('detects not authenticated from "not logged in" text', async () => {
      mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === '--version') return '2.1.84'
        if (args[0] === 'auth') return 'Not logged in'
        return ''
      })
      mockResolveProvider.mockReturnValue({ name: 'claude-subscription' })

      const report = await probeClaudeAuth()
      expect(report.cli.authenticated).toBe(false)
    })

    it('parses email from auth status', async () => {
      mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === '--version') return '2.1.84'
        if (args[0] === 'auth') return '{"loggedIn": true, "email": "alice@example.com", "subscriptionType": "pro"}'
        return ''
      })
      mockResolveProvider.mockReturnValue({ name: 'claude-subscription' })

      const report = await probeClaudeAuth()
      expect(report.cli.accountEmail).toBe('alice@example.com')
    })

    it('parses plan from auth status', async () => {
      mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === '--version') return '2.1.84'
        if (args[0] === 'auth') return '{"loggedIn": true, "subscriptionType": "max"}'
        return ''
      })
      mockResolveProvider.mockReturnValue({ name: 'claude-subscription' })

      const report = await probeClaudeAuth()
      expect(report.cli.plan).toBe('Claude Max')
    })

    it('parses Claude Pro plan', async () => {
      mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === '--version') return '2.1.84'
        if (args[0] === 'auth') return 'Logged in as user@test.com (Pro plan)'
        return ''
      })
      mockResolveProvider.mockReturnValue({ name: 'claude-subscription' })

      const report = await probeClaudeAuth()
      expect(report.cli.plan).toBe('Claude Pro')
    })
  })

  describe('API probe', () => {
    it('reports keySet=false when ANTHROPIC_API_KEY is not set', async () => {
      mockExecFileSync.mockImplementation(() => { throw new Error('not found') })
      mockResolveProvider.mockImplementation(() => { throw new Error('none') })

      const report = await probeClaudeAuth()
      expect(report.api.keySet).toBe(false)
      expect(report.api.keyPreview).toBeNull()
      expect(report.api.keyValid).toBeNull()
    })

    it('reports keySet=true and probes API when key is set', async () => {
      process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test123'
      mockExecFileSync.mockImplementation(() => { throw new Error('not found') })
      mockResolveProvider.mockReturnValue({ name: 'anthropic-api' })
      mockFetch.mockResolvedValue({ ok: true, status: 200 })

      const report = await probeClaudeAuth()
      expect(report.api.keySet).toBe(true)
      expect(report.api.keyPreview).toBe('sk-a…23')
      expect(report.api.keyValid).toBe(true)
      expect(report.api.probeStatus).toBe(200)
    })

    it('reports keyValid=false on HTTP 401', async () => {
      process.env['ANTHROPIC_API_KEY'] = 'sk-ant-invalid'
      mockExecFileSync.mockImplementation(() => { throw new Error('not found') })
      mockResolveProvider.mockReturnValue({ name: 'anthropic-api' })
      mockFetch.mockResolvedValue({ ok: false, status: 401 })

      const report = await probeClaudeAuth()
      expect(report.api.keyValid).toBe(false)
      expect(report.api.probeStatus).toBe(401)
      expect(report.api.probeError).toBe('HTTP 401')
    })

    it('reports probeError on fetch failure', async () => {
      process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test'
      mockExecFileSync.mockImplementation(() => { throw new Error('not found') })
      mockResolveProvider.mockReturnValue({ name: 'anthropic-api' })
      mockFetch.mockRejectedValue(new Error('network error'))

      const report = await probeClaudeAuth()
      expect(report.api.keyValid).toBe(false)
      expect(report.api.probeStatus).toBeNull()
      expect(report.api.probeError).toContain('network error')
    })

    it('includes custom base URL when set', async () => {
      process.env['ANTHROPIC_BASE_URL'] = 'https://proxy.example.com'
      mockExecFileSync.mockImplementation(() => { throw new Error('not found') })
      mockResolveProvider.mockImplementation(() => { throw new Error('none') })

      const report = await probeClaudeAuth()
      expect(report.api.baseURLSet).toBe(true)
      expect(report.api.baseURL).toBe('https://proxy.example.com')
    })
  })

  describe('env probe', () => {
    it('reports resolvedMode=cli when provider is claude-subscription', async () => {
      mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === '--version') return '2.1.84'
        if (args[0] === 'auth') return '{"loggedIn": true}'
        return ''
      })
      mockResolveProvider.mockReturnValue({ name: 'claude-subscription' })

      const report = await probeClaudeAuth()
      expect(report.env.resolvedMode).toBe('cli')
    })

    it('reports resolvedMode=api when provider is anthropic-api', async () => {
      mockExecFileSync.mockImplementation(() => { throw new Error('not found') })
      mockResolveProvider.mockReturnValue({ name: 'anthropic-api' })

      const report = await probeClaudeAuth()
      expect(report.env.resolvedMode).toBe('api')
    })

    it('reports resolvedMode=none with error when no provider available', async () => {
      mockExecFileSync.mockImplementation(() => { throw new Error('not found') })
      mockResolveProvider.mockImplementation(() => { throw new Error('No codegen provider available.') })

      const report = await probeClaudeAuth()
      expect(report.env.resolvedMode).toBe('none')
      expect(report.env.resolveError).toContain('No codegen provider')
    })

    it('captures AGENTSPEC_CLAUDE_AUTH_MODE override', async () => {
      process.env['AGENTSPEC_CLAUDE_AUTH_MODE'] = 'api'
      mockExecFileSync.mockImplementation(() => { throw new Error('not found') })
      mockResolveProvider.mockImplementation(() => { throw new Error('none') })

      const report = await probeClaudeAuth()
      expect(report.env.authModeOverride).toBe('api')
    })

    it('captures ANTHROPIC_MODEL override', async () => {
      process.env['ANTHROPIC_MODEL'] = 'claude-sonnet-4-6'
      mockExecFileSync.mockImplementation(() => { throw new Error('not found') })
      mockResolveProvider.mockImplementation(() => { throw new Error('none') })

      const report = await probeClaudeAuth()
      expect(report.env.modelOverride).toBe('claude-sonnet-4-6')
    })
  })

  describe('never throws', () => {
    it('returns a complete report even when everything fails', async () => {
      mockExecFileSync.mockImplementation(() => { throw new Error('fail') })
      mockResolveProvider.mockImplementation(() => { throw new Error('fail') })

      const report = await probeClaudeAuth()

      // Should have all three sections
      expect(report).toHaveProperty('cli')
      expect(report).toHaveProperty('api')
      expect(report).toHaveProperty('env')

      // CLI section — not installed
      expect(report.cli.installed).toBe(false)
      expect(report.cli.authenticated).toBe(false)

      // API section — no key
      expect(report.api.keySet).toBe(false)

      // Env section — no provider
      expect(report.env.resolvedMode).toBe('none')
    })
  })
})
