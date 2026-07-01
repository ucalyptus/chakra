import { describe, it, expect } from 'vitest';
import {
  GraphBuilder,
  compile,
  Runner,
  buildGoalPrompt,
  buildGatePrompt,
  looperTemplate,
} from '@chakra-dsl/core';
import type { GoalOpts, GateOpts } from '@chakra-dsl/core';
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

  describe('GraphBuilder .goal()', () => {
    it('creates a store with the goal id and write_mode replace', () => {
      const builder = new GraphBuilder('test-goal')
        .goal('g1', {
          statement: 'Ship the report',
          definition_of_done: 'Report is complete',
          verification_criteria: ['Has a summary'],
        });
      const graph = builder.build();

      const goalStore = graph.stores.find(s => s.id === 'g1');
      expect(goalStore).toBeDefined();
      expect(goalStore!.write_mode).toBe('replace');
      expect(goalStore!.initial_value).toContain('Ship the report');
      expect(goalStore!.initial_value).toContain('Report is complete');
      expect(goalStore!.initial_value).toContain('Has a summary');
    });

    it('does not create a runtime node', () => {
      const graph = new GraphBuilder('test-goal')
        .goal('g1', { statement: 'Do X', definition_of_done: 'Done' })
        .build();

      const nodeIds = graph.nodes.map(n => n.id);
      expect(nodeIds).not.toContain('g1');
    });

    it('does not update lastNodeId (goal has no execution position)', () => {
      const graph = new GraphBuilder('test-goal')
        .roundStart('rs')
        .goal('g1', { statement: 'Do X', definition_of_done: 'Done' })
        .actor('worker', { type: 'llm', prompt: 'Work' })
        .build();

      const rsEdges = graph.edges.filter(e => e.from === 'rs');
      expect(rsEdges.some(e => e.to === 'worker')).toBe(true);
    });
  });

  describe('GraphBuilder .goalInjectTo()', () => {
    it('adds goal store id to actor subscribe and prepends prompt header', () => {
      const graph = new GraphBuilder('test-inject')
        .goal('g1', { statement: 'Do X', definition_of_done: 'Done' })
        .roundStart('rs')
        .actor('worker', { type: 'llm', prompt: 'Work.', subscribe: ['transcript'] })
        .goalInjectTo('g1', 'worker')
        .roundEnd('re')
        .build();

      const actor = graph.nodes.find(n => n.id === 'worker');
      expect(actor).toBeDefined();
      expect(actor!.type).toBe('actor');
      if (actor!.type === 'actor') {
        expect(actor!.subscribe).toContain('g1');
        expect(actor!.prompt_template).toContain('{{channel:g1}}');
        expect(actor!.prompt_template).toContain('Work.');
      }
    });

    it('does not duplicate the goal store id in subscribe', () => {
      const graph = new GraphBuilder('test-dedup')
        .goal('g1', { statement: 'Do X', definition_of_done: 'Done' })
        .roundStart('rs')
        .actor('worker', { type: 'llm', prompt: 'Work.', subscribe: ['g1'] })
        .goalInjectTo('g1', 'worker')
        .roundEnd('re')
        .build();

      const actor = graph.nodes.find(n => n.id === 'worker');
      if (actor?.type === 'actor') {
        expect(actor.subscribe.filter(s => s === 'g1')).toHaveLength(1);
      }
    });

    it('throws when goal store does not exist', () => {
      const builder = () =>
        new GraphBuilder('test-throw')
          .roundStart('rs')
          .actor('worker', { type: 'llm', prompt: 'Work.' })
          .goalInjectTo('nonexistent', 'worker');
      expect(builder).toThrow(/Goal store "nonexistent" not found/);
    });

    it('throws when actor does not exist', () => {
      const builder = () =>
        new GraphBuilder('test-throw')
          .goal('g1', { statement: 'Do X', definition_of_done: 'Done' })
          .goalInjectTo('g1', 'nonexistent');
      expect(builder).toThrow(/Actor node "nonexistent" not found/);
    });
  });

  describe('GraphBuilder .gate()', () => {
    it('creates a judge actor and a router', () => {
      const graph = new GraphBuilder('test-gate')
        .roundStart('rs')
        .actor('worker', { type: 'llm', prompt: 'Work' })
        .gate('g1', {
          name: 'My Gate',
          gate_kind: 'delivery',
          statement: 'Check work',
          definition_of_done: 'Done',
          verification_criteria: ['Passes review'],
          pass_target: 'emit_pass',
          revise_target: 'worker',
        })
        .effect('emit_pass', { effectType: 'emit_to_user' })
        .roundEnd('re')
        .build();

      const judge = graph.nodes.find(n => n.id === 'g1__judge');
      const router = graph.nodes.find(n => n.id === 'g1__router');

      expect(judge).toBeDefined();
      expect(judge!.type).toBe('actor');
      expect(router).toBeDefined();
      expect(router!.type).toBe('router');

      if (judge!.type === 'actor') {
        expect(judge!.name).toBe('My Gate');
        expect(judge!.prompt_template).toContain('delivery gate');
        expect(judge!.prompt_template).toContain('Check work');
        expect(judge!.prompt_template).toContain('<decision>pass</decision>');
      }
      if (router!.type === 'router') {
        expect(router!.name).toBe('My Gate Router');
        expect(router!.branches).toHaveLength(2);
        expect(router!.branches[0].label).toBe('pass');
        expect(router!.branches[0].target).toBe('emit_pass');
        expect(router!.branches[1].label).toBe('revise');
        expect(router!.branches[1].target).toBe('worker');
      }
    });

    it('wires judge -> router via a data edge', () => {
      const graph = new GraphBuilder('test-gate-edge')
        .roundStart('rs')
        .actor('worker', { type: 'llm', prompt: 'Work' })
        .gate('g1', {
          gate_kind: 'delivery',
          statement: 'Check',
          definition_of_done: 'Done',
          pass_target: 'ep',
          revise_target: 're',
        })
        .effect('ep', { effectType: 'emit_to_user' })
        .roundEnd('re')
        .build();

      const dataEdge = graph.edges.find(e => e.from === 'g1__judge' && e.to === 'g1__router');
      expect(dataEdge).toBeDefined();
      expect(dataEdge!.type).toBe('data');
    });

    it('chains subsequent elements from the router', () => {
      const graph = new GraphBuilder('test-gate-chain')
        .roundStart('rs')
        .actor('worker', { type: 'llm', prompt: 'Work' })
        .gate('g1', {
          gate_kind: 'delivery',
          statement: 'Check',
          definition_of_done: 'Done',
          pass_target: 'ep',
          revise_target: 're',
        })
        .effect('ep', { effectType: 'emit_to_user' })
        .roundEnd('re')
        .build();

      const chainAfterRouter = graph.edges.find(e => e.from === 'g1__router' && e.to === 'ep');
      expect(chainAfterRouter).toBeDefined();
      expect(chainAfterRouter!.type).toBe('control');
    });
  });

  describe('looperTemplate()', () => {
    it('produces a graph with correct node topology', () => {
      const graph = looperTemplate();

      const nodeIds = graph.nodes.map(n => n.id);
      expect(nodeIds).toContain('implementer_0');
      expect(nodeIds).toContain('implementer_1');
      expect(nodeIds).toContain('join');
      expect(nodeIds).toContain('collator');
      expect(nodeIds).toContain('gate__judge');
      expect(nodeIds).toContain('gate__router');
      expect(nodeIds).toContain('emit_result');
      expect(nodeIds).toContain('rs');
      expect(nodeIds).toContain('re');

      const impl0 = graph.nodes.find(n => n.id === 'implementer_0');
      expect(impl0!.type).toBe('actor');
      if (impl0!.type === 'actor') {
        expect(impl0!.actor_type).toBe('agent');
        expect(impl0!.subscribe).toContain('goal');
        expect(impl0!.prompt_template).toContain('{{channel:goal}}');
      }

      const goalStore = graph.stores.find(s => s.id === 'goal');
      expect(goalStore).toBeDefined();
      expect(goalStore!.write_mode).toBe('replace');
    });

    it('injects the goal context into each implementer exactly once', () => {
      const graph = looperTemplate();
      for (const id of ['implementer_0', 'implementer_1']) {
        const impl = graph.nodes.find(n => n.id === id);
        if (impl?.type === 'actor') {
          const matches = impl.prompt_template.match(/\{\{channel:goal\}\}/g) ?? [];
          expect(matches).toHaveLength(1);
        }
      }
    });

    it('has join with await_count all awaiting all implementers', () => {
      const graph = looperTemplate();
      const join = graph.nodes.find(n => n.id === 'join');
      expect(join).toBeDefined();
      expect(join!.type).toBe('join');
      if (join!.type === 'join') {
        expect(join!.await_count).toBe('all');
      }
    });

    it('gate branches are pass -> emit_result and revise -> re', () => {
      const graph = looperTemplate();
      const router = graph.nodes.find(n => n.id === 'gate__router')!;
      expect(router.type).toBe('router');
      if (router.type === 'router') {
        expect(router.branches).toHaveLength(2);
        expect(router.branches[0]).toEqual({ label: 'pass', target: 'emit_result' });
        expect(router.branches[1]).toEqual({ label: 'revise', target: 're' });
      }
    });

    it('compiles cleanly via compile()', () => {
      const graph = looperTemplate();
      const result = compile(graph);
      expect(result.program).toBeDefined();
      expect(result.warnings).toBeDefined();
    });

    it('accepts custom model and iteration settings', () => {
      const graph = looperTemplate({
        implementerModel: 'custom/model',
        collatorModel: 'other/model',
        verifierModel: 'gate/model',
        maxIterations: 5,
        implementerCount: 3,
        goalStatement: 'Custom goal',
        definitionOfDone: 'Custom DoD',
        verificationCriteria: ['Criterion 1'],
      });

      const implementers = graph.nodes.filter(n => n.id.startsWith('implementer_'));
      expect(implementers).toHaveLength(3);

      const impl0 = implementers[0];
      if (impl0.type === 'actor') {
        expect(impl0.model).toBe('custom/model');
      }

      const collator = graph.nodes.find(n => n.id === 'collator');
      if (collator?.type === 'actor') {
        expect(collator.model).toBe('other/model');
      }

      const judge = graph.nodes.find(n => n.id === 'gate__judge');
      if (judge?.type === 'actor') {
        expect(judge.model).toBe('gate/model');
      }

      const goalStore = graph.stores.find(s => s.id === 'goal');
      expect(goalStore!.initial_value).toContain('Custom goal');
      expect(goalStore!.initial_value).toContain('Custom DoD');
      expect(goalStore!.initial_value).toContain('Criterion 1');
    });

    it('supports 1 implementer (minimum edge case)', () => {
      const graph = looperTemplate({ implementerCount: 1 });
      const implementers = graph.nodes.filter(n => n.id.startsWith('implementer_'));
      expect(implementers).toHaveLength(1);
      const graphBuilt = compile(graph);
      expect(graphBuilt.program).toBeDefined();
    });
  });
});
