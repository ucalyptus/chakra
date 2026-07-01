import type { Graph } from '../schema/types.js';
import { GraphBuilder } from '../builder/graph-builder.js';

/**
 * Reusable test program definitions / fixtures.
 */

/** Minimal single-actor program — one round, one LLM call */
export function singleActorFixture(prompt = 'Hello'): Graph {
  return new GraphBuilder('test-single')
    .defaults({ model: 'mock' })
    .roundStart('rs')
    .actor('actor1', {
      type: 'llm',
      subscribe: ['transcript'],
      prompt,
    })
    .roundEnd('re', { maxIterations: 1 })
    .build();
}

/** Two-actor chain — sequential execution */
export function chainFixture(): Graph {
  return new GraphBuilder('test-chain')
    .defaults({ model: 'mock' })
    .roundStart('rs')
    .actor('first', {
      type: 'llm',
      subscribe: ['transcript'],
      prompt: 'First step',
    })
    .actor('second', {
      type: 'llm',
      subscribe: ['transcript'],
      prompt: 'Second step',
    })
    .roundEnd('re', { maxIterations: 1 })
    .build();
}

/** Router branching — LLM decides which path */
export function routerFixture(): Graph {
  return new GraphBuilder('test-router')
    .defaults({ model: 'mock' })
    .channel('notes', { mode: 'append' })
    .roundStart('rs')
    .actor('decider', {
      type: 'llm',
      subscribe: ['transcript'],
      prompt: 'Decide: say <decision>alpha</decision> or <decision>beta</decision>',
    })
    .router('branch', {
      mode: 'llm_driven',
      branches: { alpha: 'actor_a', beta: 'actor_b' },
    })
    .actor('actor_a', {
      type: 'llm',
      subscribe: ['notes'],
      prompt: 'Alpha path',
      after: 'branch',
    })
    .actor('actor_b', {
      type: 'llm',
      subscribe: ['notes'],
      prompt: 'Beta path',
      after: 'branch',
    })
    .roundEnd('re', { after: 'actor_a', maxIterations: 1 })
    .edge('actor_b', 're', 'control')
    .build();
}

/** Parallel instances — actor with instances: 3 */
export function parallelFixture(): Graph {
  return new GraphBuilder('test-parallel')
    .defaults({ model: 'mock' })
    .roundStart('rs')
    .actor('parallel_actor', {
      type: 'llm',
      subscribe: ['transcript'],
      prompt: 'Think divergently',
      instances: 3,
    })
    .awaitAll('sync', { count: 3, after: 'parallel_actor' })
    .actor('synthesizer', {
      type: 'llm',
      subscribe: ['transcript'],
      prompt: 'Synthesize the outputs',
      after: 'sync',
    })
    .roundEnd('re', { after: 'synthesizer', maxIterations: 1 })
    .build();
}

/** Interactive loop — emit + wait for user */
export function interactiveFixture(): Graph {
  return new GraphBuilder('test-interactive')
    .defaults({ model: 'mock', maxIterations: 3 })
    .roundStart('rs')
    .actor('responder', {
      type: 'llm',
      subscribe: ['transcript'],
      prompt: 'Respond to the user',
    })
    .effect('emit', { effectType: 'emit_to_user' })
    .effect('wait', { effectType: 'wait_for_user' })
    .roundEnd('re')
    .build();
}

/** Memory channels — publish/subscribe pattern */
export function memoryFixture(): Graph {
  return new GraphBuilder('test-memory')
    .defaults({ model: 'mock' })
    .channel('working', { mode: 'replace' })
    .channel('log', { mode: 'append', maxEntries: 5 })
    .roundStart('rs')
    .actor('writer', {
      type: 'llm',
      subscribe: ['transcript'],
      publish: 'working',
      prompt: 'Write something to working memory',
    })
    .actor('reader', {
      type: 'llm',
      subscribe: ['working'],
      publish: 'log',
      prompt: 'Read working memory: {{channel:working}}',
      after: 'writer',
    })
    .roundEnd('re', { after: 'reader', maxIterations: 2 })
    .build();
}

/** Multi-round deliberation — the reference pattern */
export function deliberationFixture(): Graph {
  return new GraphBuilder('test-deliberation')
    .defaults({ model: 'mock', maxIterations: 3 })
    .channel('ledger', { mode: 'replace' })
    .channel('notes', { mode: 'append' })
    .roundStart('rs')
    .actor('orchestrator', {
      type: 'llm',
      subscribe: ['transcript', 'notes', 'ledger'],
      publish: 'notes',
      prompt: 'Orchestrate. Say <decision>reason</decision> to think more or <decision>done</decision> to finish.',
    })
    .router('choose', {
      mode: 'llm_driven',
      branches: { reason: 'thinker', done: 'emit' },
    })
    .actor('thinker', {
      type: 'llm',
      subscribe: ['ledger', 'notes'],
      publish: 'ledger',
      prompt: 'Think deeply about the problem. {{channel:notes}}',
      after: 'choose',
    })
    .effect('emit', {
      effectType: 'emit_to_user',
      after: 'choose',
    })
    .roundEnd('re', { after: 'thinker' })
    .edge('emit', 're', 'control')
    .build();
}
