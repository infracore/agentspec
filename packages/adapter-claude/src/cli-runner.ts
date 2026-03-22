/**
 * Runs Claude generation via the `claude` CLI using `-p` (print mode).
 *
 * Used when auth mode is 'cli' (subscription users with Claude Pro / Max).
 * The CLI inherits the user's session from their local Claude login.
 *
 * The user message is passed via stdin to avoid OS argument-length limits (ARG_MAX).
 * The system prompt is passed via --system-prompt (Claude CLI handles its own buffering).
 *
 * @module cli-runner
 */

import { spawnSync } from 'node:child_process';

export interface CliRunnerOptions {
  /** System prompt (maps to --system-prompt). */
  systemPrompt: string;
  /** User message / context to pass to Claude. */
  userMessage: string;
  /** Claude model to use. Defaults to claude-opus-4-6. */
  model?: string;
  /** Timeout in ms. Defaults to 300_000 (5 minutes — codegen is slow). */
  timeout?: number;
}

// ── Main runner ───────────────────────────────────────────────────────────────

/**
 * Call Claude CLI with `-p` (print/pipe mode) and return the raw text output.
 *
 * The user message is passed via stdin to avoid ARG_MAX limits.
 * The system prompt is passed inline via --system-prompt.
 *
 * Throws with a descriptive message on any execution failure.
 */
export function runClaudeCli(options: CliRunnerOptions): string {
  const model =
    options.model ?? process.env['ANTHROPIC_MODEL'] ?? 'claude-opus-4-6';
  const timeout = options.timeout ?? 300_000;

  const result = spawnSync(
    'claude',
    [
      '-p',
      '-', // '-' = read prompt from stdin
      '--system-prompt',
      options.systemPrompt,
      '--model',
      model,
      '--output-format',
      'text',
    ],
    {
      input: options.userMessage, // piped to stdin
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
      windowsHide: true,
      encoding: 'utf-8',
      maxBuffer: 32 * 1024 * 1024, // 32 MB
    },
  );

  if (result.error) {
    const iface = result.error as NodeJS.ErrnoException & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      signal?: string;
    };
    const stderr =
      typeof iface.stderr === 'string'
        ? iface.stderr
        : iface.stderr instanceof Buffer
          ? iface.stderr.toString('utf-8')
          : '';
    throwFromDetail(
      stderr.trim(),
      timeout,
      iface.signal ?? undefined,
      result.error,
    );
  }

  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';

  if (result.status !== 0) {
    const detail = stderr.trim() || stdout.trim();
    throwFromDetail(detail, timeout, result.signal ?? undefined);
  }

  return stdout;
}

// ── Error formatting ──────────────────────────────────────────────────────────

function throwFromDetail(
  detail: string,
  timeout: number,
  signal?: string,
  originalErr?: unknown,
): never {
  const lower = detail.toLowerCase();

  if (
    signal === 'SIGTERM' ||
    lower.includes('timed out') ||
    lower.includes('timeout')
  ) {
    throw new Error(
      `Claude CLI timed out after ${Math.floor(timeout / 1000)}s.\n` +
      'For large manifests, set AGENTSPEC_CLAUDE_AUTH_MODE=api to use the API instead.',
    );
  }

  if (
    lower.includes('not logged in') ||
    (lower.includes('auth') && lower.includes('login'))
  ) {
    throw new Error(
      'Claude CLI is not authenticated. Run: claude auth login\n' +
      'Or set ANTHROPIC_API_KEY and AGENTSPEC_CLAUDE_AUTH_MODE=api to use the API.',
    );
  }

  const originalMsg =
    originalErr instanceof Error ? originalErr.message : undefined;
  throw new Error(
    `Claude CLI failed: ${originalMsg ?? 'non-zero exit'}` +
    (detail ? `\n${detail.slice(0, 500)}` : ''),
  );
}
