import type { Command } from 'commander'
import chalk from 'chalk'
import { probeClaudeAuth, type ClaudeProbeReport } from '@agentspec/adapter-claude'
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

function renderCli(report: ClaudeProbeReport): void {
  const { cli } = report
  printSection('CLI (Claude subscription)')

  row('Installed', cli.installed ? chalk.green('yes') : chalk.red('no'), statusIcon(cli.installed))

  if (cli.version) {
    row('Version', chalk.cyan(cli.version))
  }

  if (cli.installed) {
    row(
      'Authenticated',
      cli.authenticated ? chalk.green('yes') : chalk.red('no — run: claude auth login'),
      statusIcon(cli.authenticated),
    )
  }

  if (cli.accountEmail) {
    row('Account', chalk.cyan(cli.accountEmail), tick)
  }

  if (cli.plan) {
    const planColor = cli.plan.toLowerCase().includes('max') || cli.plan.toLowerCase().includes('pro')
      ? chalk.green
      : chalk.yellow
    row('Plan', planColor(cli.plan), tick)
  }

  if (cli.activeModel) {
    row('Active model', chalk.cyan(cli.activeModel))
  }

  if (cli.authStatusRaw && !cli.authenticated) {
    console.log()
    console.log(chalk.dim('  Raw auth status output:'))
    for (const line of cli.authStatusRaw.split('\n').slice(0, 8)) {
      console.log(chalk.dim(`    ${line}`))
    }
  }
}

function renderApi(report: ClaudeProbeReport): void {
  const { api } = report
  printSection('API key (Anthropic)')

  row(
    'ANTHROPIC_API_KEY',
    api.keySet ? chalk.cyan(api.keyPreview ?? '') : chalk.red('not set'),
    statusIcon(api.keySet),
  )

  if (api.keySet) {
    const validLabel =
      api.keyValid === true  ? chalk.green('valid (HTTP 200)') :
      api.keyValid === false ? chalk.red(`rejected (${api.probeError ?? 'unknown'})`) :
                               chalk.dim('not checked')
    row('Key status', validLabel, statusIcon(api.keyValid))
  }

  row(
    'ANTHROPIC_BASE_URL',
    api.baseURLSet ? chalk.cyan(api.baseURL ?? '') : chalk.dim('not set (using default)'),
    api.baseURLSet ? tick : dash,
  )
}

function renderEnv(report: ClaudeProbeReport): void {
  const { env } = report
  printSection('Environment & resolution')

  row(
    'Auth mode override',
    env.authModeOverride
      ? chalk.cyan(`AGENTSPEC_CLAUDE_AUTH_MODE=${env.authModeOverride}`)
      : chalk.dim('not set (auto)'),
    env.authModeOverride ? warn : dash,
  )

  row(
    'Model override',
    env.modelOverride
      ? chalk.cyan(`ANTHROPIC_MODEL=${env.modelOverride}`)
      : chalk.dim(`not set (default: claude-opus-4-6)`),
    env.modelOverride ? warn : dash,
  )

  console.log()

  if (env.resolvedMode !== 'none') {
    const modeLabel =
      env.resolvedMode === 'cli'
        ? chalk.green('Claude subscription (CLI)')
        : chalk.green('Anthropic API key')
    console.log(`  ${tick} ${chalk.bold('Would use:')} ${modeLabel}`)
  } else {
    console.log(`  ${cross} ${chalk.bold('Would use:')} ${chalk.red('nothing — no auth available')}`)
    if (env.resolveError) {
      console.log()
      console.log(chalk.red('  Error:'))
      for (const line of env.resolveError.split('\n')) {
        console.log(`    ${line}`)
      }
    }
  }
}

function renderSummary(report: ClaudeProbeReport): void {
  const { cli, api, env } = report

  console.log()
  console.log(chalk.bold('─'.repeat(50)))

  if (env.resolvedMode === 'cli') {
    const plan = cli.plan ? ` (${cli.plan})` : ''
    const account = cli.accountEmail ? ` · ${cli.accountEmail}` : ''
    console.log(`${tick} ${chalk.bold.green(`Ready — Claude subscription${plan}${account}`)}`)
    console.log(chalk.dim('  agentspec generate and scan will use the claude CLI'))
  } else if (env.resolvedMode === 'api') {
    const valid = api.keyValid === true ? ' · key verified' : api.keyValid === false ? ' · key invalid' : ''
    console.log(`${tick} ${chalk.bold.green(`Ready — Anthropic API${valid}`)}`)
    console.log(chalk.dim('  agentspec generate and scan will use ANTHROPIC_API_KEY'))
  } else {
    console.log(`${cross} ${chalk.bold.red('Not ready — no Claude auth configured')}`)
    console.log()
    console.log('  Set up one of:')
    console.log(`    ${chalk.cyan('claude auth login')}                      ${chalk.dim('(subscription)')}`)
    console.log(`    ${chalk.cyan('export ANTHROPIC_API_KEY=sk-ant-...')}    ${chalk.dim('(API key)')}`)
  }
}

// ── Command ───────────────────────────────────────────────────────────────────

export function registerClaudeStatusCommand(program: Command): void {
  program
    .command('claude-status')
    .description('Show full Claude authentication status — subscription, API key, and active config')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      if (!opts.json) {
        printHeader('AgentSpec — Claude Status')
      }

      const report = await probeClaudeAuth()

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2))
        process.exit(report.env.resolvedMode === 'none' ? 1 : 0)
        return
      }

      renderCli(report)
      renderApi(report)
      renderEnv(report)
      renderSummary(report)
      console.log()

      process.exit(report.env.resolvedMode === 'none' ? 1 : 0)
    })
}
