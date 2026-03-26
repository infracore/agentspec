/**
 * `agentspec scan --dir <src>`
 *
 * LLM-powered source analysis: reads .py / .ts / .js files and generates
 * an agent.yaml manifest from what it finds.
 *
 * Output behaviour:
 *   No existing agent.yaml  →  writes agent.yaml
 *   Existing agent.yaml, no --update  →  writes agent.yaml.new
 *   Existing agent.yaml + --update  →  overwrites agent.yaml
 *   --out <path>  →  writes to that resolved path (ignores above logic)
 *   --dry-run  →  prints to stdout, writes nothing
 *
 * Security:
 *   - Symlinks are skipped (lstatSync) to prevent traversal to outside srcDir
 *   - All resolved paths are checked against the srcDir prefix
 *   - node_modules / .git / dist and other non-user dirs are excluded
 *   - Total source content is capped at 200 KB before being sent to the provider
 */

import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { extname, join, resolve } from 'node:path'
import type { Command } from 'commander'
import * as jsYaml from 'js-yaml'
import { spinner } from '../utils/spinner.js'
import { generateCode, repairYaml, resolveProvider, type CodegenProvider } from '@agentspec/codegen'
import { ManifestSchema } from '@agentspec/sdk'
import { buildManifestFromDetection, type ScanDetection } from './scan-builder.js'

// ── Public types ──────────────────────────────────────────────────────────────

export interface SourceFile {
  path: string
  content: string
}

