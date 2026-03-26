export type CodegenErrorCode =
  | 'auth_failed'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'model_not_found'
  | 'generation_failed'
  | 'parse_failed'
  | 'provider_unavailable'
  | 'response_invalid'

export class CodegenError extends Error {
  constructor(
    public readonly code: CodegenErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'CodegenError'
  }
}

export type CodegenChunk =
  | { type: 'delta';     text: string; accumulated: string; elapsedSec: number }
  | { type: 'heartbeat'; elapsedSec: number }
  | { type: 'done';      result: string; elapsedSec: number }

export interface CodegenCallOptions {
  model?: string
}

export interface CodegenProvider {
  readonly name: string
  stream(
    system: string,
    user: string,
    opts: CodegenCallOptions,
  ): AsyncIterable<CodegenChunk>
}
