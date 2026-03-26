import { query } from '@anthropic-ai/claude-agent-sdk'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  CodegenError,
  type CodegenChunk,
  type CodegenCallOptions,
  type CodegenProvider,
} from '../provider.js'

// ── Error translation ──────────────────────────────────────────────────────────

const QUOTA_PATTERNS = [
  'usage limit reached', 'quota exceeded', 'rate limit', 'too many requests',
  'daily limit', 'monthly limit', 'you have reached', 'limit has been reached',
  'upgrade your plan', 'exceeded your', 'allowance',
] as const

function translateError(err: unknown): CodegenError {
  if (err instanceof CodegenError) return err
  const msg = String(err).toLowerCase()
  if (QUOTA_PATTERNS.some((p) => msg.includes(p)))
    return new CodegenError(
      'quota_exceeded',
      `Claude quota exceeded.\n${String(err).slice(0, 300)}`,
      err,
    )
  if (
    msg.includes('not logged in') ||
    msg.includes('not authenticated') ||
    (msg.includes('auth') && msg.includes('login'))
  )
    return new CodegenError(
      'auth_failed',
      'Claude is not authenticated. Run: claude auth login',
      err,
    )
  return new CodegenError(
    'generation_failed',
    `Claude SDK: ${String(err).slice(0, 500)}`,
    err,
  )
}

// ── Provider ───────────────────────────────────────────────────────────────────

export class ClaudeSubscriptionProvider implements CodegenProvider {
  readonly name = 'claude-subscription'

  async *stream(
    system: string,
    user: string,
    opts: CodegenCallOptions,
  ): AsyncIterable<CodegenChunk> {
    const model = opts.model ?? process.env['ANTHROPIC_MODEL'] ?? 'claude-sonnet-4-6'
    const startMs = Date.now()
    let accumulated = ''

    const ticker = setInterval(() => {/* heartbeat flag */}, 5_000)
    ticker.unref()

    const cwd = mkdtempSync(`${tmpdir()}/agentspec-gen-`)

    try {
      for await (const message of query({
        prompt: user,
        options: {
          systemPrompt: system,
          model,
          allowedTools: [],
          maxTurns: 1,
          settingSources: [],
          cwd,
        },
      })) {
        const elapsedSec = Math.floor((Date.now() - startMs) / 1000)

        if (message.type === 'assistant') {
          const chunk = message.message.content
            .filter((b) => b.type === 'text')
            .map((b) => (b as { type: 'text'; text: string }).text)
            .join('')
          if (chunk) {
            accumulated += chunk
            yield { type: 'delta', text: chunk, accumulated, elapsedSec }
          }
        }

        if (message.type === 'result') {
          clearInterval(ticker)
          if (message.subtype === 'success') {
            yield { type: 'done', result: message.result, elapsedSec }
            return
          }
          throw new CodegenError(
            'generation_failed',
            `Claude SDK error (${message.subtype})`,
          )
        }
      }
    } catch (err) {
      clearInterval(ticker)
      throw translateError(err)
    }

    clearInterval(ticker)
    throw new CodegenError('generation_failed', 'Claude SDK returned no result')
  }
}
