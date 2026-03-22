import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock child_process before any imports ─────────────────────────────────────

const mockSpawnSync = vi.fn()
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(), // keep for auth.test.ts which mocks this module separately
  spawnSync: mockSpawnSync,
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSuccessResult(output: string) {
  return { status: 0, stdout: output, stderr: '', signal: null, error: undefined }
}

function makeFailResult(stderr: string, status = 1) {
  return { status, stdout: '', stderr, signal: null, error: undefined }
}

function makeTimeoutResult() {
  return { status: null, stdout: '', stderr: '', signal: 'SIGTERM', error: undefined }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runClaudeCli()', () => {
  const savedModel = process.env['ANTHROPIC_MODEL']

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env['ANTHROPIC_MODEL']
  })

  afterEach(() => {
    if (savedModel !== undefined) process.env['ANTHROPIC_MODEL'] = savedModel
    else delete process.env['ANTHROPIC_MODEL']
  })

  it('returns stdout when claude CLI succeeds', async () => {
    mockSpawnSync.mockReturnValue(makeSuccessResult('{"files":{"agent.py":"# hello"}}'))
    const { runClaudeCli } = await import('../cli-runner.js')
    const result = runClaudeCli({
      systemPrompt: 'you are a code generator',
      userMessage: 'generate something',
    })
    expect(result).toBe('{"files":{"agent.py":"# hello"}}')
  })

  it('passes userMessage as stdin input', async () => {
    mockSpawnSync.mockReturnValue(makeSuccessResult('output'))
    const { runClaudeCli } = await import('../cli-runner.js')
    runClaudeCli({ systemPrompt: 'sys', userMessage: 'my user message' })
    const call = mockSpawnSync.mock.calls[0]!
    const opts = call[2] as { input?: string }
    expect(opts.input).toBe('my user message')
  })

  it('calls claude with -p -, --system-prompt, --model, --output-format text', async () => {
    mockSpawnSync.mockReturnValue(makeSuccessResult('output'))
    const { runClaudeCli } = await import('../cli-runner.js')
    runClaudeCli({ systemPrompt: 'sys prompt', userMessage: 'msg' })
    expect(mockSpawnSync).toHaveBeenCalledOnce()
    const [cmd, args] = mockSpawnSync.mock.calls[0] as [string, string[]]
    expect(cmd).toBe('claude')
    expect(args).toContain('-p')
    expect(args).toContain('-')
    expect(args).toContain('--system-prompt')
    expect(args).toContain('sys prompt')
    expect(args).toContain('--model')
    expect(args).toContain('--output-format')
    expect(args).toContain('text')
  })

  it('uses claude-opus-4-6 as default model', async () => {
    mockSpawnSync.mockReturnValue(makeSuccessResult('output'))
    const { runClaudeCli } = await import('../cli-runner.js')
    runClaudeCli({ systemPrompt: 'sys', userMessage: 'msg' })
    const [, args] = mockSpawnSync.mock.calls[0] as [string, string[]]
    const modelIdx = args.indexOf('--model')
    expect(args[modelIdx + 1]).toBe('claude-opus-4-6')
  })

  it('uses ANTHROPIC_MODEL env var when options.model is not set', async () => {
    process.env['ANTHROPIC_MODEL'] = 'claude-sonnet-4-6'
    mockSpawnSync.mockReturnValue(makeSuccessResult('output'))
    const { runClaudeCli } = await import('../cli-runner.js')
    runClaudeCli({ systemPrompt: 'sys', userMessage: 'msg' })
    const [, args] = mockSpawnSync.mock.calls[0] as [string, string[]]
    const modelIdx = args.indexOf('--model')
    expect(args[modelIdx + 1]).toBe('claude-sonnet-4-6')
  })

  it('uses options.model when provided', async () => {
    mockSpawnSync.mockReturnValue(makeSuccessResult('output'))
    const { runClaudeCli } = await import('../cli-runner.js')
    runClaudeCli({ systemPrompt: 'sys', userMessage: 'msg', model: 'claude-haiku-4-5-20251001' })
    const [, args] = mockSpawnSync.mock.calls[0] as [string, string[]]
    const modelIdx = args.indexOf('--model')
    expect(args[modelIdx + 1]).toBe('claude-haiku-4-5-20251001')
  })

  it('throws a timeout error when signal is SIGTERM', async () => {
    mockSpawnSync.mockReturnValue(makeTimeoutResult())
    const { runClaudeCli } = await import('../cli-runner.js')
    expect(() =>
      runClaudeCli({ systemPrompt: 'sys', userMessage: 'msg' }),
    ).toThrow('timed out')
  })

  it('throws an auth error when stderr mentions not logged in', async () => {
    mockSpawnSync.mockReturnValue(makeFailResult('Error: not logged in'))
    const { runClaudeCli } = await import('../cli-runner.js')
    expect(() =>
      runClaudeCli({ systemPrompt: 'sys', userMessage: 'msg' }),
    ).toThrow('claude auth login')
  })

  it('throws a generic error for other failures', async () => {
    mockSpawnSync.mockReturnValue(makeFailResult('unexpected error from claude'))
    const { runClaudeCli } = await import('../cli-runner.js')
    expect(() =>
      runClaudeCli({ systemPrompt: 'sys', userMessage: 'msg' }),
    ).toThrow('Claude CLI failed')
  })
})
