import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { Command } from 'commander'
import chalk from 'chalk'
import { loadManifest, runHealthCheck, type HealthCheck } from '@agentspec/sdk'
import { symbols, formatHealthStatus, printHeader, printError } from '../utils/output.js'

// ── .env loader ───────────────────────────────────────────────────────────────

/**
 * Parse a .env file and inject missing keys into process.env.
 * Only sets vars that are not already set (environment wins over .env).
 */
function loadDotEnv(envPath: string): void {
  let raw: string
  try {
    raw = readFileSync(envPath, 'utf-8')
  } catch {
    return
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
    if (key && !(key in process.env)) {
      process.env[key] = val
    }
  }
}

// ── Command ───────────────────────────────────────────────────────────────────

export function registerHealthCommand(program: Command): void {
  program
    .command('health <file>')
    .description('Run runtime health checks against all declared dependencies')
    .option('--json', 'Output as JSON')
    .option('--format <fmt>', 'Output format: table|json', 'table')
    .option('--fail-on <level>', 'Exit 1 on: error|warning|info', 'error')
    .option('--no-model', 'Skip model API reachability checks')
    .option('--no-mcp', 'Skip MCP server checks')
    .option('--no-memory', 'Skip memory backend checks')
    .option('--env-file <path>', 'Load env vars from a .env file before running checks')
    .action(
      async (
        file: string,
        opts: {
          json?: boolean
          format?: string
          failOn?: string
          model?: boolean
          mcp?: boolean
          memory?: boolean
          envFile?: string
        },
      ) => {
        // Load env vars before any checks so $env: refs resolve correctly.
        // Explicit --env-file wins; otherwise auto-detect .env beside the manifest.
        const manifestDir = dirname(resolve(file))
        const envFilePath = opts.envFile
          ? resolve(opts.envFile)
          : join(manifestDir, '.env')
        if (existsSync(envFilePath)) {
          loadDotEnv(envFilePath)
        }

        let manifest: Awaited<ReturnType<typeof loadManifest>>
        try {
          manifest = loadManifest(file, { resolve: false })
        } catch (err) {
          printError(`Cannot load manifest: ${String(err)}`)
          process.exit(1)
        }

        const report = await runHealthCheck(manifest.manifest, {
          checkModel: opts.model !== false,
          checkMcp: opts.mcp !== false,
          checkMemory: opts.memory !== false,
          baseDir: manifest.baseDir,
          rawManifest: manifest.manifest, // raw unresolved for ref collection
        })

        if (opts.json || opts.format === 'json') {
          console.log(JSON.stringify(report, null, 2))
          process.exit(shouldFail(report.checks, opts.failOn ?? 'error') ? 1 : 0)
          return
        }

        // Table output
        printHeader(`AgentSpec Health — ${manifest.manifest.metadata.name}`)
        console.log(`  Status: ${formatHealthStatus(report.status)}`)
        console.log(
          chalk.gray(
            `  Passed: ${chalk.green(report.summary.passed)}  ` +
              `Failed: ${chalk.red(report.summary.failed)}  ` +
              `Skipped: ${chalk.gray(report.summary.skipped)}`,
          ),
        )
        console.log()

        const grouped = groupByCategory(report.checks)
        for (const [category, checks] of Object.entries(grouped)) {
          console.log(chalk.bold(`  ${category.toUpperCase()}`))
          for (const check of checks) {
            const icon =
              check.status === 'pass'
                ? symbols.pass
                : check.status === 'fail'
                  ? symbols.fail
                  : check.status === 'warn'
                    ? symbols.warn
                    : symbols.skip

            const latency = check.latencyMs ? chalk.gray(` (${check.latencyMs}ms)`) : ''
            console.log(`    ${icon} ${chalk.white(check.id)}${latency}`)

            if (check.message) {
              console.log(`       ${chalk.gray(check.message)}`)
            }
            if (check.remediation && check.status === 'fail') {
              console.log(`       ${chalk.cyan('→')} ${chalk.cyan(check.remediation)}`)
            }
          }
          console.log()
        }

        const failed = shouldFail(report.checks, opts.failOn ?? 'error')
        if (failed) process.exit(1)
      },
    )
}

function groupByCategory(checks: HealthCheck[]): Record<string, HealthCheck[]> {
  const groups: Record<string, HealthCheck[]> = {}
  for (const check of checks) {
    if (!groups[check.category]) groups[check.category] = []
    groups[check.category].push(check)
  }
  return groups
}

function shouldFail(checks: HealthCheck[], failOn: string): boolean {
  const failedChecks = checks.filter((c) => c.status === 'fail')
  if (failOn === 'info') return failedChecks.length > 0
  if (failOn === 'warning') {
    return failedChecks.some((c) => c.severity === 'error' || c.severity === 'warning')
  }
  return failedChecks.some((c) => c.severity === 'error')
}
