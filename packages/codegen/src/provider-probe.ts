/**
 * Rich diagnostic probe for codegen provider availability.
 *
 * Used by `agentspec provider-status` to display detailed info about
 * all available codegen providers (Claude subscription, Anthropic API, Codex).
 */

import { execFileSync } from 'node:child_process'
import { resolveProvider } from './resolver.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ClaudeCliProbe {
  installed: boolean
  version: string | null
  authenticated: boolean
  authStatusRaw: string | null
  accountEmail: string | null
  plan: string | null
  activeModel: string | null
}

export interface AnthropicApiProbe {
  keySet: boolean
  keyPreview: string | null
  baseURLSet: boolean
  baseURL: string | null
  keyValid: boolean | null
  probeStatus: number | null
  probeError: string | null
}

export interface ProviderEnvProbe {
  providerOverride: string | null
  modelOverride: string | null
  resolvedProvider: string | null
  resolveError: string | null
}

export interface ProviderProbeReport {
  claudeCli: ClaudeCliProbe
  anthropicApi: AnthropicApiProbe
  env: ProviderEnvProbe
}

// ── Internal helpers ──────────────────────────────────────────────────────────

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

function isClaudeAuthenticated(): boolean {
  try {
    const raw = execFileSync('claude', ['auth', 'status'], {
      stdio: 'pipe',
      timeout: 4000,
      windowsHide: true,
      encoding: 'utf-8',
    })
    const rawStr = typeof raw === 'string' ? raw : ''

    if (rawStr.trimStart().startsWith('{') || rawStr.trimStart().startsWith('[')) {
      try {
        const parsed = JSON.parse(rawStr)
        const loggedIn = extractLoggedIn(parsed)
        if (loggedIn !== undefined) return loggedIn
      } catch {
        // fall through to text-based checks
      }
    }

    const lower = rawStr.toLowerCase()
    if (lower.includes('not logged in') || lower.includes('login required')) return false
    return true
  } catch {
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
    const stderr =
      err instanceof Error && 'stderr' in err
        ? String((err as NodeJS.ErrnoException & { stderr?: unknown }).stderr ?? '')
        : ''
    return stderr.trim() || null
  }
}

function parseEmail(raw: string): string | null {
  const emailMatch = raw.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)
  return emailMatch?.[0] ?? null
}

function parsePlan(raw: string): string | null {
  const lower = raw.toLowerCase()
  if (lower.includes('max')) return 'Claude Max'
  if (lower.includes('pro')) return 'Claude Pro'
  if (lower.includes('free')) return 'Free'
  if (lower.includes('team')) return 'Team'
  if (lower.includes('enterprise')) return 'Enterprise'
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const plan = parsed['plan'] ?? parsed['subscription'] ?? parsed['tier']
    if (typeof plan === 'string') return plan
  } catch { /* not JSON */ }
  return null
}

function parseActiveModel(raw: string): string | null {
  const modelMatch = raw.match(/claude-[a-z0-9\-]+/i)
  if (modelMatch?.[0]) return modelMatch[0]
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const model = parsed['model'] ?? parsed['defaultModel'] ?? parsed['activeModel']
    if (typeof model === 'string') return model
  } catch { /* not JSON */ }
  return null
}

async function probeAnthropicKey(apiKey: string, baseURL?: string): Promise<{
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

// ── Public ────────────────────────────────────────────────────────────────────

/**
 * Collect diagnostic information about all available codegen providers.
 * Never throws — all errors are captured in the report.
 */
export async function probeProviders(): Promise<ProviderProbeReport> {
  // ── Claude CLI probe ─────────────────────────────────────────────────────
  const installed = isClaudeOnPath()
  const versionRaw = installed ? probeVersion() : null
  const authStatusRaw = installed ? probeAuthStatus() : null
  const authenticated = installed ? isClaudeAuthenticated() : false

  const claudeCli: ClaudeCliProbe = {
    installed,
    version: versionRaw,
    authenticated,
    authStatusRaw,
    accountEmail: authStatusRaw ? parseEmail(authStatusRaw) : null,
    plan: authStatusRaw ? parsePlan(authStatusRaw) : null,
    activeModel: authStatusRaw ? parseActiveModel(authStatusRaw) : null,
  }

  // ── Anthropic API probe ──────────────────────────────────────────────────
  const apiKey = process.env['ANTHROPIC_API_KEY'] ?? null
  const baseURL = process.env['ANTHROPIC_BASE_URL'] ?? null
  let keyValid: boolean | null = null
  let probeStatus: number | null = null
  let probeError: string | null = null

  if (apiKey) {
    const result = await probeAnthropicKey(apiKey, baseURL ?? undefined)
    keyValid = result.valid
    probeStatus = result.status
    probeError = result.error
  }

  const anthropicApi: AnthropicApiProbe = {
    keySet: !!apiKey,
    keyPreview: apiKey ? `${apiKey.slice(0, 4)}…${apiKey.slice(-2)}` : null,
    baseURLSet: !!baseURL,
    baseURL,
    keyValid,
    probeStatus,
    probeError,
  }

  // ── Env probe (uses codegen resolver) ──────────────────────────────────────
  const providerOverride = process.env['AGENTSPEC_CODEGEN_PROVIDER'] ?? null
  const modelOverride = process.env['ANTHROPIC_MODEL'] ?? null

  let resolvedProvider: string | null = null
  let resolveError: string | null = null
  try {
    const provider = resolveProvider()
    resolvedProvider = provider.name
  } catch (err) {
    resolveError = err instanceof Error ? err.message : String(err)
  }

  const env: ProviderEnvProbe = {
    providerOverride,
    modelOverride,
    resolvedProvider,
    resolveError,
  }

  return { claudeCli, anthropicApi, env }
}
