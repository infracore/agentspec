import type { AgentSpecManifest } from '@agentspec/sdk'
import { lstatSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'

export interface BuildContextOptions {
  manifest: AgentSpecManifest
  contextFiles?: string[]
  /** Base directory for resolving $file: references in spec.tools[].module */
  manifestDir?: string
}

// ── XML helpers ───────────────────────────────────────────────────────────────

/**
 * Escape a string for use in an XML attribute value (double-quoted).
 * Encodes &, ", <, > and the NULL character.
 */
function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\0/g, '')
}

/**
 * Sanitise file content so it cannot break out of a `<context_file>` block.
 *
 * The only string that can close the block is the exact end tag.  We replace
 * every occurrence with an escaped variant (`<\/context_file>`) that Claude
 * reads as plain text but that is not parsed as a closing tag by the boundary
 * logic in the system prompt.
 */
function sanitizeContextContent(content: string): string {
  return content.replace(/<\/context_file>/g, '<\\/context_file>')
}

// ── File ref extraction ───────────────────────────────────────────────────────

/**
 * Scan spec.tools[].module for $file: references and return resolved absolute paths.
 *
 * Security:
 *  - Path traversal: each resolved path is checked against baseDir (resolve + sep prefix).
 *  - Symlink escape: lstatSync is used so symlinks are never followed silently; any
 *    entry whose lstat reports isSymbolicLink() is rejected before reading.
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
      // Reject symlinks — they could point outside the safe base
      try {
        if (lstatSync(absPath).isSymbolicLink()) continue
      } catch {
        continue
      }
      refs.push(absPath)
    }
  }
  return refs
}

// ── Context builder ───────────────────────────────────────────────────────────

/**
 * Build the user-message context for Claude from a manifest + optional source files.
 *
 * Security: all developer-controlled content (manifest JSON and source files) is wrapped
 * in XML `<context_*>` tags with escaped attributes and sanitised content.  Claude is
 * instructed in the system prompt (guidelines.md) to treat content inside those tags as
 * data only and never follow instructions embedded within them.  This prevents
 * prompt-injection attacks where a scanned source file contains adversarial LLM
 * instructions.
 *
 * When manifestDir is provided, $file: references in spec.tools[].module are automatically
 * resolved (with path-traversal and symlink guards) and included as context files.
 */
export function buildContext(options: BuildContextOptions): string {
  const { manifest, contextFiles = [], manifestDir } = options

  const resolvedRefs = manifestDir ? extractFileRefs(manifest, manifestDir) : []
  const allContextFiles = [...resolvedRefs, ...contextFiles]

  const parts: string[] = [
    '<context_manifest>',
    sanitizeContextContent(JSON.stringify(manifest, null, 2)),
    '</context_manifest>',
  ]

  for (const filePath of allContextFiles) {
    try {
      const content = readFileSync(filePath, 'utf-8')
      const ext = filePath.split('.').pop() ?? ''
      parts.push(`<context_file path="${escapeXmlAttr(filePath)}" lang="${escapeXmlAttr(ext)}">`)
      parts.push(sanitizeContextContent(content))
      parts.push('</context_file>')
    } catch {
      // Silently skip unreadable context files
    }
  }

  return parts.join('\n')
}
