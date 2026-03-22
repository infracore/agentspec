/**
 * Claude auth mode resolver for AgentSpec.
 *
 * Priority (when AGENTSPEC_CLAUDE_AUTH_MODE is not set):
 *   1. CLI  — if `claude` binary is present + authenticated (subscription users)
 *   2. API  — if ANTHROPIC_API_KEY is set
 *
 * Override with: AGENTSPEC_CLAUDE_AUTH_MODE=cli | api | auto
 *
 * @module auth
 */

import { execFileSync } from 'node:child_process'

// ── Types ─────────────────────────────────────────────────────────────────────

export type AuthMode = 'cli' | 'api'

export interface AuthResolution {
  /** Resolved mode to use. */
  readonly mode: AuthMode
  /** API key when mode is 'api'. Undefined for 'cli'. */
  readonly apiKey?: string
  /** Optional base URL override for api mode (from ANTHROPIC_BASE_URL). */
  readonly baseURL?: string
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Returns true if the `claude` CLI is on PATH. */
function isClaudeOnPath(): boolean {
  try {
    execFileSync('claude', ['--version'], {
      stdio: 'pipe',
      timeout: 4000,
      windowsHide: true,
    })
    return true
  } catch {
    return false
  }
}

/** Returns true if `claude auth status` reports the user is logged in. */
function isClaudeAuthenticated(): boolean {
  try {
    const raw = execFileSync('claude', ['auth', 'status'], {
      stdio: 'pipe',
      timeout: 4000,
      windowsHide: true,
      encoding: 'utf-8',
    })
    const rawStr = typeof raw === 'string' ? raw : ''

    // `claude auth status` exits 0 and returns JSON with loggedIn: true when authenticated.
    // Parse the original string (before any lowercasing) so key names like "loggedIn" are preserved.
    if (rawStr.trimStart().startsWith('{') || rawStr.trimStart().startsWith('[')) {
      try {
        const parsed = JSON.parse(rawStr)
        const loggedIn = extractLoggedIn(parsed)
        if (loggedIn !== undefined) return loggedIn
      } catch {
        // fall through to text-based checks
      }
    }

    // Text-based heuristics (only lowercase for these checks)
    const lower = rawStr.toLowerCase()
    if (lower.includes('not logged in') || lower.includes('login required')) {
      return false
    }

    // If command exited 0 and has no explicit "not logged in" signal, treat as authenticated
    return true
  } catch {
    // Non-zero exit or subprocess failure = not authenticated
    return false
  }
}

function extractLoggedIn(value: unknown): boolean | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = extractLoggedIn(entry)
      if (nested !== undefined) return nested
    }
    return undefined
  }
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  for (const key of ['loggedIn', 'isLoggedIn', 'authenticated', 'isAuthenticated'] as const) {
    if (typeof record[key] === 'boolean') return record[key]
  }
  for (const key of ['auth', 'status', 'session', 'account'] as const) {
    const nested = extractLoggedIn(record[key])
    if (nested !== undefined) return nested
  }
  return undefined
}

// ── Public helpers ────────────────────────────────────────────────────────────

/**
 * Returns true when the `claude` CLI is available and the user is logged in.
 * Used by commands to show status messages before calling resolveAuth.
 */
export function isCliAvailable(): boolean {
  return isClaudeOnPath() && isClaudeAuthenticated()
}

// ── Rich probe ────────────────────────────────────────────────────────────────

export interface ClaudeCliProbe {
  /** Whether the `claude` binary was found on PATH. */
  installed: boolean
  /** Raw output of `claude --version`, or null if not installed. */
  version: string | null
  /** Whether `claude auth status` confirmed the user is logged in. */
  authenticated: boolean
  /** Raw output of `claude auth status`, or null if not installed. */
  authStatusRaw: string | null
  /** Account email parsed from auth status output, if detectable. */
  accountEmail: string | null
  /** Subscription plan parsed from auth status output, if detectable. */
  plan: string | null
  /** Active model reported by CLI, if detectable. */
  activeModel: string | null
}

export interface ClaudeApiProbe {
  /** Whether ANTHROPIC_API_KEY is set. */
  keySet: boolean
  /** Masked key showing first 4 chars + '…' + last 2 chars, or null if not set. */
  keyPreview: string | null
  /** Whether ANTHROPIC_BASE_URL is set. */
  baseURLSet: boolean
  /** The base URL value, or null. */
  baseURL: string | null
  /** Whether the key was accepted by the Anthropic models endpoint (HTTP 200). */
  keyValid: boolean | null
  /** HTTP status code from the models endpoint probe, or null if not probed. */
  probeStatus: number | null
  /** Error message from the probe, or null. */
  probeError: string | null
}

