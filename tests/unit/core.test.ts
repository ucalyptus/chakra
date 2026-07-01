import { describe, it, expect } from 'vitest';
import { GraphBuilder } from '@chakra-dsl/core';
import { compile } from '@chakra-dsl/core';
import { Runner } from '@chakra-dsl/core';
import { MockProvider } from '@chakra-dsl/providers';

describe('Roundtable Core', () => {
  describe('Compiler', () => {
    it('compiles a simple program', () => {
      const program = new GraphBuilder('test-program')
        .defaults({ model: 'mock', maxIterations: 2 })
        .store('notes', { mode: 'append' })
        .roundStart('rs1')
        .actor('greeter', {
          type: 'llm',
          subscribe: ['transcript'],
          publish: 'notes',
          prompt: 'Say hello. {{channel:transcript}}',
        })
        .roundEnd('re1', { maxIterations: 2 })
        .build();

      const result = compile(program);
      expect(result.program).toBeDefined();
      expect(result.program.nodes.size).toBeGreaterThan(0);
      expect(result.program.loopStarts).toContain('rs1');
      expect(result.program.loopEnds).toContain('re1');
    });

    it('rejects programs with missing stores', () => {
      const program = new GraphBuilder('bad-program')
        .roundStart('rs1')
        .actor('broken', {
          type: 'llm',
          subscribe: ['nonexistent_store'],
          prompt: 'test',
        })
        .roundEnd('re1')
        .build();

      expect(() => compile(program)).toThrow(/STORE_EXISTS/);
    });
  });

  describe('Runtime with MockProvider', () => {
    it('executes a single-actor program for 2 rounds', async () => {
      const program = new GraphBuilder('simple-loop')
        .defaults({ model: 'mock', maxIterations: 2 })
        .store('notes', { mode: 'append' })
        .roundStart('rs1')
        .actor('thinker', {
          type: 'llm',
          subscribe: ['transcript'],
          publish: 'notes',
          prompt: 'Think about something. {{channel:transcript}}',
        })
        .roundEnd('re1', { maxIterations: 2 })
        .build();

      const { program: compiled } = compile(program);

      const mockProvider = new MockProvider([
        { content: 'Thought 1: The sky is blue.' },
        { content: 'Thought 2: Water is wet.' },
      ]);

      const io = {
        emit: async (msg: string) => {},
        waitForInput: async () => 'user input',
      };

      const controller = new Runner(compiled, {
        provider: mockProvider,
        io,
      });

      const result = await controller.run();

      expect(result.rounds).toBe(2);
      expect(result.halted).toBe(true);
      expect(mockProvider.getCallCount()).toBe(2);

      // Check memory was written
      const notes = result.finalMemory.get('notes');
      expect(notes).toContain('Thought 1');
    });

    it('handles router nodes with structured output', async () => {
      const program = new GraphBuilder('router-program')
        .defaults({ model: 'mock', maxIterations: 1 })
        .store('output', { mode: 'append' })
        .roundStart('rs1')
        .actor('decider', {
          type: 'llm',
          subscribe: ['transcript'],
          prompt: 'Decide: reason or act',
        })
        .router('choose', {
          mode: 'llm_driven',
          branches: {
            'reason': 'reasoner',
            'act': 'actor_node',
          },
        })
        .build();

      // Add the branch target nodes manually since router targets need to exist
      program.nodes.push(
        { type: 'actor', id: 'reasoner', name: 'Reasoner', actor_type: 'llm', subscribe: [], prompt_template: 'Reason', publish: 'output' },
        { type: 'actor', id: 'actor_node', name: 'Actor', actor_type: 'llm', subscribe: [], prompt_template: 'Act', publish: 'output' },
        { type: 'loop_end', id: 're1' },
      );
      program.edges.push(
        { from: 'choose', to: 'reasoner', type: 'control' },
        { from: 'choose', to: 'actor_node', type: 'control' },
        { from: 'reasoner', to: 're1', type: 'control' },
        { from: 'actor_node', to: 're1', type: 'control' },
      );

      const { program: compiled } = compile(program);

      const mockProvider = new MockProvider([
        { content: 'I will <decision>reason</decision> about this.' },
        { content: 'Deep reasoning result.' },
      ]);

      const controller = new Runner(compiled, {
        provider: mockProvider,
        io: { emit: async () => {}, waitForInput: async () => '' },
      });

      const result = await controller.run();
      expect(result.rounds).toBe(1);

      // Check trace for router evaluation
      const routerEvents = result.trace.getEventsByType('router.evaluated');
      expect(routerEvents.length).toBe(1);
      expect((routerEvents[0] as any).selectedBranch).toBe('reason');
    });
  });

  describe('Event System', () => {
    it('records trace events during execution', async () => {
      const program = new GraphBuilder('trace-test')
        .defaults({ model: 'mock', maxIterations: 1 })
        .roundStart('rs1')
        .actor('worker', {
          type: 'llm',
          subscribe: ['transcript'],
          prompt: 'Work',
        })
        .roundEnd('re1', { maxIterations: 1 })
        .build();

      const { program: compiled } = compile(program);

      const controller = new Runner(compiled, {
        provider: new MockProvider([{ content: 'Done' }]),
        io: { emit: async () => {}, waitForInput: async () => '' },
      });

      const result = await controller.run();
      const events = result.trace.getEvents();

      expect(events.length).toBeGreaterThan(0);
      expect(events.some(e => e.type === 'round.start')).toBe(true);
      expect(events.some(e => e.type === 'round.end')).toBe(true);
      expect(events.some(e => e.type === 'actor.complete')).toBe(true);
    });
  });
});