export interface ScanOptions {
  srcDir: string
  out?: string
  update?: boolean
  dryRun?: boolean
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_FILES = 50
const MAX_BYTES = 200 * 1024 // 200 KB
const MAX_REPAIR_ITERATIONS = 2 // safety net — builder should produce valid YAML

const SOURCE_EXTENSIONS = new Set(['.py', '.ts', '.js', '.mjs', '.cjs'])

/** Directories that never contain user-authored source code. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '__pycache__', '.venv', 'venv', '.env',
  'dist', 'build', '.next', '.nuxt', 'coverage', '.tox', '.mypy_cache',
  '.pytest_cache', '.ruff_cache', 'target', 'out', '.turbo',
])

// ── collectSourceFiles ────────────────────────────────────────────────────────

/**
 * Recursively collect source files from srcDir.
 *
 * Security guarantees:
 *  - Symlinks are detected via `lstatSync` and skipped entirely.
 *  - Every regular file's real path is checked to stay within srcDir.
 *  - Directories named in SKIP_DIRS or starting with '.' are skipped.
 *
 * Caps:
 *  - At most `maxFiles` files (default 50).
 *  - At most `maxBytes` total content (default 200 KB); last file is truncated if needed.
 *
 * Returns both the capped file list and `totalFound` — the uncapped count — so callers
 * can warn about truncation without a second directory walk (PERF-02).
 */
export function collectSourceFiles(
  srcDir: string,
  maxFiles = MAX_FILES,
  maxBytes = MAX_BYTES,
): SourceFile[] {
  const { files } = collectSourceFilesWithCount(srcDir, maxFiles, maxBytes)
  return files
}

/** Internal result type returned by collectSourceFilesWithCount. */
interface CollectResult {
  files: SourceFile[]
  /** Total matching files found before the maxFiles cap was applied. */
  totalFound: number
}

function collectSourceFilesWithCount(
  srcDir: string,
  maxFiles = MAX_FILES,
  maxBytes = MAX_BYTES,
): CollectResult {
  // Use realpathSync so that on systems where /tmp → /private/tmp (macOS),
  // the base and all file paths share the same canonical prefix.
  let resolvedBase: string
  try {
    resolvedBase = realpathSync(resolve(srcDir))
  } catch {
    resolvedBase = resolve(srcDir)
  }
  const results: SourceFile[] = []
  let totalBytes = 0
  let totalFound = 0

  function walk(dir: string): void {
    let entries: string[]
    try {
      entries = readdirSync(dir).sort()
    } catch {
      return
    }

    for (const entry of entries) {
      // Skip hidden dirs and known non-user dirs
      if (entry.startsWith('.') || SKIP_DIRS.has(entry)) continue

      const fullPath = join(dir, entry)

      // [C1] Use lstatSync — does NOT follow symlinks
      let stat: ReturnType<typeof lstatSync>
      try {
        stat = lstatSync(fullPath)
      } catch {
        continue
      }

      // Skip all symlinks to prevent traversal to outside srcDir
      if (stat.isSymbolicLink()) continue

      if (stat.isDirectory()) {
        // Guard: canonical directory path must stay within base
        let resolvedDir: string
        try {
          resolvedDir = realpathSync(fullPath)
        } catch {
          continue
        }
        if (!resolvedDir.startsWith(resolvedBase + '/') && resolvedDir !== resolvedBase) continue
        walk(fullPath)
      } else if (stat.isFile() && SOURCE_EXTENSIONS.has(extname(entry))) {
        // [C1] Double-check real path for any OS-level indirection
        let realPath: string
        try {
          realPath = realpathSync(fullPath)
        } catch {
          continue
        }
        if (!realPath.startsWith(resolvedBase + '/') && realPath !== resolvedBase) continue

        totalFound++

        // Apply caps only to what we include in the result
        if (results.length >= maxFiles) continue
        if (totalBytes >= maxBytes) continue

        let content: string
        try {
          content = readFileSync(fullPath, 'utf-8')
        } catch {
          continue
        }
        const remaining = maxBytes - totalBytes
        if (content.length > remaining) {
          content = content.slice(0, remaining)
        }
        totalBytes += content.length
        results.push({ path: fullPath, content })
      }
    }
  }

  walk(resolvedBase)
  return { files: results, totalFound }
}

// ── resolveOutputPath ─────────────────────────────────────────────────────────

/**
 * Determine the path where agent.yaml will be written.
 *
 * --out <path>   →  resolve(that path) — always absolute
 * --dry-run      →  still returns a resolved path; caller skips the write
 * existing yaml  →  agent.yaml.new (unless --update)
 * no existing    →  agent.yaml
 */
export function resolveOutputPath(opts: ScanOptions): string {
  // [H3] Always resolve to absolute path so callers get a canonical path
  if (opts.out) return resolve(opts.out)

  const defaultPath = join(resolve(opts.srcDir), 'agent.yaml')

  if (opts.update || opts.dryRun) return defaultPath
  if (existsSync(defaultPath)) return join(resolve(opts.srcDir), 'agent.yaml.new')
  return defaultPath
}

// ── Private helpers ────────────────────────────────────────────────────────────

/**
 * Collect source files and emit cap warnings. Returns the files ready for scanning.
 * Uses a single directory walk for both the files and the total count (PERF-02).
 */
function collectAndValidateSourceFiles(srcDir: string): SourceFile[] {
  const { files, totalFound } = collectSourceFilesWithCount(srcDir)
  if (files.length === 0) {
    console.warn(`No source files found in ${srcDir}`)
  }
  if (totalFound > MAX_FILES) {
    console.warn(
      `Found ${totalFound} source files — truncating to ${MAX_FILES} files cap. ` +
      `Use a narrower --dir path to scan specific modules.`,
    )
  }
  return files
}

/**
 * Extract a ScanDetection from the raw provider response.
 * The provider returns detection.json (raw facts) — the builder converts it to YAML.
 * Throws with a descriptive message on any structural mismatch.
 */
function parseDetection(rawResult: unknown): ScanDetection {
  if (
    !rawResult ||
    typeof rawResult !== 'object' ||
    !('files' in rawResult) ||
    typeof (rawResult as Record<string, unknown>).files !== 'object' ||
    (rawResult as Record<string, unknown>).files === null
  ) {
    throw new Error('Provider returned an unexpected response format (missing "files" object).')
  }
  const detectionJson = (rawResult as { files: Record<string, string> }).files['detection.json']
  if (!detectionJson) {
    throw new Error('Provider did not return detection.json in the output.')
  }
  let detection: ScanDetection
  try {
    detection = JSON.parse(detectionJson) as ScanDetection
  } catch (e) {
    throw new Error(`Failed to parse detection JSON: ${(e as Error).message}`)
  }
  const requiredFields = ['name', 'description', 'modelProvider', 'modelId', 'modelApiKeyEnv'] as const
  const missing = requiredFields.filter(f => !detection[f])
  if (!Array.isArray(detection.envVars)) missing.push('envVars' as never)
  if (missing.length) {
    throw new Error(`Detection JSON is missing required fields: ${missing.join(', ')}`)
  }
  return detection
}

// ── Schema validation ─────────────────────────────────────────────────────────

interface ValidationOk { valid: true }
interface ValidationFail { valid: false; errors: string; errorCount: number }
type ValidationResult = ValidationOk | ValidationFail

function validateManifestYaml(yamlStr: string): ValidationResult {
  let parsed: unknown
  try {
    parsed = jsYaml.load(yamlStr)
  } catch (e) {
    return { valid: false, errors: `YAML parse error: ${(e as Error).message}`, errorCount: 1 }
  }
  const result = ManifestSchema.safeParse(parsed)
  if (result.success) return { valid: true }
  const errors = result.error.errors
    .map(e => `  - ${e.path.join('.') || '(root)'}: ${e.message}`)
    .join('\n')
  return { valid: false, errors, errorCount: result.error.errors.length }
}

// ── Commander registration ─────────────────────────────────────────────────────

export function registerScanCommand(program: Command): void {
  program
    .command('scan')
    .description('Scan source code and generate an agent.yaml manifest (LLM-powered)')
    .requiredOption('-d, --dir <src>', 'Source directory to scan')
    .option('--out <path>', 'Explicit output path')
    .option('--update', 'Overwrite existing agent.yaml in place')
    .option('--dry-run', 'Print generated YAML to stdout without writing')
    .option('--provider <name>', 'Override codegen provider: claude-sub, anthropic-api, codex')
    .action(async (opts: { dir: string; out?: string; update?: boolean; dryRun?: boolean; provider?: string }) => {
      const s = spinner()
      s.start('Checking provider…')

      let provider: CodegenProvider
      try {
        provider = resolveProvider(opts.provider)
      } catch (err) {
        s.stop('Provider unavailable')
        console.error(`Codegen provider unavailable: ${(err as Error).message}`)
        process.exit(1)
      }

      const srcDir = resolve(opts.dir)
      const sourceFiles = collectAndValidateSourceFiles(srcDir)

      s.message(`Analysing source code with ${provider.name}…`)

      // Phase 1: detect (LLM) — returns raw facts as detection.json
      let rawResult: unknown
      try {
        rawResult = await generateCode(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          {} as any, // empty manifest — the scan skill detects from source
          {
            framework: 'scan',
            contextFiles: sourceFiles.map(f => f.path),
            manifestDir: srcDir,
            provider,
          },
        )
      } catch (err) {
        s.stop('Failed')
        console.error(`Scan failed: ${(err as Error).message}`)
        process.exit(1)
      }

      // Phase 2: build manifest from detection (pure TypeScript — deterministic)
      let agentYaml: string
      try {
        s.message('Building manifest…')
        const detection = parseDetection(rawResult)
        const manifest = buildManifestFromDetection(detection)
        agentYaml = jsYaml.dump(manifest, { lineWidth: 120 })
      } catch (err) {
        s.stop('Failed')
        console.error(`Build failed: ${(err as Error).message}`)
        process.exit(1)
      }

      // Phase 3: validate (safety net — should always pass with the builder)
      let validation = validateManifestYaml(agentYaml)

      for (let attempt = 1; !validation.valid && attempt <= MAX_REPAIR_ITERATIONS; attempt++) {
        s.message(
          `Fixing ${validation.errorCount} schema error(s) — attempt ${attempt}/${MAX_REPAIR_ITERATIONS}…`,
        )
        try {
          agentYaml = await repairYaml(provider, agentYaml, validation.errors)
          validation = validateManifestYaml(agentYaml)
        } catch (err) {
          s.stop('Failed')
          console.error(`Repair failed: ${(err as Error).message}`)
          process.exit(1)
        }
      }

      if (validation.valid) {
        s.stop('Analysis complete ✓') // covers all 3 phases
      } else {
        s.stop(`Analysis complete (${validation.errorCount} schema error(s) remain — review the file)`)
        // Prepend remaining errors as comments so the user can see what needs fixing
        agentYaml =
          `# agentspec validate errors — fix before committing:\n` +
          validation.errors
            .split('\n')
            .map(l => `# ${l}`)
            .join('\n') +
          '\n\n' +
          agentYaml
      }

      if (opts.dryRun) {
        console.log(agentYaml)
        return
      }

      const outPath = resolveOutputPath({
        srcDir,
        out: opts.out,
        update: opts.update,
        dryRun: opts.dryRun,
      })

      writeFileSync(outPath, agentYaml, 'utf-8')
      console.log(`✓ Written: ${outPath}`)
    })
}
