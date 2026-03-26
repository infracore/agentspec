import OpenAI from 'openai'
import {
  CodegenError,
  type CodegenChunk,
  type CodegenCallOptions,
  type CodegenProvider,
} from '../provider.js'

// ── Error translation ──────────────────────────────────────────────────────────

function translateError(err: unknown): CodegenError {
  if (err instanceof CodegenError) return err
  const msg = String(err).toLowerCase()
  if (msg.includes('401') || msg.includes('authentication') || msg.includes('invalid api key'))
    return new CodegenError('auth_failed', 'Invalid OPENAI_API_KEY', err)
  if (msg.includes('429') || msg.includes('rate limit'))
    return new CodegenError('rate_limited', 'OpenAI rate limit hit', err)
  if (msg.includes('quota') || msg.includes('billing'))
    return new CodegenError('quota_exceeded', 'OpenAI quota exceeded', err)
  return new CodegenError('generation_failed', `OpenAI: ${String(err).slice(0, 500)}`, err)
}

// ── Provider ───────────────────────────────────────────────────────────────────

export class CodexProvider implements CodegenProvider {
  readonly name = 'codex'
  private readonly defaultModel: string

  constructor(
    private readonly apiKey: string,
    model?: string,
  ) {
    this.defaultModel = model ?? process.env['OPENAI_MODEL'] ?? 'codex-mini-latest'
  }

  async *stream(
    system: string,
    user: string,
    opts: CodegenCallOptions,
  ): AsyncIterable<CodegenChunk> {
    const client = new OpenAI({ apiKey: this.apiKey })
    const model = opts.model ?? this.defaultModel
    const startMs = Date.now()
    let accumulated = ''

    try {
      const sdkStream = client.beta.chat.completions.stream({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      })

      for await (const chunk of sdkStream) {
        const content = chunk.choices[0]?.delta?.content
        if (content) {
          accumulated += content
          yield {
            type: 'delta',
            text: content,
            accumulated,
            elapsedSec: Math.floor((Date.now() - startMs) / 1000),
          }
        }
      }
    } catch (err) {
      throw translateError(err)
    }

    if (!accumulated) {
      throw new CodegenError('response_invalid', 'OpenAI returned no content')
    }

    yield {
      type: 'done',
      result: accumulated,
      elapsedSec: Math.floor((Date.now() - startMs) / 1000),
    }
  }
}
