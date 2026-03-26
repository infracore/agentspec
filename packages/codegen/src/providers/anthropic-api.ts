import Anthropic from '@anthropic-ai/sdk'
import {
  CodegenError,
  type CodegenChunk,
  type CodegenCallOptions,
  type CodegenProvider,
} from '../provider.js'

// ── Error translation ──────────────────────────────────────────────────────────

function translateError(err: unknown): CodegenError {
  if (err instanceof CodegenError) return err
  if (Anthropic.RateLimitError && err instanceof Anthropic.RateLimitError)
    return new CodegenError('rate_limited', `Anthropic rate limit: ${(err as Error).message}`, err)
  if (Anthropic.AuthenticationError && err instanceof Anthropic.AuthenticationError)
    return new CodegenError('auth_failed', 'Invalid ANTHROPIC_API_KEY', err)
  if (Anthropic.BadRequestError && err instanceof Anthropic.BadRequestError)
    return new CodegenError('generation_failed', (err as Error).message, err)
  return new CodegenError('generation_failed', String(err), err)
}

// ── Provider ───────────────────────────────────────────────────────────────────

export class AnthropicApiProvider implements CodegenProvider {
  readonly name = 'anthropic-api'

  constructor(
    private readonly apiKey: string,
    private readonly baseURL?: string,
  ) {}

  async *stream(
    system: string,
    user: string,
    opts: CodegenCallOptions,
  ): AsyncIterable<CodegenChunk> {
    const client = new Anthropic({
      apiKey: this.apiKey,
      ...(this.baseURL ? { baseURL: this.baseURL } : {}),
    })
    const model = opts.model ?? process.env['ANTHROPIC_MODEL'] ?? 'claude-opus-4-6'
    const startMs = Date.now()
    let accumulated = ''

    try {
      const sdkStream = client.messages.stream({
        model,
        max_tokens: 32768,
        system,
        messages: [{ role: 'user', content: user }],
      })

      for await (const event of sdkStream) {
        const elapsedSec = Math.floor((Date.now() - startMs) / 1000)
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          const text = event.delta.text
          accumulated += text
          yield { type: 'delta', text, accumulated, elapsedSec }
        }
      }
    } catch (err) {
      throw translateError(err)
    }

    if (!accumulated) {
      throw new CodegenError('response_invalid', 'Anthropic API returned no text content')
    }

    yield {
      type: 'done',
      result: accumulated,
      elapsedSec: Math.floor((Date.now() - startMs) / 1000),
    }
  }
}
