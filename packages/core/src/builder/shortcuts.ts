import { GraphBuilder } from './graph-builder.js';
import type { Graph } from '../schema/types.js';

/**
 * Common workflow patterns as one-liner shortcuts.
 */

/** Simple linear chain: actor → emit → loop_end */
export function linearActor(
  name: string,
  opts: { model?: string; prompt: string; subscribe?: string[] },
): Graph {
  return new GraphBuilder(name)
    .defaults({ model: opts.model })
    .roundStart('rs')
    .actor('main_actor', {
      type: 'llm',
      prompt: opts.prompt,
      subscribe: opts.subscribe ?? ['transcript'],
    })
    .effect('emit', { effectType: 'emit_to_user' })
    .roundEnd('re', { maxIterations: 1 })
    .build();
}

/** Debate pattern: N actors argue, then a judge synthesizes */
export function debate(
  name: string,
  opts: {
    model?: string;
    debaters: { id: string; prompt: string }[];
    judgePrompt: string;
    rounds?: number;
  },
): Graph {
  const builder = new GraphBuilder(name)
    .defaults({ model: opts.model })
    .store('arguments', { mode: 'append' })
    .roundStart('rs');

  for (const debater of opts.debaters) {
    builder.actor(debater.id, {
      type: 'llm',
      prompt: debater.prompt,
      subscribe: ['arguments'],
      publish: 'arguments',
      after: 'rs',
    });
  }

  // Join to wait for all debaters
  builder.awaitAll('debate_sync', {
    count: opts.debaters.length,
    after: opts.debaters[opts.debaters.length - 1].id,
  });

  // Wire remaining debaters to the join (not just the last one)
  for (let i = 0; i < opts.debaters.length - 1; i++) {
    builder.edge(opts.debaters[i].id, 'debate_sync');
  }

  builder.actor('judge', {
    type: 'llm',
    prompt: opts.judgePrompt,
    subscribe: ['arguments'],
    after: 'debate_sync',
  });

  builder.effect('emit', { effectType: 'emit_to_user', after: 'judge' });
  builder.roundEnd('re', { after: 'emit', maxIterations: opts.rounds ?? 3 });

  return builder.build();
}

/** Chain of thought: sequential actors, each building on the previous */
export function chainOfThought(
  name: string,
  opts: {
    model?: string;
    steps: { id: string; prompt: string }[];
    store?: string;
  },
): Graph {
  const storeId = opts.store ?? 'reasoning';
  const builder = new GraphBuilder(name)
    .defaults({ model: opts.model })
    .store(storeId, { mode: 'append' })
    .roundStart('rs');

  let lastId = 'rs';
  for (const step of opts.steps) {
    builder.actor(step.id, {
      type: 'llm',
      prompt: step.prompt,
      subscribe: [storeId],
      publish: storeId,
      after: lastId,
    });
    lastId = step.id;
  }

  builder.effect('emit', { effectType: 'emit_to_user', after: lastId });
  builder.roundEnd('re', { after: 'emit', maxIterations: 1 });

  return builder.build();
}

/** Interactive loop: actor thinks, emits, waits for user, loops */
export function interactiveLoop(
  name: string,
  opts: { model?: string; systemPrompt: string; maxIterations?: number },
): Graph {
  return new GraphBuilder(name)
    .defaults({ model: opts.model, maxIterations: opts.maxIterations ?? 50 })
    .store('notes', { mode: 'append' })
    .roundStart('rs')
    .actor('assistant', {
      type: 'llm',
      prompt: opts.systemPrompt,
      subscribe: ['transcript', 'notes'],
      publish: 'notes',
    })
    .effect('emit', { effectType: 'emit_to_user' })
    .effect('wait', { effectType: 'wait_for_user' })
    .roundEnd('re')
    .build();
}
