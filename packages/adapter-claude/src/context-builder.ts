import type { AgentSpecManifest } from '@agentspec/sdk'
import { readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'

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
 * Security: each resolved path is checked against baseDir to prevent $file:../../etc/passwd
 * style traversal.  Paths that resolve outside the manifest directory are silently skipped.
 */
function extractFileRefs(manifest: AgentSpecManifest, baseDir: string): string[] {
  const refs: string[] = []
  const resolvedBase = resolve(baseDir)
  const safeBase = resolvedBase.endsWith(sep) ? resolvedBase : resolvedBase + sep

  for (const tool of manifest.spec?.tools ?? []) {
    const mod = (tool as Record<string, unknown>).module as string | undefined
    if (typeof mod === 'string' && mod.startsWith('$file:')) {
      const absPath = resolve(resolvedBase, mod.slice(6))
      // Reject any path that escapes the manifest directory
      if (absPath !== resolvedBase && !absPath.startsWith(safeBase)) continue
      refs.push(absPath)
    }
  }
  return refs
}

/**
 * Build the user-message context for Claude from a manifest + optional source files.
 *
 * Security: all developer-controlled content (manifest JSON and source files) is wrapped
 * in XML `<context_*>` tags.  Claude is instructed in the system prompt (guidelines.md)
 * to treat content inside those tags as data only and never follow instructions embedded
 * within them.  This prevents prompt-injection attacks where a scanned source file
 * contains adversarial LLM instructions.
 *
 * When manifestDir is provided, $file: references in spec.tools[].module are automatically
 * resolved (with path-traversal guard) and included as context files.
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
