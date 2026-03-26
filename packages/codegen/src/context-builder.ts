import type { AgentSpecManifest } from '@agentspec/sdk'
import { readFileSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'

export interface BuildContextOptions {
  manifest: AgentSpecManifest
  contextFiles?: string[]
  manifestDir?: string
}

function extractFileRefs(manifest: AgentSpecManifest, baseDir: string): string[] {
  const resolvedBase = resolve(baseDir)
  const refs: string[] = []
  for (const tool of manifest.spec?.tools ?? []) {
    const mod = (tool as Record<string, unknown>).module as string | undefined
    if (typeof mod === 'string' && mod.startsWith('$file:')) {
      const absPath = resolve(join(resolvedBase, mod.slice(6)))
      const rel = relative(resolvedBase, absPath)
      if (rel.startsWith('..') || resolve(rel) === rel) continue
      refs.push(absPath)
    }
  }
  return refs
}

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
