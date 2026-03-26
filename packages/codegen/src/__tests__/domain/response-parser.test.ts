import { describe, it, expect } from 'vitest'
import { extractGeneratedAgent } from '../../response-parser.js'
import { CodegenError } from '../../provider.js'

const validPayload = {
  files: { 'agent.py': '# hello' },
  installCommands: ['pip install foo'],
  envVars: ['FOO_KEY'],
}

describe('extractGeneratedAgent()', () => {
  it('parses bare JSON', () => {
    const result = extractGeneratedAgent(JSON.stringify(validPayload), 'langgraph')
    expect(result.files['agent.py']).toBe('# hello')
    expect(result.framework).toBe('langgraph')
  })

  it('parses JSON inside ```json fence', () => {
    const text = '```json\n' + JSON.stringify(validPayload) + '\n```'
    const result = extractGeneratedAgent(text, 'langgraph')
    expect(result.files['agent.py']).toBe('# hello')
  })

  it('returns installCommands and envVars', () => {
    const result = extractGeneratedAgent(JSON.stringify(validPayload), 'langgraph')
    expect(result.installCommands).toEqual(['pip install foo'])
    expect(result.envVars).toEqual(['FOO_KEY'])
  })

  it('defaults to empty arrays when missing', () => {
    const minimal = JSON.stringify({ files: { 'a.py': 'x' } })
    const result = extractGeneratedAgent(minimal, 'crewai')
    expect(result.installCommands).toEqual([])
    expect(result.envVars).toEqual([])
  })

  it('throws CodegenError when no valid JSON found', () => {
    expect(() => extractGeneratedAgent('not json at all', 'langgraph'))
      .toThrow(CodegenError)
  })

  it('throws CodegenError with code response_invalid when files key missing', () => {
    try {
      extractGeneratedAgent(JSON.stringify({ nofiles: true }), 'langgraph')
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(CodegenError)
      expect((err as CodegenError).code).toBe('response_invalid')
    }
  })
})
