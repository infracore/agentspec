import type { GeneratedAgent } from '@agentspec/sdk'
import { CodegenError } from './provider.js'

interface ParsedPayload {
  files: Record<string, string>
  installCommands?: string[]
  envVars?: string[]
}

function tryParseCandidates(text: string): ParsedPayload | null {
  const candidates: string[] = []
  const trimmed = text.trim()

  if (trimmed.startsWith('{')) candidates.push(trimmed)

  const fenceOpen = text.indexOf('```json')
  if (fenceOpen !== -1) {
    const contentStart = text.indexOf('\n', fenceOpen) + 1
    const fenceClose = text.lastIndexOf('\n```')
    if (fenceClose > contentStart) candidates.push(text.slice(contentStart, fenceClose))
  }

  const braceMatch = text.match(/(\{[\s\S]*\})/)
  if (braceMatch?.[1]) candidates.push(braceMatch[1])

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && 'files' in parsed) {
        return parsed as ParsedPayload
      }
    } catch {
      continue
    }
  }
  return null
}

export function extractGeneratedAgent(text: string, framework: string): GeneratedAgent {
  const payload = tryParseCandidates(text)

  if (!payload) {
    let validJson = false
    try { JSON.parse(text.trim()); validJson = true } catch { /* not json */ }

    if (validJson) {
      throw new CodegenError('response_invalid', 'Provider response JSON is missing the required "files" field.')
    }
    throw new CodegenError(
      'parse_failed',
      `Provider did not return valid JSON.\n\nReceived:\n${text.slice(0, 500)}`,
    )
  }

  return {
    framework,
    files: payload.files,
    installCommands: payload.installCommands ?? [],
    envVars: payload.envVars ?? [],
    readme: payload.files['README.md'] ?? '',
  }
}