export interface ClaudeEnvProbe {
  /** Value of AGENTSPEC_CLAUDE_AUTH_MODE, or null if not set. */
  authModeOverride: string | null
  /** Value of ANTHROPIC_MODEL, or null. */
  modelOverride: string | null
  /** Resolved auth mode that would be used right now (or error message). */
  resolvedMode: 'cli' | 'api' | 'none'
  /** Error message if neither auth method is available. */
  resolveError: string | null
}

export interface ClaudeProbeReport {
  cli: ClaudeCliProbe
  api: ClaudeApiProbe
  env: ClaudeEnvProbe
}

/** Run `claude --version` and return raw output, or null. */
function probeVersion(): string | null {
  try {
    const out = execFileSync('claude', ['--version'], {
      stdio: 'pipe',
      timeout: 4000,
      windowsHide: true,
      encoding: 'utf-8',
    })
    return typeof out === 'string' ? out.trim() : null
  } catch {
    return null
  }
}

/** Run `claude auth status` and return raw output, or null. */
function probeAuthStatus(): string | null {
  try {
    const out = execFileSync('claude', ['auth', 'status'], {
      stdio: 'pipe',
      timeout: 4000,
      windowsHide: true,
      encoding: 'utf-8',
    })
    return typeof out === 'string' ? out.trim() : null
  } catch (err: unknown) {
    // Even on non-zero exit, capture stderr as the status output
    const stderr =
      err instanceof Error && 'stderr' in err
        ? String((err as NodeJS.ErrnoException & { stderr?: unknown }).stderr ?? '')
        : ''
    return stderr.trim() || null
  }
}

/** Try to extract an email from `claude auth status` output. */
function parseEmail(raw: string): string | null {
  const emailMatch = raw.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)
  return emailMatch?.[0] ?? null
}

/** Try to extract a plan name from `claude auth status` output. */
function parsePlan(raw: string): string | null {
  const lower = raw.toLowerCase()
  if (lower.includes('max')) return 'Claude Max'
  if (lower.includes('pro')) return 'Claude Pro'
  if (lower.includes('free')) return 'Free'
  if (lower.includes('team')) return 'Team'
  if (lower.includes('enterprise')) return 'Enterprise'
  // Try JSON
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const plan = parsed['plan'] ?? parsed['subscription'] ?? parsed['tier']
    if (typeof plan === 'string') return plan
  } catch { /* not JSON */ }
  return null
}

/** Try to extract the active model from `claude auth status` or a separate call. */
function parseActiveModel(raw: string): string | null {
  // Look for model mentions in the output
  const modelMatch = raw.match(/claude-[a-z0-9\-]+/i)
  if (modelMatch?.[0]) return modelMatch[0]
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const model = parsed['model'] ?? parsed['defaultModel'] ?? parsed['activeModel']
    if (typeof model === 'string') return model
  } catch { /* not JSON */ }
  return null
}

/** Probe the Anthropic API key by hitting the models endpoint. */
async function probeApiKey(apiKey: string, baseURL?: string): Promise<{
  valid: boolean
  status: number | null
  error: string | null
}> {
  const base = baseURL ?? 'https://api.anthropic.com'
  const url = `${base.replace(/\/$/, '')}/v1/models`
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(6000),
    })
    return { valid: res.ok, status: res.status, error: res.ok ? null : `HTTP ${res.status}` }
  } catch (err) {
    return { valid: false, status: null, error: String(err) }
  }
}

/**
 * Collect maximum information about the Claude auth environment.
 * Never throws — all errors are captured in the report.
 */
