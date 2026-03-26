import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const skillsDir = join(__dirname, 'skills')

export function listFrameworks(): string[] {
  return readdirSync(skillsDir)
    .filter((f) => f.endsWith('.md') && f !== 'guidelines.md')
    .map((f) => f.slice(0, -3))
    .sort()
}

export function loadSkill(framework: string): string {
  const available = listFrameworks()
  if (!available.includes(framework)) {
    throw new Error(
      `Framework '${framework}' is not supported. Available: ${available.join(', ')}`,
    )
  }
  const guidelinesPath = join(skillsDir, 'guidelines.md')
  let guidelines = ''
  try {
    guidelines = readFileSync(guidelinesPath, 'utf-8') + '\n\n---\n\n'
  } catch {
    // guidelines.md is optional
  }
  return guidelines + readFileSync(join(skillsDir, `${framework}.md`), 'utf-8')
}
