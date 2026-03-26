# Claude Authentication

Configure how AgentSpec connects to Claude for code generation (`agentspec generate`) and source scanning (`agentspec scan`).

## Overview

AgentSpec supports two authentication methods and automatically picks the right one — no configuration required in most cases.

| Method | Who it's for | What you need |
|--------|-------------|---------------|
| **Claude subscription** (Pro / Max) | Anyone with a Claude.ai paid plan | Claude CLI installed and logged in |
| **Anthropic API key** | Teams using the API directly | `ANTHROPIC_API_KEY` env var |

When both are available, **Claude subscription is used first**. You can override this at any time.

---

## Check your current status

Before setting anything up, run:

```bash
agentspec claude-status
```

This shows exactly what is installed, whether you are authenticated, which plan you are on, and which method `generate` / `scan` will use right now.

```
  AgentSpec — Claude Status
  ───────────────────────────

CLI (Claude subscription)
  ✓ Installed              yes
    Version                2.1.81 (Claude Code)
  ✓ Authenticated          yes
  ✓ Account                you@example.com
  ✓ Plan                   Claude Pro

API key (Anthropic)
  ✗ ANTHROPIC_API_KEY      not set
  – ANTHROPIC_BASE_URL     not set (using default)

Environment & resolution
  – Auth mode override     not set (auto)
  – Model override         not set (default: claude-opus-4-6)

  ✓ Would use: Claude subscription (CLI)

──────────────────────────────────────────────────
✓ Ready — Claude subscription (Claude Pro) · you@example.com
```

Machine-readable output for CI:

```bash
agentspec claude-status --json
```

Exit codes: `0` = ready, `1` = no auth configured.

---

## Method 1 — Claude Subscription (Pro / Max)

Use your existing Claude.ai subscription. No API key or token cost — usage is covered by your plan.

### Prerequisites

- [ ] Claude Pro or Max subscription at [claude.ai](https://claude.ai)
- [ ] Claude CLI installed

### 1. Install the Claude CLI

```bash
# macOS
brew install claude

# or download directly
# https://claude.ai/download
```

Verify:

```bash
claude --version
```

### 2. Authenticate

```bash
claude auth login
```

This opens a browser window. Sign in with your Claude.ai account. Your session is stored locally.

Verify authentication status:

```bash
claude auth status
```

### 3. Run AgentSpec

No env vars needed:

```bash
agentspec generate agent.yaml --framework langgraph
```

The spinner shows which method is active:

```
  Generating with Claude (subscription) · 12.4k chars
```

---

## Method 2 — Anthropic API Key

Use a direct Anthropic API key. Required for CI pipelines, Docker environments, or teams without a subscription.

### 1. Get an API key

Create a key at [console.anthropic.com](https://console.anthropic.com) → API Keys → Create key.

### 2. Set the env var

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

For permanent use, add it to your shell profile or `.env` file.

### 3. Run AgentSpec

```bash
agentspec generate agent.yaml --framework langgraph
```

The spinner shows:

```
  Generating with claude-opus-4-6 (API) · 12.4k chars
```

---

## Resolution order (auto mode)

When `AGENTSPEC_CODEGEN_PROVIDER` is not set, AgentSpec resolves auth in this order:

```
1. Claude CLI installed + logged in?  →  use subscription
2. ANTHROPIC_API_KEY set?             →  use API
3. Neither                            →  error with both setup options
```

This means **subscription always wins when available**. If you have both, the API key is ignored unless you force it.

---

## Force a specific method

```bash
# Always use subscription (fails fast if not logged in)
export AGENTSPEC_CODEGEN_PROVIDER=claude-sub

# Always use API key (skips CLI check entirely)
export AGENTSPEC_CODEGEN_PROVIDER=anthropic-api

# Use OpenAI Codex
export AGENTSPEC_CODEGEN_PROVIDER=codex
```

Useful for CI where you want explicit control and no ambiguity.

---

## Model selection

The default model is `claude-opus-4-6`. Override with:

```bash
export ANTHROPIC_MODEL=claude-sonnet-4-6
```

This works in both subscription and API mode.

---

## Proxy / custom base URL (API mode only)

Route API requests through a proxy:

```bash
export ANTHROPIC_BASE_URL=https://my-proxy.example.com
```

Only applies when `AGENTSPEC_CODEGEN_PROVIDER=anthropic-api` or when auto-resolved to API mode.

---

## CI / CD setup

In CI there is no interactive login, so API key mode is the right choice:

```yaml
# GitHub Actions
env:
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  AGENTSPEC_CODEGEN_PROVIDER: anthropic-api   # explicit — skip any CLI check
```

```yaml
# GitLab CI
variables:
  ANTHROPIC_API_KEY: $ANTHROPIC_API_KEY
  AGENTSPEC_CODEGEN_PROVIDER: anthropic-api
```

---

## Error messages

| Error | Cause | Fix |
|-------|-------|-----|
| `No Claude authentication found` | Neither CLI nor API key available | Install Claude CLI and log in, or set `ANTHROPIC_API_KEY` |
| `AGENTSPEC_CODEGEN_PROVIDER=claude-sub but claude is not authenticated` | Forced CLI mode, not logged in | Run `claude auth login` |
| `AGENTSPEC_CODEGEN_PROVIDER=anthropic-api but ANTHROPIC_API_KEY is not set` | Forced API mode, no key | Set `ANTHROPIC_API_KEY` |
| `Claude CLI timed out after 300s` | Generation too large for default timeout | Use `--framework` with a smaller manifest, or switch to API mode |
| `Claude CLI is not authenticated` | CLI installed but session expired | Run `claude auth login` again |

---

## See also

- [Framework Adapters](../concepts/adapters) — how generation works
- [agentspec generate](../reference/cli#generate) — CLI reference
- [agentspec scan](../reference/cli#scan) — scan source code into a manifest
