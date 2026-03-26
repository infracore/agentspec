import { describe, it, expect } from 'vitest'
import { CodegenError } from '../../provider.js'

describe('CodegenError', () => {
  it('has name CodegenError', () => {
    const err = new CodegenError('auth_failed', 'bad key')
    expect(err.name).toBe('CodegenError')
  })

  it('exposes the error code', () => {
    const err = new CodegenError('quota_exceeded', 'limit hit')
    expect(err.code).toBe('quota_exceeded')
  })

  it('is an instanceof Error', () => {
    expect(new CodegenError('generation_failed', 'oops')).toBeInstanceOf(Error)
  })

  it('stores the cause', () => {
    const cause = new Error('upstream')
    const err = new CodegenError('rate_limited', 'slow down', cause)
    expect(err.cause).toBe(cause)
  })

  it('has the message passed in', () => {
    const err = new CodegenError('parse_failed', 'bad json')
    expect(err.message).toBe('bad json')
  })
})
