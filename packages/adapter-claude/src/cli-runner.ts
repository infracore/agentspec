/**
 * Runs Claude generation via the `claude` CLI using `-p` (print mode).
 *
 * Used when auth mode is 'cli' (subscription users with Claude Pro / Max).
 * The CLI inherits the user's session from their local Claude login.
 *
 * The user message is passed via stdin to avoid OS argument-length limits (ARG_MAX).
 * The system prompt is passed via --system-prompt (Claude CLI handles its own buffering).
 *
 * Uses async `spawn` (not `spawnSync`) so the Node.js event loop stays alive
 * during generation — this keeps the CLI spinner animating and avoids the
 * queued-setInterval-flush that printed stacked blank frames with `spawnSync`.
 *
 * @module cli-runner
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type { GenerationProgress } from './index.js';

export interface CliRunnerOptions {
  /** System prompt (maps to --system-prompt). */
  systemPrompt: string;
  /** User message / context to pass to Claude. */
  userMessage: string;
  /** Claude model to use. Defaults to claude-opus-4-6. */
  model?: string;
  /** Timeout in ms. Defaults to 300_000 (5 minutes — codegen is slow). */
  timeout?: number;
  /**
   * Called on each stdout chunk or every 5s with cumulative char count,
   * elapsed seconds, and the latest stderr line (useful for debugging stalls).
   */
  onProgress?: (progress: GenerationProgress) => void;
}

// ── Quota / rate-limit patterns emitted by the Claude CLI ─────────────────────

const QUOTA_PATTERNS = [
  'usage limit reached',
  'quota exceeded',
  'rate limit',
  'too many requests',
  'daily limit',
  'monthly limit',
  'you have reached',
  'limit has been reached',
  'upgrade your plan',
  'exceeded your',
  'allowance',
] as const;

function isQuotaError(text: string): boolean {
  const lower = text.toLowerCase();
  return QUOTA_PATTERNS.some((p) => lower.includes(p));
}

// ── Process teardown ──────────────────────────────────────────────────────────

/**
 * Kill a child process cleanly: SIGTERM first, then SIGKILL after 3s if it
 * hasn't exited. Returns immediately — the caller does not need to await.
 *
 * Using SIGKILL fallback ensures `claude` never lingers as a zombie when the
 * process ignores SIGTERM (e.g. during quota-error handling on some platforms).
 */
function killProc(proc: ChildProcess): void {
  if (proc.exitCode !== null || proc.killed) return;
  try {
    proc.kill('SIGTERM');
  } catch {
    // Already gone — no-op
    return;
  }
  const forceKill = setTimeout(() => {
    if (proc.exitCode === null && !proc.killed) {
      try { proc.kill('SIGKILL'); } catch { /* already gone */ }
    }
  }, 3_000);
  // Don't block Node exit waiting for this timer
  forceKill.unref();
}

// ── Main runner ───────────────────────────────────────────────────────────────

/**
 * Call Claude CLI with `-p` (print/pipe mode) and return the raw text output.
 *
 * Guarantees:
 * - The child process is always killed on error, timeout, or parent SIGINT/SIGTERM.
 * - All timers are cleared before the promise settles — no leaks.
 * - `settled` gate prevents double-resolve/reject in all edge cases.
 * - stderr is capped at 4 KB to prevent unbounded memory growth.
 *
 * Throws with a descriptive message on any execution failure.
 */
