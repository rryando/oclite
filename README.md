# oclite

> A lean fork of [opencode](https://github.com/anomalyco/opencode) — the open source AI coding agent.

oclite strips opencode down to a focused core: a single unified system prompt, dynamic tool loading, and an enhanced TUI designed for ARCS-powered workflows.

---

## What's different from upstream

| Area | Change |
|------|--------|
| **Binary** | Ships as `oclite` alongside `opencode` |
| **System prompt** | Replaced 8 model-specific prompts with one lean unified prompt |
| **Tool loading** | `OPENCODE_LEAN_TOOLS=1` flag for dynamic tool loading (reduced startup noise) |
| **TUI** | Tool call blocks wrapped with border + status label |
| **TUI** | AI status indicator in session footer |
| **TUI** | Subagent count indicator in session footer |
| **TUI** | Accent border on user messages for visual hierarchy |
| **Branding** | ARCS logo + sidebar integration |

## Installation

Clone and install dependencies with [Bun](https://bun.sh):

```bash
git clone https://github.com/rryando/oclite
cd oclite
bun install
```

Run the dev build:

```bash
bun dev
# or directly
bun run packages/opencode/src/index.ts
```

Run as `oclite`:

```bash
bun run packages/opencode/src/bin/oclite.ts
```

## Usage

```bash
# Standard opencode entrypoint
opencode

# oclite lean entrypoint
oclite

# Enable lean tool loading (skip non-essential tools)
OPENCODE_LEAN_TOOLS=1 oclite
```

## Packages

| Package | Description |
|---------|-------------|
| `packages/opencode` | Main CLI, TUI, and agent runtime |
| `packages/core` | Shared core utilities |
| `packages/llm` | LLM provider abstractions |
| `packages/plugin` | Plugin system |
| `packages/sdk/js` | JavaScript SDK |
| `packages/script` | Build/codegen scripts |

## Development

```bash
# Type check
bun typecheck

# Lint
bun lint

# Regenerate JS SDK
./packages/sdk/js/script/build.ts
```

Tests must be run from within package directories, not from the repo root:

```bash
cd packages/opencode && bun test
```

## Upstream

This fork tracks the `dev` branch of [anomalyco/opencode](https://github.com/anomalyco/opencode). Changes are intentionally minimal — only what's needed for the ARCS workflow integration.

PRs that add scope beyond that mission will not be merged here. Contribute general improvements upstream instead.

## License

MIT — same as upstream opencode.
