import type { Command } from 'commander'
import chalk from 'chalk'
import { probeProviders, type ProviderProbeReport } from '@agentspec/codegen'
import { printHeader } from '../utils/output.js'

// ── Formatters ────────────────────────────────────────────────────────────────

const tick  = chalk.green('✓')
const cross = chalk.red('✗')
const dash  = chalk.dim('–')
const warn  = chalk.yellow('!')

function statusIcon(ok: boolean | null): string {
  if (ok === true)  return tick
  if (ok === false) return cross
  return dash
}

function printSection(title: string): void {
  console.log()
  console.log(chalk.bold.underline(title))
}

function row(label: string, value: string, icon?: string): void {
  const iconPart = icon ? `${icon} ` : '  '
  console.log(`  ${iconPart}${chalk.dim(label.padEnd(22))} ${value}`)
}

// ── Section renderers ─────────────────────────────────────────────────────────

function renderClaudeCli(report: ProviderProbeReport): void {
  const { claudeCli } = report
  printSection('Claude subscription')

  row('Installed', claudeCli.installed ? chalk.green('yes') : chalk.red('no'), statusIcon(claudeCli.installed))

  if (claudeCli.version) {
    row('Version', chalk.cyan(claudeCli.version))
  }

  if (claudeCli.installed) {
    row(
      'Authenticated',
      claudeCli.authenticated ? chalk.green('yes') : chalk.red('no — run: claude auth login'),
      statusIcon(claudeCli.authenticated),
    )
  }

  if (claudeCli.accountEmail) {
    row('Account', chalk.cyan(claudeCli.accountEmail), tick)
  }

  if (claudeCli.plan) {
    const planColor = claudeCli.plan.toLowerCase().includes('max') || claudeCli.plan.toLowerCase().includes('pro')
      ? chalk.green
      : chalk.yellow
    row('Plan', planColor(claudeCli.plan), tick)
  }

  if (claudeCli.activeModel) {
    row('Active model', chalk.cyan(claudeCli.activeModel))
  }

  if (claudeCli.authStatusRaw && !claudeCli.authenticated) {
    console.log()
    console.log(chalk.dim('  Raw auth status output:'))
    for (const line of claudeCli.authStatusRaw.split('\n').slice(0, 8)) {
      console.log(chalk.dim(`    ${line}`))
    }
  }
}

function renderAnthropicApi(report: ProviderProbeReport): void {
  const { anthropicApi } = report
  printSection('Anthropic API')

  row(
    'ANTHROPIC_API_KEY',
    anthropicApi.keySet ? chalk.cyan(anthropicApi.keyPreview ?? '') : chalk.red('not set'),
    statusIcon(anthropicApi.keySet),
  )

  if (anthropicApi.keySet) {
    const validLabel =
      anthropicApi.keyValid === true  ? chalk.green('valid (HTTP 200)') :
      anthropicApi.keyValid === false ? chalk.red(`rejected (${anthropicApi.probeError ?? 'unknown'})`) :
                               chalk.dim('not checked')
    row('Key status', validLabel, statusIcon(anthropicApi.keyValid))
  }

  row(
    'ANTHROPIC_BASE_URL',
    anthropicApi.baseURLSet ? chalk.cyan(anthropicApi.baseURL ?? '') : chalk.dim('not set (using default)'),
    anthropicApi.baseURLSet ? tick : dash,
  )
}

function providerLabel(name: string): string {
  switch (name) {
    case 'claude-subscription': return 'Claude subscription'
    case 'anthropic-api':       return 'Anthropic API'
    case 'codex':               return 'Codex (OpenAI)'
    default:                    return name
  }
}

function renderEnv(report: ProviderProbeReport): void {
  const { env } = report
  printSection('Environment & resolution')

  row(
    'Provider override',
    env.providerOverride
      ? chalk.cyan(`AGENTSPEC_CODEGEN_PROVIDER=${env.providerOverride}`)
      : chalk.dim('not set (auto-detect)'),
    env.providerOverride ? warn : dash,
  )

  row(
    'Model override',
    env.modelOverride
      ? chalk.cyan(`ANTHROPIC_MODEL=${env.modelOverride}`)
      : chalk.dim(`not set (default: claude-opus-4-6)`),
    env.modelOverride ? warn : dash,
  )

  console.log()

  if (env.resolvedProvider) {
    console.log(`  ${tick} ${chalk.bold('Would use:')} ${chalk.green(providerLabel(env.resolvedProvider))}`)
  } else {
    console.log(`  ${cross} ${chalk.bold('Would use:')} ${chalk.red('nothing — no provider available')}`)
    if (env.resolveError) {
      console.log()
      console.log(chalk.red('  Error:'))
      for (const line of env.resolveError.split('\n')) {
        console.log(`    ${line}`)
      }
    }
  }
}

function renderSummary(report: ProviderProbeReport): void {
  const { claudeCli, anthropicApi, env } = report

  console.log()
  console.log(chalk.bold('─'.repeat(50)))

  if (!env.resolvedProvider) {
    console.log(`${cross} ${chalk.bold.red('Not ready — no codegen provider available')}`)
    console.log()
    console.log('  Set up one of:')
    console.log(`    ${chalk.cyan('claude auth login')}                      ${chalk.dim('(claude-subscription)')}`)
    console.log(`    ${chalk.cyan('export ANTHROPIC_API_KEY=sk-ant-...')}    ${chalk.dim('(anthropic-api)')}`)
    console.log(`    ${chalk.cyan('export OPENAI_API_KEY=sk-...')}           ${chalk.dim('(codex)')}`)
    return
  }

  const label = providerLabel(env.resolvedProvider)

  if (env.resolvedProvider === 'claude-subscription') {
    const plan = claudeCli.plan ? ` (${claudeCli.plan})` : ''
    const account = claudeCli.accountEmail ? ` · ${claudeCli.accountEmail}` : ''
    console.log(`${tick} ${chalk.bold.green(`Ready — ${label}${plan}${account}`)}`)
  } else if (env.resolvedProvider === 'anthropic-api') {
    const valid = anthropicApi.keyValid === true ? ' · key verified' : anthropicApi.keyValid === false ? ' · key invalid' : ''
    console.log(`${tick} ${chalk.bold.green(`Ready — ${label}${valid}`)}`)
  } else {
    console.log(`${tick} ${chalk.bold.green(`Ready — ${label}`)}`)
  }

  console.log(chalk.dim(`  agentspec generate and scan will use the ${env.resolvedProvider} provider`))
}

// ── Command ───────────────────────────────────────────────────────────────────

export function registerProviderStatusCommand(program: Command): void {
  program
    .command('provider-status')
    .description('Show codegen provider status — Claude subscription, Anthropic API, Codex, and active config')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      if (!opts.json) {
        printHeader('AgentSpec — Provider Status')
      }

      const report = await probeProviders()

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2))
        process.exit(!report.env.resolvedProvider ? 1 : 0)
        return
      }

      renderClaudeCli(report)
      renderAnthropicApi(report)
      renderEnv(report)
      renderSummary(report)
      console.log()

      process.exit(!report.env.resolvedProvider ? 1 : 0)
    })
}
