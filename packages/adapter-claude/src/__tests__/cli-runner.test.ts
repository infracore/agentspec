import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { Writable } from 'node:stream'

// ── Mock child_process before any imports ─────────────────────────────────────
// vi.mock is hoisted to the top of the file, so the factory runs before const
// declarations. Use vi.hoisted to create the mock fn at hoist time.

const mockSpawn = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(), // used by auth.ts
  spawn: mockSpawn,
}))

// Import after mock is set up
import { runClaudeCli } from '../cli-runner.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

interface FakeProc extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: Writable & { chunks: string[] }
  kill: ReturnType<typeof vi.fn>
  // Required by killProc() to determine whether the process is still alive
  exitCode: number | null
  killed: boolean
}

function buildFakeProc(): FakeProc {
  const proc = new EventEmitter() as FakeProc
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.exitCode = null
  proc.killed = false
  proc.kill = vi.fn(() => { proc.killed = true })

  const chunks: string[] = []
  const stdinWritable = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString())
      cb()
    },
  }) as Writable & { chunks: string[] }
  stdinWritable.chunks = chunks
  proc.stdin = stdinWritable as FakeProc['stdin']

  return proc
}

/**
 * Return a mockImplementation that emits stdout/stderr data and a close event
 * via setImmediate — fires AFTER spawn() returns and listeners are attached.
 */
function fakeSpawnImpl(stdout: string, exitCode = 0, stderrText = '') {
  return (): FakeProc => {
    const proc = buildFakeProc()
    setImmediate(() => {
      if (stdout) proc.stdout.emit('data', Buffer.from(stdout))
      if (stderrText) proc.stderr.emit('data', Buffer.from(stderrText))
      proc.emit('close', exitCode, null)
    })
    return proc
  }
}

/** Returns a proc that never emits close (simulates timeout). */
function frozenSpawnImpl(): () => FakeProc {
  return () => buildFakeProc()
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
    mockSpawn.mockImplementation(fakeSpawnImpl('{"files":{"agent.py":"# hello"}}'))
    const result = await runClaudeCli({
      systemPrompt: 'you are a code generator',
      userMessage: 'generate something',
    })
    expect(result).toBe('{"files":{"agent.py":"# hello"}}')
  })

  it('passes userMessage as stdin input', async () => {
    let capturedProc: FakeProc | undefined
    mockSpawn.mockImplementation((): FakeProc => {
      const proc = buildFakeProc()
      capturedProc = proc
      setImmediate(() => proc.emit('close', 0, null))
      return proc
    })
    await runClaudeCli({ systemPrompt: 'sys', userMessage: 'my user message' })
    expect(capturedProc!.stdin.chunks.join('')).toBe('my user message')
  })

  it('calls claude with -p -, --system-prompt, --model, --output-format text', async () => {
    mockSpawn.mockImplementation(fakeSpawnImpl('output'))
    await runClaudeCli({ systemPrompt: 'sys prompt', userMessage: 'msg' })
    expect(mockSpawn).toHaveBeenCalledOnce()
    const [cmd, args] = mockSpawn.mock.calls[0] as [string, string[]]
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
    mockSpawn.mockImplementation(fakeSpawnImpl('output'))
    await runClaudeCli({ systemPrompt: 'sys', userMessage: 'msg' })
    const [, args] = mockSpawn.mock.calls[0] as [string, string[]]
    const modelIdx = args.indexOf('--model')
    expect(args[modelIdx + 1]).toBe('claude-opus-4-6')
  })

  it('uses ANTHROPIC_MODEL env var when options.model is not set', async () => {
    process.env['ANTHROPIC_MODEL'] = 'claude-haiku-4-5-20251001'
    mockSpawn.mockImplementation(fakeSpawnImpl('output'))
    await runClaudeCli({ systemPrompt: 'sys', userMessage: 'msg' })
    const [, args] = mockSpawn.mock.calls[0] as [string, string[]]
    const modelIdx = args.indexOf('--model')
    expect(args[modelIdx + 1]).toBe('claude-haiku-4-5-20251001')
  })

  it('uses options.model when provided', async () => {
    mockSpawn.mockImplementation(fakeSpawnImpl('output'))
    await runClaudeCli({ systemPrompt: 'sys', userMessage: 'msg', model: 'claude-opus-4-6' })
    const [, args] = mockSpawn.mock.calls[0] as [string, string[]]
    const modelIdx = args.indexOf('--model')
    expect(args[modelIdx + 1]).toBe('claude-opus-4-6')
  })

  it('throws a timeout error when the process does not close within the timeout', async () => {
    vi.useFakeTimers()
    let capturedProc: FakeProc | undefined
    mockSpawn.mockImplementation((): FakeProc => {
      capturedProc = buildFakeProc()
      return capturedProc
    })
    const p = runClaudeCli({ systemPrompt: 'sys', userMessage: 'msg', timeout: 1000 })
    // Advance past the 1s timeout, then past killProc's 3s SIGKILL fallback
    vi.advanceTimersByTime(1001)
    vi.advanceTimersByTime(3001)
    await expect(p).rejects.toThrow('timed out')
    expect(capturedProc!.kill).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('throws an auth error when stderr mentions not logged in', async () => {
    mockSpawn.mockImplementation(fakeSpawnImpl('', 1, 'Error: not logged in'))
    await expect(
      runClaudeCli({ systemPrompt: 'sys', userMessage: 'msg' }),
    ).rejects.toThrow('claude auth login')
  })

  it('throws a generic error for other failures', async () => {
    mockSpawn.mockImplementation(fakeSpawnImpl('', 1, 'unexpected error from claude'))
    await expect(
      runClaudeCli({ systemPrompt: 'sys', userMessage: 'msg' }),
    ).rejects.toThrow('Claude CLI failed')
  })

  it('throws ENOENT error when claude binary is not found', async () => {
    let capturedProc: FakeProc | undefined
    mockSpawn.mockImplementation((): FakeProc => {
      capturedProc = buildFakeProc()
      return capturedProc
    })
    const p = runClaudeCli({ systemPrompt: 'sys', userMessage: 'msg' })
    const err = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })
    capturedProc!.emit('error', err)
    await expect(p).rejects.toThrow('claude CLI not found on PATH')
  })

  it('throws quota error immediately when stderr signals usage limit reached', async () => {
    mockSpawn.mockImplementation(fakeSpawnImpl('', 1, 'Error: usage limit reached for claude-opus-4-6'))
    await expect(
      runClaudeCli({ systemPrompt: 'sys', userMessage: 'msg' }),
    ).rejects.toThrow('quota exceeded')
  })

  it('kills the child process and rejects when parent receives SIGINT', async () => {
    let capturedProc: FakeProc | undefined
    mockSpawn.mockImplementation((): FakeProc => {
      capturedProc = buildFakeProc()
      return capturedProc
    })
    const p = runClaudeCli({ systemPrompt: 'sys', userMessage: 'msg' })
    // Simulate parent SIGINT before process finishes
    process.emit('SIGINT')
    await expect(p).rejects.toThrow('cancelled')
    expect(capturedProc!.kill).toHaveBeenCalled()
  })
})