export async function probeClaudeAuth(): Promise<ClaudeProbeReport> {
  // ── CLI probe ──────────────────────────────────────────────────────────────
  const installed = isClaudeOnPath()
  const versionRaw = installed ? probeVersion() : null
  const authStatusRaw = installed ? probeAuthStatus() : null
  const authenticated = installed ? isClaudeAuthenticated() : false

  const cliProbe: ClaudeCliProbe = {
    installed,
    version: versionRaw,
    authenticated,
    authStatusRaw,
    accountEmail: authStatusRaw ? parseEmail(authStatusRaw) : null,
    plan: authStatusRaw ? parsePlan(authStatusRaw) : null,
    activeModel: authStatusRaw ? parseActiveModel(authStatusRaw) : null,
  }

  // ── API probe ──────────────────────────────────────────────────────────────
  const apiKey = process.env['ANTHROPIC_API_KEY'] ?? null
  const baseURL = process.env['ANTHROPIC_BASE_URL'] ?? null
  let keyValid: boolean | null = null
  let probeStatus: number | null = null
  let probeError: string | null = null

  if (apiKey) {
    const result = await probeApiKey(apiKey, baseURL ?? undefined)
    keyValid = result.valid
    probeStatus = result.status
    probeError = result.error
  }

  const apiProbe: ClaudeApiProbe = {
    keySet: !!apiKey,
    keyPreview: apiKey ? `${apiKey.slice(0, 4)}…${apiKey.slice(-2)}` : null,
    baseURLSet: !!baseURL,
    baseURL,
    keyValid,
    probeStatus,
    probeError,
  }

  // ── Env probe ──────────────────────────────────────────────────────────────
  const authModeOverride = process.env['AGENTSPEC_CLAUDE_AUTH_MODE'] ?? null
  const modelOverride = process.env['ANTHROPIC_MODEL'] ?? null

  let resolvedMode: 'cli' | 'api' | 'none' = 'none'
  let resolveError: string | null = null
  try {
    const resolved = resolveAuth()
    resolvedMode = resolved.mode
  } catch (err) {
    resolveError = err instanceof Error ? err.message : String(err)
  }

  const envProbe: ClaudeEnvProbe = {
    authModeOverride,
    modelOverride,
    resolvedMode,
    resolveError,
  }

  return { cli: cliProbe, api: apiProbe, env: envProbe }
}

/**
 * Resolve which Claude auth mode to use.
 *
 * Throws with a combined remediation message when neither mode is available.
 */
export function resolveAuth(): AuthResolution {
  const override = (process.env['AGENTSPEC_CLAUDE_AUTH_MODE'] ?? '').toLowerCase().trim()

  // ── Explicit override ──────────────────────────────────────────────────────
  if (override === 'cli') {
    if (!isClaudeOnPath()) {
      throw new Error(
        'AGENTSPEC_CLAUDE_AUTH_MODE=cli but claude CLI is not installed or not on PATH.\n' +
          'Install it from https://claude.ai/download or remove the override to use API mode.',
      )
    }
    if (!isClaudeAuthenticated()) {
      throw new Error(
        'AGENTSPEC_CLAUDE_AUTH_MODE=cli but claude is not authenticated.\n' +
          'Run: claude auth login\n' +
          'Or remove the override to fall back to API mode.',
      )
    }
    return { mode: 'cli' }
  }

  if (override === 'api') {
    const apiKey = process.env['ANTHROPIC_API_KEY']
    if (!apiKey) {
      throw new Error(
        'AGENTSPEC_CLAUDE_AUTH_MODE=api but ANTHROPIC_API_KEY is not set.\n' +
          'Get a key at https://console.anthropic.com or remove the override to try CLI mode.',
      )
    }
    const baseURL = process.env['ANTHROPIC_BASE_URL']
    return { mode: 'api', apiKey, ...(baseURL ? { baseURL } : {}) }
  }

  // ── Auto mode (CLI first) ──────────────────────────────────────────────────
  // 1. Try CLI
  if (isClaudeOnPath() && isClaudeAuthenticated()) {
    return { mode: 'cli' }
  }

  // 2. Try API key
  const apiKey = process.env['ANTHROPIC_API_KEY']
  if (apiKey) {
    const baseURL = process.env['ANTHROPIC_BASE_URL']
    return { mode: 'api', apiKey, ...(baseURL ? { baseURL } : {}) }
  }

  // 3. Neither — throw with combined instructions
  throw new Error(
    'No Claude authentication found. AgentSpec supports two methods:\n\n' +
      '  Option 1 — Claude subscription (Pro / Max):\n' +
      '    Install the Claude CLI:  https://claude.ai/download\n' +
      '    Then authenticate:       claude auth login\n\n' +
      '  Option 2 — Anthropic API key:\n' +
      '    Get a key at:  https://console.anthropic.com\n' +
      '    Then set:      export ANTHROPIC_API_KEY=<your-key>\n\n' +
      'To force a specific mode: export AGENTSPEC_CLAUDE_AUTH_MODE=cli  (or api)',
  )
}
