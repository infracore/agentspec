import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock child_process before any imports that use it ─────────────────────────

const mockExecFileSync = vi.fn()
vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeVersionOk(): void {
  mockExecFileSync.mockImplementationOnce((_cmd: string, args: string[]) => {
    if (args[0] === '--version') return 'claude 1.0.0'
    return ''
  })
}

function makeAuthOk(): void {
  mockExecFileSync.mockImplementationOnce(() =>
    JSON.stringify({ loggedIn: true }),
  )
}

function makeAuthNotLoggedIn(): void {
  const err = Object.assign(new Error('not logged in'), {
    stderr: 'Error: not logged in',
    stdout: '',
  })
  mockExecFileSync.mockImplementationOnce(() => { throw err })
}

function makeCliNotFound(): void {
  const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  mockExecFileSync.mockImplementationOnce(() => { throw err })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('resolveAuth()', () => {
  const savedKey = process.env['ANTHROPIC_API_KEY']
  const savedMode = process.env['AGENTSPEC_CLAUDE_AUTH_MODE']
  const savedBase = process.env['ANTHROPIC_BASE_URL']

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env['ANTHROPIC_API_KEY']
    delete process.env['AGENTSPEC_CLAUDE_AUTH_MODE']
    delete process.env['ANTHROPIC_BASE_URL']
  })

  afterEach(() => {
    if (savedKey !== undefined) process.env['ANTHROPIC_API_KEY'] = savedKey
    else delete process.env['ANTHROPIC_API_KEY']
    if (savedMode !== undefined) process.env['AGENTSPEC_CLAUDE_AUTH_MODE'] = savedMode
    else delete process.env['AGENTSPEC_CLAUDE_AUTH_MODE']
    if (savedBase !== undefined) process.env['ANTHROPIC_BASE_URL'] = savedBase
    else delete process.env['ANTHROPIC_BASE_URL']
  })

  // ── Auto mode — CLI first ──────────────────────────────────────────────────

  it('auto: returns cli when claude is installed and authenticated', async () => {
    makeVersionOk()
    makeAuthOk()
    const { resolveAuth } = await import('../auth.js')
    const result = resolveAuth()
    expect(result.mode).toBe('cli')
    expect(result.apiKey).toBeUndefined()
  })

  it('auto: falls back to api when CLI not on PATH but ANTHROPIC_API_KEY is set', async () => {
    makeCliNotFound() // --version fails
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test'
    const { resolveAuth } = await import('../auth.js')
    const result = resolveAuth()
    expect(result.mode).toBe('api')
    expect(result.apiKey).toBe('sk-ant-test')
  })

  it('auto: falls back to api when CLI not authenticated but ANTHROPIC_API_KEY is set', async () => {
    makeVersionOk()
    makeAuthNotLoggedIn()
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test'
    const { resolveAuth } = await import('../auth.js')
    const result = resolveAuth()
    expect(result.mode).toBe('api')
    expect(result.apiKey).toBe('sk-ant-test')
  })

  it('auto: throws with combined instructions when neither is available', async () => {
    makeCliNotFound()
    const { resolveAuth } = await import('../auth.js')
    let thrown: unknown
    try { resolveAuth() } catch (e) { thrown = e }
    expect(thrown).toBeInstanceOf(Error)
    const msg = (thrown as Error).message
    expect(msg).toContain('No Claude authentication found')
    expect(msg).toContain('claude auth login')
    expect(msg).toContain('ANTHROPIC_API_KEY')
  })

  it('auto: prefers CLI over API key when both are available (CLI first)', async () => {
    makeVersionOk()
    makeAuthOk()
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test'
    const { resolveAuth } = await import('../auth.js')
    const result = resolveAuth()
    expect(result.mode).toBe('cli')
  })

  it('auto: api mode includes baseURL when ANTHROPIC_BASE_URL is set', async () => {
    makeCliNotFound()
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test'
    process.env['ANTHROPIC_BASE_URL'] = 'https://proxy.example.com'
    const { resolveAuth } = await import('../auth.js')
    const result = resolveAuth()
    expect(result.mode).toBe('api')
    expect(result.baseURL).toBe('https://proxy.example.com')
  })

  it('auto: api mode omits baseURL when ANTHROPIC_BASE_URL is not set', async () => {
    makeCliNotFound()
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test'
    const { resolveAuth } = await import('../auth.js')
    const result = resolveAuth()
    expect(result.baseURL).toBeUndefined()
  })

  // ── Explicit override: cli ────────────────────────────────────────────────

  it('override=cli: returns cli when authenticated', async () => {
    process.env['AGENTSPEC_CLAUDE_AUTH_MODE'] = 'cli'
    makeVersionOk()
    makeAuthOk()
    const { resolveAuth } = await import('../auth.js')
    const result = resolveAuth()
    expect(result.mode).toBe('cli')
  })

  it('override=cli: throws when CLI not on PATH', async () => {
    process.env['AGENTSPEC_CLAUDE_AUTH_MODE'] = 'cli'
    makeCliNotFound()
    const { resolveAuth } = await import('../auth.js')
    let thrown: unknown
    try { resolveAuth() } catch (e) { thrown = e }
    expect(thrown).toBeInstanceOf(Error)
    const msg = (thrown as Error).message
    expect(msg).toContain('AGENTSPEC_CLAUDE_AUTH_MODE=cli')
    expect(msg).toContain('not installed')
  })

  it('override=cli: throws when CLI not authenticated', async () => {
    process.env['AGENTSPEC_CLAUDE_AUTH_MODE'] = 'cli'
    makeVersionOk()
    makeAuthNotLoggedIn()
    const { resolveAuth } = await import('../auth.js')
    let thrown: unknown
    try { resolveAuth() } catch (e) { thrown = e }
    expect(thrown).toBeInstanceOf(Error)
    const msg = (thrown as Error).message
    expect(msg).toContain('AGENTSPEC_CLAUDE_AUTH_MODE=cli')
    expect(msg).toContain('claude auth login')
  })

  // ── Explicit override: api ────────────────────────────────────────────────

  it('override=api: returns api when ANTHROPIC_API_KEY is set', async () => {
    process.env['AGENTSPEC_CLAUDE_AUTH_MODE'] = 'api'
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-explicit'
    const { resolveAuth } = await import('../auth.js')
    const result = resolveAuth()
    expect(result.mode).toBe('api')
    expect(result.apiKey).toBe('sk-ant-explicit')
  })

  it('override=api: throws when ANTHROPIC_API_KEY is not set', async () => {
    process.env['AGENTSPEC_CLAUDE_AUTH_MODE'] = 'api'
    const { resolveAuth } = await import('../auth.js')
    expect(() => resolveAuth()).toThrow('AGENTSPEC_CLAUDE_AUTH_MODE=api')
    expect(() => resolveAuth()).toThrow('ANTHROPIC_API_KEY')
  })

  it('override=api: skips CLI check entirely', async () => {
    process.env['AGENTSPEC_CLAUDE_AUTH_MODE'] = 'api'
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test'
    const { resolveAuth } = await import('../auth.js')
    resolveAuth()
    // execFileSync should never be called for CLI check in api override mode
    expect(mockExecFileSync).not.toHaveBeenCalled()
  })
})

// ── isCliAvailable() tests ────────────────────────────────────────────────────

describe('isCliAvailable()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns true when CLI is installed and authenticated', async () => {
    makeVersionOk()
    makeAuthOk()
    const { isCliAvailable } = await import('../auth.js')
    expect(isCliAvailable()).toBe(true)
  })

  it('returns false when CLI is not on PATH', async () => {
    makeCliNotFound()
    const { isCliAvailable } = await import('../auth.js')
    expect(isCliAvailable()).toBe(false)
  })

  it('returns false when CLI is installed but not authenticated', async () => {
    makeVersionOk()
    makeAuthNotLoggedIn()
    const { isCliAvailable } = await import('../auth.js')
    expect(isCliAvailable()).toBe(false)
  })
})
