import { describe, it, expect, vi } from 'vitest'
import type { CodegenProvider, CodegenChunk } from '../../provider.js'
import { CodegenError } from '../../provider.js'

// Helper: create a fake provider that yields a single done chunk with the given text
function fakeProvider(responseText: string): CodegenProvider {
  return {
    name: 'test-provider',
    async *stream(): AsyncIterable<CodegenChunk> {
      yield { type: 'done', result: responseText, elapsedSec: 0.1 }
    },
  }
}

// Dynamically import repairYaml to avoid circular import with index.ts → collect()
async function loadRepairYaml() {
  const mod = await import('../../repair.js')
  return mod.repairYaml
}

const validYaml = `apiVersion: agentspec.io/v1
kind: AgentSpec
metadata:
  name: test
  version: 1.0.0
  description: test agent
spec:
  model:
    provider: openai
    id: gpt-4
    apiKey: $env:OPENAI_API_KEY`

describe('repairYaml()', () => {
  it('returns the repaired YAML when provider returns valid JSON', async () => {
    const repairYaml = await loadRepairYaml()

    const repairedYaml = 'apiVersion: agentspec.io/v1\nkind: AgentSpec\nmetadata:\n  name: fixed'
    const response = JSON.stringify({
      files: { 'agent.yaml': repairedYaml },
      installCommands: [],
      envVars: [],
    })

    const result = await repairYaml(fakeProvider(response), validYaml, 'some error')
    expect(result).toBe(repairedYaml)
  })

  it('returns repaired YAML from fenced JSON response', async () => {
    const repairYaml = await loadRepairYaml()

    const repairedYaml = 'apiVersion: agentspec.io/v1\nkind: AgentSpec'
    const response = '```json\n' + JSON.stringify({
      files: { 'agent.yaml': repairedYaml },
      installCommands: [],
      envVars: [],
    }) + '\n```'

    const result = await repairYaml(fakeProvider(response), validYaml, 'some error')
    expect(result).toBe(repairedYaml)
  })

  it('throws CodegenError when provider returns JSON without agent.yaml', async () => {
    const repairYaml = await loadRepairYaml()

    const response = JSON.stringify({
      files: { 'other.py': '# not yaml' },
      installCommands: [],
      envVars: [],
    })

    await expect(repairYaml(fakeProvider(response), validYaml, 'error'))
      .rejects.toThrow(CodegenError)

    try {
      await repairYaml(fakeProvider(response), validYaml, 'error')
    } catch (err) {
      expect((err as CodegenError).code).toBe('parse_failed')
      expect((err as CodegenError).message).toContain('agent.yaml')
    }
  })

  it('throws CodegenError when provider returns non-JSON', async () => {
    const repairYaml = await loadRepairYaml()

    await expect(repairYaml(fakeProvider('not json at all'), validYaml, 'error'))
      .rejects.toThrow(CodegenError)
  })

  it('truncates YAML to 65536 chars before sending', async () => {
    const repairYaml = await loadRepairYaml()

    const streamSpy = vi.fn()
    const longYaml = 'x'.repeat(70000)
    const repairedYaml = 'apiVersion: agentspec.io/v1'
    const response = JSON.stringify({
      files: { 'agent.yaml': repairedYaml },
      installCommands: [],
      envVars: [],
    })

    const spyProvider: CodegenProvider = {
      name: 'spy-provider',
      async *stream(_system: string, user: string): AsyncIterable<CodegenChunk> {
        streamSpy(user)
        yield { type: 'done', result: response, elapsedSec: 0.1 }
      },
    }

    await repairYaml(spyProvider, longYaml, 'error')

    const sentUser = streamSpy.mock.calls[0][0] as string
    // The YAML content inside the user message should be truncated
    expect(sentUser).not.toContain('x'.repeat(70000))
    expect(sentUser.length).toBeLessThan(70000)
  })

  it('passes system prompt and user message to provider', async () => {
    const repairYaml = await loadRepairYaml()

    const calls: { system: string; user: string }[] = []
    const repairedYaml = 'apiVersion: agentspec.io/v1'
    const response = JSON.stringify({
      files: { 'agent.yaml': repairedYaml },
      installCommands: [],
      envVars: [],
    })

    const captureProvider: CodegenProvider = {
      name: 'capture-provider',
      async *stream(system: string, user: string): AsyncIterable<CodegenChunk> {
        calls.push({ system, user })
        yield { type: 'done', result: response, elapsedSec: 0.1 }
      },
    }

    await repairYaml(captureProvider, validYaml, 'missing field: spec.model.id')

    expect(calls).toHaveLength(1)
    expect(calls[0].system).toContain('AgentSpec v1 YAML schema fixer')
    expect(calls[0].user).toContain('<yaml_content>')
    expect(calls[0].user).toContain(validYaml)
    expect(calls[0].user).toContain('<validation_errors>')
    expect(calls[0].user).toContain('missing field: spec.model.id')
  })
})
