/**
 * Runs Claude generation via the `claude` CLI using `-p` (print mode).
 *
 * Used when auth mode is 'cli' (subscription users with Claude Pro / Max).
 * The CLI inherits the user's session from their local Claude login.
 *
 * Both the user message and system prompt are written to temp files and
 * passed via file paths / stdin to avoid OS argument-length limits (ARG_MAX).
 *
 * @module cli-runner
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export interface CliRunnerOptions {
  /** System prompt (maps to --system-prompt). */
  systemPrompt: string
  /** User message / context to pass to Claude. */
  userMessage: string
  /** Claude model to use. Defaults to claude-opus-4-6. */
  model?: string
  /** Timeout in ms. Defaults to 300_000 (5 minutes — codegen is slow). */
  timeout?: number
}

// ── Temp file helpers ─────────────────────────────────────────────────────────

function writeTempFile(prefix: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), `agentspec-${prefix}-`))
  const path = join(dir, 'content.txt')
  writeFileSync(path, content, 'utf-8')
  return path
}

function cleanupTempFile(path: string): void {
  try { unlinkSync(path) } catch { /* best-effort */ }
  try {
    const dir = path.replace(/\/content\.txt$/, '')
    unlinkSync(dir)
  } catch { /* best-effort */ }
}

// ── Main runner ───────────────────────────────────────────────────────────────

/**
 * Call Claude CLI with `-p` (print/pipe mode) and return the raw text output.
 *
 * The user message is passed via stdin. The system prompt is passed via
 * --system-prompt with its content written to a temp file read by the shell.
 *
 * Throws with a descriptive message on any execution failure.
 */
export function runClaudeCli(options: CliRunnerOptions): string {
  const model = options.model ?? process.env['ANTHROPIC_MODEL'] ?? 'claude-opus-4-6'
  const timeout = options.timeout ?? 300_000

  // Write system prompt to a temp file to avoid ARG_MAX limits
  const systemPromptPath = writeTempFile('sys', options.systemPrompt)

  try {
    // Pass user message via stdin; system prompt via --system-prompt flag
    const result = spawnSync(
      'claude',
      [
        '-p', '-',                         // '-' = read prompt from stdin
        '--system-prompt', options.systemPrompt,
        '--model', model,
        '--output-format', 'text',
      ],
      {
        input: options.userMessage,        // piped to stdin
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout,
        windowsHide: true,
        encoding: 'utf-8',
        maxBuffer: 32 * 1024 * 1024,      // 32 MB
      },
    )

    cleanupTempFile(systemPromptPath)

    if (result.error) {
      throw result.error
    }

    const stderr = typeof result.stderr === 'string' ? result.stderr : ''
    const stdout = typeof result.stdout === 'string' ? result.stdout : ''

    if (result.status !== 0) {
      const detail = stderr.trim() || stdout.trim()
      throwFromDetail(detail, timeout, result.signal ?? undefined)
    }

    return stdout
  } catch (err: unknown) {
    cleanupTempFile(systemPromptPath)

    // Re-throw errors already formatted by throwFromDetail
    if (err instanceof Error && (
      err.message.includes('timed out') ||
      err.message.includes('claude auth login') ||
      err.message.includes('Claude CLI failed')
    )) {
      throw err
    }

    const iface = err as NodeJS.ErrnoException & {
      stdout?: string | Buffer
      stderr?: string | Buffer
      signal?: string
      killed?: boolean
    }

    const stderr =
      typeof iface.stderr === 'string' ? iface.stderr
        : iface.stderr instanceof Buffer ? iface.stderr.toString('utf-8')
          : ''
    const stdout =
      typeof iface.stdout === 'string' ? iface.stdout
        : iface.stdout instanceof Buffer ? iface.stdout.toString('utf-8')
          : ''

    throwFromDetail(stderr.trim() || stdout.trim(), timeout, iface.signal ?? undefined, iface)
  }
}

// ── Error formatting ──────────────────────────────────────────────────────────

function throwFromDetail(
  detail: string,
  timeout: number,
  signal?: string,
  originalErr?: unknown,
): never {
  const lower = detail.toLowerCase()

  if (signal === 'SIGTERM' || lower.includes('timed out') || lower.includes('timeout')) {
    throw new Error(
      `Claude CLI timed out after ${Math.floor(timeout / 1000)}s.\n` +
        'For large manifests, set AGENTSPEC_CLAUDE_AUTH_MODE=api to use the API instead.',
    )
  }

  if (lower.includes('not logged in') || (lower.includes('auth') && lower.includes('login'))) {
    throw new Error(
      'Claude CLI is not authenticated. Run: claude auth login\n' +
        'Or set ANTHROPIC_API_KEY and AGENTSPEC_CLAUDE_AUTH_MODE=api to use the API.',
    )
  }

  const originalMsg = originalErr instanceof Error ? originalErr.message : undefined
  throw new Error(
    `Claude CLI failed: ${originalMsg ?? 'non-zero exit'}` +
      (detail ? `\n${detail.slice(0, 500)}` : ''),
  )
}
