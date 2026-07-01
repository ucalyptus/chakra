import { describe, it, expect } from 'vitest';
import { GraphBuilder, compile, Runner } from '@chakra-dsl/core';
import { OpenRouterProvider } from '@chakra-dsl/providers';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(import.meta.dirname, '../../.env') });

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

describe('Integration: OpenRouter with minimax-m3', () => {
  it('runs a simple deliberation loop with a real LLM', async () => {
    if (!OPENROUTER_API_KEY) {
      console.warn('Skipping: OPENROUTER_API_KEY not set');
      return;
    }

    const program = new GraphBuilder('openrouter-test')
      .defaults({ model: 'minimax/minimax-01', maxIterations: 2, temperature: 0.7 })
      .channel('working_ledger', { mode: 'replace' })
      .roundStart('rs1')
      .actor('thinker', {
        type: 'llm',
        name: 'Thinker',
        subscribe: ['transcript', 'working_ledger'],
        publish: 'working_ledger',
        prompt: `You are a reasoning agent. Think about the topic "What makes a good software library?" and produce a concise insight (2-3 sentences max). {{channel:working_ledger}}`,
      })
      .roundEnd('re1', { maxIterations: 2 })
      .build();

    const { program: compiled } = compile(program);

    const provider = new OpenRouterProvider({
      apiKey: OPENROUTER_API_KEY,
      defaultModel: 'minimax/minimax-01',
    });

    const outputs: string[] = [];
    const controller = new Runner(compiled, {
      provider,
      io: {
        emit: async (msg) => { outputs.push(msg); },
        waitForInput: async () => '',
      },
      onEvent: (event) => {
        if (event.type === 'actor.complete') {
          console.log(`  [Round actor.complete] ${event.output.slice(0, 80)}...`);
        }
      },
    });

    const result = await controller.run();

    console.log(`Completed ${result.rounds} rounds`);
    console.log(`Trace events: ${result.trace.getEvents().length}`);
    console.log(`Working ledger final: ${result.finalMemory.get('working_ledger')?.slice(0, 200)}`);

    expect(result.rounds).toBe(2);
    expect(result.halted).toBe(true);
    expect(result.finalMemory.get('working_ledger')).toBeTruthy();
    expect(result.trace.getEventsByType('actor.complete').length).toBe(2);
  }, 60000); // 60s timeout for LLM calls

  it('runs the reference deep-reasoner pattern (simplified)', async () => {
    if (!OPENROUTER_API_KEY) {
      console.warn('Skipping: OPENROUTER_API_KEY not set');
      return;
    }

    const program = new GraphBuilder('deep-reasoner-mini')
      .defaults({ model: 'minimax/minimax-01', maxIterations: 1 })
      .channel('private_notes', { mode: 'append' })
      .channel('working_ledger', { mode: 'replace', initialValue: 'Topic: Design patterns for LLM applications' })
      .roundStart('rs1')
      .actor('orchestrator', {
        type: 'llm',
        name: 'Orchestrator',
        subscribe: ['transcript', 'private_notes', 'working_ledger'],
        publish: 'private_notes',
        prompt: `You are the orchestrator of a reasoning process.
Current working ledger: {{channel:working_ledger}}
Your private notes: {{channel:private_notes}}

Decide your next move. End with <decision>reason</decision> to reason more, or <decision>emit</decision> to share with user.`,
      })
      .router('choose_move', {
        mode: 'llm_driven',
        branches: {
          'reason': 'problem_solver',
          'emit': 'emit_user',
        },
      })
      .build();

    // Add branch targets
    program.nodes.push(
      {
        type: 'actor', id: 'problem_solver', name: 'Problem Solver',
        actor_type: 'llm', subscribe: ['working_ledger'],
        prompt_template: 'Analyze: {{channel:working_ledger}}. Provide one key insight.',
        publish: 'working_ledger',
      },
      {
        type: 'tool', id: 'emit_user', name: 'Emit to user',
        tool_type: 'emit_to_user', config: {},
      },
      { type: 'loop_end', id: 're1', max_iterations: 1 },
    );
    program.edges.push(
      { from: 'choose_move', to: 'problem_solver', type: 'control' },
      { from: 'choose_move', to: 'emit_user', type: 'control' },
      { from: 'problem_solver', to: 're1', type: 'control' },
      { from: 'emit_user', to: 're1', type: 'control' },
    );

    const { program: compiled } = compile(program);

    const provider = new OpenRouterProvider({
      apiKey: OPENROUTER_API_KEY,
      defaultModel: 'minimax/minimax-01',
    });

    const userOutputs: string[] = [];
    const controller = new Runner(compiled, {
      provider,
      io: {
        emit: async (msg) => { userOutputs.push(msg); },
        waitForInput: async () => '',
      },
    });

    const result = await controller.run();

    console.log(`Deep reasoner: ${result.rounds} rounds, ${result.trace.getEvents().length} events`);
    console.log(`Router taken: ${JSON.stringify(result.trace.getEventsByType('router.evaluated'))}`);

    expect(result.rounds).toBe(1);
    expect(result.trace.getEventsByType('router.evaluated').length).toBe(1);
    // Orchestrator always completes; the selected branch may be an actor or a system effect
    const actorCompletes = result.trace.getEventsByType('actor.complete');
    expect(actorCompletes.length).toBeGreaterThanOrEqual(1); // at least orchestrator
  }, 60000);
});
