# Chakra

A round-based cognitive workflow engine. Declarative DSL for programmable reasoning topologies.

The diagram is not documentation of code. **The diagram IS source code.**

## What it does

Chakra lets you specify the *shape* of multi-agent reasoning — actors, branching, memory, concurrency, aggregation — as a directed graph. The runtime executes it in discrete rounds.

```typescript
import { GraphBuilder, Runner, compile } from '@chakra-dsl/core';
import { OpenRouterProvider } from '@chakra-dsl/providers';

const program = new GraphBuilder('deep-reasoner')
  .defaults({ model: 'minimax/minimax-01', maxIterations: 5 })
  .store('working_ledger', { mode: 'replace' })
  .roundStart('rs1')
  .actor('orchestrator', {
    type: 'llm',
    subscribe: ['transcript', 'working_ledger'],
    publish: 'working_ledger',
    prompt: 'You are a reasoning orchestrator. Decide: reason or respond.',
  })
  .roundEnd('re1', { maxIterations: 5 })
  .build();

const { program: compiled } = compile(program);
const result = await new Runner(compiled, {
  provider: new OpenRouterProvider({ apiKey: process.env.OPENROUTER_API_KEY! }),
  io: { emit: async (msg) => console.log(msg), waitForInput: async () => '' },
}).run();
```

## Primitives

Six node types compose every program:

| Primitive | Purpose |
|-----------|---------|
| **Actor** | LLM inference or autonomous agent loop |
| **Router** | Branch selection (LLM-driven or expression) |
| **Effect** | Side effects: user I/O, store writes, webhooks |
| **AwaitAll** | Synchronization barrier for parallel actors |
| **Store** | Persistent named data (append/replace, FIFO, token budgets) |
| **Round Start / Round End** | Round control with halt conditions |

## Architecture

```
@chakra-dsl/core        Zero platform deps. Types, compiler, runtime, memory, events.
@chakra-dsl/providers   LLM adapters (fetch-only, Workers-compatible).
@chakra-dsl/node        Node.js bindings: stdio, filesystem tools.
@chakra-dsl/cli         CLI: run, validate, inspect.
```

Core never imports platform bindings. Provider and I/O are dependency-injected.

## Install

```bash
npm install
npm test        # 24 unit + 2 integration tests
```

## License

MIT
