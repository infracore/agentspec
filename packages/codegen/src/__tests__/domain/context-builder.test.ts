import { describe, it, expect } from 'vitest'
import type { AgentSpecManifest } from '@agentspec/sdk'
import { buildContext } from '../../context-builder.js'

const baseManifest = {
  apiVersion: 'agentspec.io/v1',
  kind: 'AgentSpec',
  metadata: { name: 'test-agent', version: '0.1.0', description: 'Test' },
  spec: { model: { provider: 'anthropic', id: 'claude-opus-4-6' } },
} as AgentSpecManifest

describe('buildContext()', () => {
  it('wraps manifest in context_manifest tags', () => {
    const ctx = buildContext({ manifest: baseManifest })
    expect(ctx).toContain('<context_manifest>')
    expect(ctx).toContain('</context_manifest>')
    expect(ctx).toContain('"test-agent"')
  })

  it('silently skips non-existent context files', () => {
    expect(() =>
      buildContext({ manifest: baseManifest, contextFiles: ['/non/existent/file.ts'] }),
    ).not.toThrow()
  })

  it('includes context file content when the file exists', () => {
    // Use the skill-loader.ts file we just created as a real file
    const ctx = buildContext({
      manifest: baseManifest,
      contextFiles: [new URL('../../skill-loader.ts', import.meta.url).pathname],
    })
    expect(ctx).toContain('<context_file')
    expect(ctx).toContain('listFrameworks')
  })
})
