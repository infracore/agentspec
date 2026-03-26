import { describe, it, expect, vi } from 'vitest'
import type { CodegenProvider } from '../../provider.js'
import { CodegenError } from '../../provider.js'

export function runProviderContractTests(
  providerName: string,
  makeProvider: () => CodegenProvider,
  makeSuccessStream: (text: string) => AsyncIterable<unknown>,
  mockFn: ReturnType<typeof vi.fn>,
) {
  describe(`${providerName} — CodegenProvider contract`, () => {
    it('provider.name is a non-empty string', () => {
      expect(typeof makeProvider().name).toBe('string')
      expect(makeProvider().name.length).toBeGreaterThan(0)
    })

    it('stream() yields at least one delta before done', async () => {
      mockFn.mockReturnValue(makeSuccessStream('some text'))
      const chunks: unknown[] = []
      for await (const c of makeProvider().stream('sys', 'user', {})) chunks.push(c)
      expect(chunks.some((c: any) => c.type === 'delta')).toBe(true)
    })

    it('stream() always ends with a done chunk', async () => {
      mockFn.mockReturnValue(makeSuccessStream('result'))
      const chunks: unknown[] = []
      for await (const c of makeProvider().stream('sys', 'user', {})) chunks.push(c)
      expect((chunks.at(-1) as any)?.type).toBe('done')
    })

    it('done chunk result equals accumulated delta text', async () => {
      mockFn.mockReturnValue(makeSuccessStream('my result'))
      const chunks: unknown[] = []
      for await (const c of makeProvider().stream('sys', 'user', {})) chunks.push(c)
      const done = chunks.find((c: any) => c.type === 'done') as any
      const accumulated = chunks
        .filter((c: any) => c.type === 'delta')
        .map((c: any) => c.text)
        .join('')
      expect(done?.result).toBe(accumulated)
    })

    it('throws CodegenError — never raw SDK errors', async () => {
      mockFn.mockImplementation(() => { throw new Error('raw sdk error') })
      await expect(async () => {
        for await (const _ of makeProvider().stream('sys', 'user', {})) { /* consume */ }
      }).rejects.toBeInstanceOf(CodegenError)
    })
  })
}
