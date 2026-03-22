import type { AgentSpecManifest } from '@agentspec/sdk'
import { readFileSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'

export interface BuildContextOptions {
  manifest: AgentSpecManifest
  contextFiles?: string[]
  /** Base directory for resolving $file: references in spec.tools[].module */
  manifestDir?: string
}

/**
 * Scan spec.tools[].module for $file: references and return resolved absolute paths.
 * This gives Claude the actual tool implementations to reference when generating typed wrappers.
 *
 * Security: paths that resolve outside manifestDir are silently skipped (SEC-03).
 */
function extractFileRefs(manifest: AgentSpecManifest, baseDir: string): string[] {
  const resolvedBase = resolve(baseDir)
  const refs: string[] = []
  for (const tool of manifest.spec?.tools ?? []) {
    const mod = (tool as Record<string, unknown>).module as string | undefined
    if (typeof mod === 'string' && mod.startsWith('$file:')) {
      const absPath = resolve(join(resolvedBase, mod.slice(6)))
      // Reject paths that escape the manifest directory (path traversal guard)
      const rel = relative(resolvedBase, absPath)
      if (rel.startsWith('..') || resolve(rel) === rel) continue
      refs.push(absPath)
    }
  }
  return refs
}

/**
 * Build the user-message context for Claude from a manifest + optional source files.
 *
 * The manifest is wrapped in <context_manifest> XML tags and each context file in
 * <context_file> tags to create clear prompt-injection boundaries — Claude treats
 * the contents as data, not instructions.
 *
 * When manifestDir is provided, $file: references in spec.tools[].module are
 * automatically resolved and included as context files.
 */
export function buildContext(options: BuildContextOptions): string {
  const { manifest, contextFiles = [], manifestDir } = options

  const resolvedRefs = manifestDir ? extractFileRefs(manifest, manifestDir) : []
  const allContextFiles = [...resolvedRefs, ...contextFiles]

  const parts: string[] = [
    '<context_manifest>',
    JSON.stringify(manifest, null, 2),
    '</context_manifest>',
  ]

  for (const filePath of allContextFiles) {
    try {
      const content = readFileSync(filePath, 'utf-8')
      const ext = filePath.split('.').pop() ?? ''
      parts.push(`<context_file path="${filePath}" lang="${ext}">`)
      parts.push(content)
      parts.push('</context_file>')
    } catch {
      // Silently skip unreadable context files
    }
  }

  return parts.join('\n')
}