export async function runClaudeCli(options: CliRunnerOptions): Promise<string> {
  const model =
    options.model ?? process.env['ANTHROPIC_MODEL'] ?? 'claude-opus-4-6';
  const timeoutMs = options.timeout ?? 300_000;
  const startMs = Date.now();

  return new Promise<string>((resolve, reject) => {
    const proc = spawn(
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
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    let stdout = '';
    // Cap stderr at 4 KB — we only need the tail for diagnostics, not the full stream.
    const STDERR_CAP = 4 * 1024;
    let stderrBuf = '';
    let settled = false;

    // ── Timers — declared before use in settle() ─────────────────────────────
    const timer = setTimeout(() => {
      settle('reject', buildError('SIGTERM', timeoutMs, 'SIGTERM'));
    }, timeoutMs);
    // Don't block Node exit if the process exits normally before the timeout fires
    timer.unref();

    const ticker = setInterval(() => {
      if (!settled) {
        options.onProgress?.({
          outputChars: stdout.length,
          elapsedSec: Math.floor((Date.now() - startMs) / 1000),
          stderrTail: stderrBuf.slice(-200).trim(),
        });
      }
    }, 5_000);
    ticker.unref();

    // ── Single settle gate — all paths go through here ────────────────────────
    function settle(outcome: 'resolve', value: string): void;
    function settle(outcome: 'reject', err: Error): void;
    function settle(outcome: 'resolve' | 'reject', valueOrErr: string | Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(ticker);
      removeSignalListeners();
      killProc(proc);
      if (outcome === 'resolve') {
        resolve(valueOrErr as string);
      } else {
        reject(valueOrErr as Error);
      }
    }

    // ── Parent signal forwarding — kill child on Ctrl+C or SIGTERM ────────────
    // Without this, hitting Ctrl+C leaves `claude` running as an orphan.
    function onParentSignal(): void {
      settle('reject', new Error('Generation cancelled (parent process received signal).'));
    }
    process.once('SIGINT', onParentSignal);
    process.once('SIGTERM', onParentSignal);

    function removeSignalListeners(): void {
      process.off('SIGINT', onParentSignal);
      process.off('SIGTERM', onParentSignal);
    }

    // ── stdout ────────────────────────────────────────────────────────────────
    proc.stdout.on('data', (chunk: Buffer) => {
      if (settled) return;
      stdout += chunk.toString('utf-8');
      options.onProgress?.({
        outputChars: stdout.length,
        elapsedSec: Math.floor((Date.now() - startMs) / 1000),
        stderrTail: stderrBuf.slice(-200).trim(),
      });
    });

    // ── stderr ────────────────────────────────────────────────────────────────
    proc.stderr.on('data', (chunk: Buffer) => {
      if (settled) return;
      const text = chunk.toString('utf-8');
      // Cap stderr buffer to STDERR_CAP to prevent unbounded growth
      stderrBuf = (stderrBuf + text).slice(-STDERR_CAP);

      options.onProgress?.({
        outputChars: stdout.length,
        elapsedSec: Math.floor((Date.now() - startMs) / 1000),
        stderrTail: stderrBuf.slice(-200).trim(),
      });

      // Fail fast on quota/rate-limit — don't hang until timeout
      if (isQuotaError(text)) {
        settle('reject', buildError(text.trim(), timeoutMs, undefined));
      }
    });

    // ── Process error (spawn failure, ENOENT, etc.) ───────────────────────────
    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        settle('reject', new Error(
          'claude CLI not found on PATH.\n' +
          'Install it from https://claude.ai/download or use AGENTSPEC_CLAUDE_AUTH_MODE=api.',
        ));
      } else {
        settle('reject', new Error(`Claude CLI spawn error: ${err.message}`));
      }
    });

    // ── Process exit ──────────────────────────────────────────────────────────
    proc.on('close', (code: number | null, signal: string | null) => {
      if (settled) return;
      if (signal !== null) {
        // Killed externally (not by us — we set `settled` before killing)
        settle('reject', buildError(`Killed by signal ${signal}`, timeoutMs, signal));
        return;
      }
      if (code !== 0) {
        const detail = stderrBuf.trim() || stdout.trim();
        settle('reject', buildError(detail, timeoutMs, undefined));
        return;
      }
      settle('resolve', stdout);
    });

    // ── stdin ─────────────────────────────────────────────────────────────────
    proc.stdin.write(options.userMessage, 'utf-8');
    proc.stdin.end();
  });
}

// ── Error formatting ──────────────────────────────────────────────────────────

function buildError(detail: string, timeout: number, signal?: string): Error {
  const lower = detail.toLowerCase();

  if (
    signal === 'SIGTERM' ||
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    lower.includes('etimedout')
  ) {
    return new Error(
      `Claude CLI timed out after ${Math.floor(timeout / 1000)}s.\n` +
      'For large manifests, set AGENTSPEC_CLAUDE_AUTH_MODE=api to use the API instead.',
    );
  }

  if (isQuotaError(lower)) {
    return new Error(
      `Claude CLI quota exceeded — daily/monthly limit reached.\n` +
      `${detail.slice(0, 300)}\n\n` +
      'Options:\n' +
      '  1. Wait until your quota resets (usually midnight UTC)\n' +
      '  2. Use the API instead: export AGENTSPEC_CLAUDE_AUTH_MODE=api ANTHROPIC_API_KEY=<key>',
    );
  }

  if (
    lower.includes('not logged in') ||
    (lower.includes('auth') && lower.includes('login'))
  ) {
    return new Error(
      'Claude CLI is not authenticated. Run: claude auth login\n' +
      'Or set ANTHROPIC_API_KEY and AGENTSPEC_CLAUDE_AUTH_MODE=api to use the API.',
    );
  }

  return new Error(`Claude CLI failed: ${detail.slice(0, 500) || 'non-zero exit'}`);
}

