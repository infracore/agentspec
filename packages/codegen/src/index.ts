import type { AgentSpecManifest, GeneratedAgent } from '@agentspec/sdk'
import { buildContext } from './context-builder.js'
import { loadSkill } from './skill-loader.js'
import { extractGeneratedAgent } from './response-parser.js'
import { resolveProvider } from './resolver.js'
import { CodegenError, type CodegenChunk, type CodegenProvider } from './provider.js'

export { CodegenError, resolveProvider }
export { listFrameworks } from './skill-loader.js'
export type { CodegenProvider, CodegenChunk }
export type { CodegenErrorCode, CodegenCallOptions } from './provider.js'
export { AnthropicApiProvider } from './providers/anthropic-api.js'
export { ClaudeSubscriptionProvider } from './providers/claude-sub.js'
export { CodexProvider } from './providers/codex.js'
export { probeClaudeAuth } from './auth-probe.js'
export type { ClaudeProbeReport, ClaudeCliProbe, ClaudeApiProbe, ClaudeEnvProbe } from './auth-probe.js'
export { repairYaml } from './repair.js'

export interface CodegenOptions {
  framework: string
  model?: string
  manifestDir?: string
  contextFiles?: string[]
  provider?: CodegenProvider
  onChunk?: (chunk: CodegenChunk) => void
}

/** Drain a CodegenProvider stream and return the final result string. */
export async function collect(stream: AsyncIterable<CodegenChunk>): Promise<string> {
  for await (const chunk of stream) {
    if (chunk.type === 'done') return chunk.result
  }
  throw new CodegenError('generation_failed', 'Stream ended without a done chunk')
}

/**
 * Generate agent code from a manifest.
 *
 * Selects a provider automatically (Claude subscription → Anthropic API → Codex)
 * or uses the one passed in `options.provider`.
 */
export async function generateCode(
  manifest: AgentSpecManifest,
  options: CodegenOptions,
): Promise<GeneratedAgent> {
  const skillMd = loadSkill(options.framework)
  const context = buildContext({
    manifest,
    manifestDir: options.manifestDir,
    contextFiles: options.contextFiles,
  })
  const provider = options.provider ?? resolveProvider()

  let result: string | undefined
  for await (const chunk of provider.stream(skillMd, context, { model: options.model })) {
    options.onChunk?.(chunk)
    if (chunk.type === 'done') result = chunk.result
  }

  if (!result) throw new CodegenError('generation_failed', 'No result from provider')
  return extractGeneratedAgent(result, options.framework)
}
