# AGENTS.md — Chakra DSL

Instructions for coding agents (Copilot, Claude Code, Cursor, Codex, etc.) working in this repository.

---

## Install

```bash
npm install
npm run build
```

The project uses npm workspaces with four packages: `@chakra-dsl/core`, `@chakra-dsl/providers`, `@chakra-dsl/node`, `@chakra-dsl/cli`.

---

## Build

```bash
npm run build          # tsc --build (all packages via project references)
```

---

## Lint

```bash
npm run lint           # ESLint strict TypeScript checking
npm run lint:fix       # Auto-fix what's fixable
```

Rules enforced: `strictTypeChecked` + `stylisticTypeChecked` from `typescript-eslint`. Key rules include `no-explicit-any`, `strict-boolean-expressions`, `explicit-member-accessibility`, `consistent-type-imports`, `no-floating-promises`.

---

## Test

```bash
npm test               # vitest run (all tests)
npx vitest run tests/unit          # unit tests only
npx vitest run tests/integration   # integration tests (requires OPENROUTER_API_KEY in .env)
```

Integration tests hit a live LLM API. Unit tests are fully offline.

---

## Run the Application

### CLI usage

```bash
# Validate a program definition
npx chakra validate path/to/program.yaml

# Run a program
OPENROUTER_API_KEY=your-key npx chakra run path/to/program.yaml

# Inspect a trace log
npx chakra inspect path/to/trace.jsonl

# Scaffold a new program
npx chakra init my-program
```

### Programmatic usage (TypeScript)

```typescript
import { GraphBuilder, Runner, compile } from '@chakra-dsl/core';
import { OpenRouterProvider } from '@chakra-dsl/providers';
import { StdioUserIO } from '@chakra-dsl/node';

const program = new GraphBuilder('my-agent')
  .defaults({ model: 'claude-sonnet-4-6' })
  .channel('notes', { mode: 'append' })
  .roundStart('rs')
  .actor('thinker', { type: 'llm', subscribe: ['transcript', 'notes'], prompt: '...' })
  .effect('emit', { effectType: 'emit_to_user' })
  .roundEnd('re', { maxIterations: 5 })
  .build();

const { program: compiled } = compile(program);
const controller = new Runner(compiled, {
  provider: new OpenRouterProvider({ apiKey: process.env.OPENROUTER_API_KEY }),
  io: new StdioUserIO(),
});
await controller.run();
```

---

## Deploy to Cloudflare

This repo currently deploys two Cloudflare surfaces:

- `packages/worker` → Workers service `chakra-agent`
- `packages/studio` → Pages project `chakra-studio`

### Worker deploy

Worker config lives in `packages/worker/wrangler.toml` and currently maps the custom domain `agent.chakra.ucalyptus.me`.

Required Worker secrets:

```bash
cd packages/worker
wrangler secret put OPENROUTER_API_KEY
wrangler secret put AUTH_USERNAME
wrangler secret put AUTH_PASSWORD
```

Deploy the Worker:

```bash
npm run deploy:worker
```

### Pages deploy

Pages config lives in `packages/studio/wrangler.toml` and uses `dist/` as the build output directory.

Build and deploy the Studio:

```bash
npm run build:studio
npm run deploy:studio
```

The Pages deploy script publishes to branch `master` so deployment metadata matches the repository default branch.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | For runtime | OpenRouter API key for LLM calls |
| `ANTHROPIC_API_KEY` | Optional | Direct Anthropic provider |
| `OPENAI_API_KEY` | Optional | Direct OpenAI provider |
| `MAX_CONCURRENCY` | Optional | Max parallel actor calls (default: 5) |

Store in `.env` at repo root (git-ignored).

---

## Git

- Never add Co-authored-by trailers to commits.
- Commit as `ucalyptus <sdas.codes@gmail.com>`.
- Do not rewrite git history on shared branches.

---

## Architecture

```
packages/
├── core/         # Schema, compiler, runtime, memory, events, builder (platform-agnostic)
│   └── src/
│       ├── schema/        # Types, Zod validation
│       ├── compiler/      # IR, static analyzer, prompt compiler
│       ├── runtime/       # Runner, executors (node, actor, router, await, effect, scheduler)
│       ├── memory/        # Channel memory, transcript
│       ├── events/        # Event bus, typed events, logger, replay
│       ├── builder/       # Fluent GraphBuilder, shortcuts, templates
│       ├── advanced/      # Conditional wiring, nested programs, streaming, checkpointing, cost control, adaptive instances
│       ├── visualization/ # Mermaid/DOT graph renderer, terminal execution view, memory inspector
│       └── testing/       # Test harness (mock I/O), fluent assertions, fixture programs
├── providers/    # LLM provider adapters (OpenRouter, Anthropic, OpenAI, Local, Mock)
├── node/         # Node.js I/O bridges (stdio, WebSocket, callback) + tools
└── cli/          # CLI commands (run, validate, inspect, init)
```

See `PLAN.md` for the full design document.

---

## Quality Gates (Copilot CLI Hook)

A pre-commit/push hook at `.github/hooks/quality-gates.json` runs lint + unit tests before allowing `git commit` or `git push` through Copilot CLI. Both must pass for the operation to proceed.

---

## Type Checking (standalone)

```bash
npx -y -p typescript tsc -p packages/core/tsconfig.json --noEmit
```
