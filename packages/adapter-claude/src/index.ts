/**
 * @agentspec/adapter-claude
 *
 * DEPRECATED — use @agentspec/codegen instead.
 *
 * This package is a backwards-compatibility shim that re-exports from
 * @agentspec/codegen. All new code should import from @agentspec/codegen directly.
 *
 * Migration guide:
 *   generateWithClaude(manifest, opts)  →  generateCode(manifest, opts)
 *   resolveAuth()                       →  resolveProvider()
 *   listFrameworks()                    →  listFrameworks()  (same name)
 *   repairYaml(yaml, errors)            →  repairYaml(provider, yaml, errors)
 */

import type { AgentSpecManifest, GeneratedAgent } from '@agentspec/sdk'
import {
  generateCode,
  resolveProvider,
  listFrameworks as _listFrameworks,
  repairYaml as _repairYaml,
  CodegenError,
  type CodegenProvider,
  type CodegenChunk,
  type CodegenOptions,
} from '@agentspec/codegen'

// ── Deprecation warning (once per process) ───────────────────────────────────

let warned = false
function warnDeprecated(fn: string): void {
  if (warned) return
  warned = true
  console.warn(
    `[@agentspec/adapter-claude] DEPRECATED: ${fn}() is deprecated. ` +
      `Migrate to @agentspec/codegen. See https://agentspec.io/docs/concepts/adapters`,
  )
}

// ── Re-exported types ────────────────────────────────────────────────────────

/** @deprecated Use CodegenOptions from @agentspec/codegen */
export interface ClaudeAdapterOptions {
  framework: string
  model?: string
  manifestDir?: string
  contextFiles?: string[]
  provider?: CodegenProvider
  onChunk?: (chunk: CodegenChunk) => void
}

/** @deprecated Use CodegenChunk from @agentspec/codegen */
export type GenerationProgress = CodegenChunk

/** @deprecated Use AuthResolution from @agentspec/codegen's resolveProvider() */
export interface AuthResolution {
  mode: 'cli' | 'api'
  provider: CodegenProvider
}

// ── Re-exported functions ────────────────────────────────────────────────────

/**
 * @deprecated Use `generateCode()` from `@agentspec/codegen`
 */
export async function generateWithClaude(
  manifest: AgentSpecManifest,
  options: ClaudeAdapterOptions,
): Promise<GeneratedAgent> {
  warnDeprecated('generateWithClaude')
  return generateCode(manifest, options)
}

/**
 * @deprecated Use `resolveProvider()` from `@agentspec/codegen`
 */
export function resolveAuth(): AuthResolution {
  warnDeprecated('resolveAuth')
  const provider = resolveProvider()
  const mode = provider.name === 'claude-subscription' ? 'cli' : 'api'
  return { mode, provider }
}

/**
 * @deprecated Use `listFrameworks()` from `@agentspec/codegen`
 */
export function listFrameworks(): string[] {
  warnDeprecated('listFrameworks')
  return _listFrameworks()
}

/**
 * @deprecated Use `repairYaml(provider, yaml, errors)` from `@agentspec/codegen`
 *
 * Note: the new API requires passing a provider as the first argument.
 * This shim auto-resolves a provider for backwards compatibility.
 */
export async function repairYaml(
  yamlStr: string,
  validationErrors: string,
): Promise<string> {
  warnDeprecated('repairYaml')
  const provider = resolveProvider()
  return _repairYaml(provider, yamlStr, validationErrors)
}

// ── Pass-through re-exports ──────────────────────────────────────────────────

export { CodegenError, type CodegenProvider, type CodegenChunk, type CodegenOptions }
