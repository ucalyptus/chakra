import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { GraphBuilder, Runner, assertTrace, compile, buildGraph, StoreManager } from '@chakra-dsl/core';
import type { LLMProvider } from '@chakra-dsl/core';
import { LocalProvider, MockProvider, OpenRouterProvider } from '@chakra-dsl/providers';
import { graphToYAML } from '../../packages/studio/src/serializer';
import type { ChakraNodeData } from '../../packages/studio/src/types';

describe('commentary regressions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes halted metadata through assertTrace()', async () => {
    const program = new GraphBuilder('halt-check')
      .defaults({ model: 'mock', maxIterations: 1 })
      .roundStart('rs')
      .roundEnd('re', { maxIterations: 1 })
      .build();

    const { program: compiled } = compile(program);
    const result = await new Runner(compiled, {
      provider: new MockProvider([]),
      io: { emit: async () => {}, waitForInput: async () => '' },
    }).run();

    expect(() => assertTrace(result).halted()).not.toThrow();
  });

  it('seeds configured initialMemory into subscribed stores', async () => {
    const program = new GraphBuilder('seeded-memory')
      .defaults({ model: 'mock', maxIterations: 1 })
      .store('notes', { mode: 'append' })
      .roundStart('rs')
      .actor('reader', {
        type: 'llm',
        subscribe: ['notes'],
        prompt: 'Read this: {{channel:notes}}',
      })
      .roundEnd('re', { maxIterations: 1 })
      .build();

    const provider = new MockProvider([{ content: 'ok' }]);
    const { program: compiled } = compile(program);
    await new Runner(compiled, {
      provider,
      io: { emit: async () => {}, waitForInput: async () => '' },
      initialMemory: { notes: 'seed value' },
    }).run();

    expect(provider.getCalls()[0]?.messages[0]?.content).toContain('seed value');
  });

  it('emits store.write events for store_write effects', async () => {
    const program = new GraphBuilder('store-write-events')
      .defaults({ model: 'mock', maxIterations: 1 })
      .store('notes', { mode: 'append' })
      .roundStart('rs')
      .effect('write', { effectType: 'store_write', config: { store: 'notes', data: 'hello' } })
      .roundEnd('re', { maxIterations: 1 })
      .build();

    const events: string[] = [];
    const { program: compiled } = compile(program);
    const result = await new Runner(compiled, {
      provider: new MockProvider([]),
      io: { emit: async () => {}, waitForInput: async () => '' },
      onEvent: (event) => {
        events.push(event.type);
      },
    }).run();

    expect(events).toContain('store.write');
    expect(result.finalMemory.get('notes')).toBe('hello');
  });

  it('uses emit_to_user config.message when upstream input is empty', async () => {
    const program = new GraphBuilder('emit-fallback')
      .defaults({ model: 'mock', maxIterations: 1 })
      .roundStart('rs')
      .effect('emit', { effectType: 'emit_to_user', config: { message: 'fallback output' } })
      .roundEnd('re', { maxIterations: 1 })
      .build();

    const outputs: string[] = [];
    const { program: compiled } = compile(program);
    await new Runner(compiled, {
      provider: new MockProvider([]),
      io: {
        emit: async (message) => {
          outputs.push(message);
        },
        waitForInput: async () => '',
      },
    }).run();

    expect(outputs).toEqual(['fallback output']);
  });

  it('quotes serialized store and router targets and rewrites gate-to-gate edges', () => {
    const nodes: Array<Node<ChakraNodeData>> = [
      {
        id: 'gate-1',
        type: 'chakra',
        position: { x: 0, y: 0 },
        data: {
          chakraType: 'gate',
          label: 'Gate 1',
          config: {
            name: 'Gate 1',
            gate_kind: 'delivery',
            statement: 'Check work',
            definition_of_done: 'Done',
            verification_criteria: ['Pass'],
            subscribe: ['sales notes'],
            publish: 'gate notes',
            model: 'mock',
            temperature: 0.1,
            pass_target: '',
            revise_target: '',
          },
        },
      },
      {
        id: 'gate-2',
        type: 'chakra',
        position: { x: 200, y: 0 },
        data: {
          chakraType: 'gate',
          label: 'Gate 2',
          config: {
            name: 'Gate 2',
            gate_kind: 'delivery',
            statement: 'Check again',
            definition_of_done: 'Done',
            verification_criteria: ['Pass'],
            subscribe: ['gate notes'],
            publish: 'qa notes',
            model: 'mock',
            temperature: 0.1,
            pass_target: 'final-node',
            revise_target: 'gate-1',
          },
        },
      },
      {
        id: 'router-1',
        type: 'chakra',
        position: { x: 400, y: 0 },
        data: {
          chakraType: 'router',
          label: 'Router',
          config: {
            name: 'Router',
            mode: 'llm_driven',
            branches: [{ label: 'needs review', target: 'gate-2' }],
          },
        },
      },
    ];

    const edges: Edge[] = [
      { id: 'e1', source: 'gate-1', target: 'gate-2' },
      { id: 'e2', source: 'gate-1', target: 'router-1' },
    ];

    const yaml = graphToYAML(nodes, edges);

    expect(yaml).toContain('subscribe: ["sales notes"]');
    expect(yaml).toContain('publish: "gate notes"');
    expect(yaml).toContain('target: "gate-2__judge"');
    expect(yaml).toContain('label: "needs review"');
  });

  it('rejects gate export when a pass/revise target is missing', () => {
    const nodes: Array<Node<ChakraNodeData>> = [
      {
        id: 'gate-1',
        type: 'chakra',
        position: { x: 0, y: 0 },
        data: {
          chakraType: 'gate',
          label: 'Gate',
          config: {
            name: 'Gate',
            gate_kind: 'delivery',
            statement: 'Check work',
            definition_of_done: 'Done',
            verification_criteria: ['Pass'],
            subscribe: ['transcript'],
            publish: 'gate_notes',
            model: 'mock',
            temperature: 0.1,
            pass_target: '',
            revise_target: '',
          },
        },
      },
    ];

    expect(() => graphToYAML(nodes, [])).toThrow(/missing its pass target/i);
  });

  it('does not retry non-retriable OpenRouter client errors and leaves toolCalls undefined when absent', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'bad request',
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider({ apiKey: 'test-key' });
    await expect(provider.complete({ model: 'test', messages: [{ role: 'user', content: 'hello' }] })).rejects.toThrow(/400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
    });
    const response = await provider.complete({ model: 'test', messages: [{ role: 'user', content: 'hello' }] });
    expect(response.toolCalls).toBeUndefined();
  });

  it('forwards tools through the local provider request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new LocalProvider();
    await provider.complete({
      model: 'local-model',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{ name: 'lookup', description: 'Lookup', parameters: { type: 'object', properties: {} } }],
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as { tools?: Array<{ function?: { name?: string } }> };
    expect(requestBody.tools?.[0]?.function?.name).toBe('lookup');
  });

  it('join waits for await_count slots before releasing aggregated outputs downstream', async () => {
    const program = new GraphBuilder('join-n-of-m')
      .defaults({ model: 'mock', maxIterations: 1 })
      .roundStart('rs')
      .actor('a', { type: 'llm', prompt: 'A', after: 'rs' })
      .actor('b', { type: 'llm', prompt: 'B', after: 'rs' })
      .awaitAll('j', { count: 2, after: 'a' })
      .edge('b', 'j')
      .actor('judge', { type: 'llm', prompt: 'Judge', after: 'j' })
      .roundEnd('re', { after: 'judge', maxIterations: 1 })
      .build();

    const provider = new MockProvider([{ content: 'out-a' }, { content: 'out-b' }, { content: 'out-judge' }]);
    const { program: compiled } = compile(program);
    const result = await new Runner(compiled, {
      provider,
      io: { emit: async () => {}, waitForInput: async () => '' },
    }).run();

    assertTrace(result)
      .hasEvent('await.slot_filled', { awaitId: 'j', filledCount: 1, totalCount: 2 })
      .hasEvent('await.slot_filled', { awaitId: 'j', filledCount: 2, totalCount: 2 })
      .hasEvent('await.satisfied', { awaitId: 'j' })
      .actorCompleted('judge');

    expect(provider.getCallCount()).toBe(3);
    const satisfied = assertTrace(result).getEvents().find(e => e.type === 'await.satisfied');
    expect(satisfied?.type === 'await.satisfied' && satisfied.outputs).toEqual(['out-a', 'out-b']);
    expect(provider.getCalls()[2]?.messages[0]?.content).toContain('out-a');
    expect(provider.getCalls()[2]?.messages[0]?.content).toContain('out-b');
  });

  it('join with mode "any" proceeds on the first slot and ignores later arrivals', async () => {
    const program = new GraphBuilder('join-any')
      .defaults({ model: 'mock', maxIterations: 1 })
      .roundStart('rs')
      .actor('a', { type: 'llm', prompt: 'A', after: 'rs' })
      .actor('b', { type: 'llm', prompt: 'B', after: 'rs' })
      .awaitAll('j', { count: 2, mode: 'any', after: 'a' })
      .edge('b', 'j')
      .actor('judge', { type: 'llm', prompt: 'Judge', after: 'j' })
      .roundEnd('re', { after: 'judge', maxIterations: 1 })
      .build();

    const provider = new MockProvider([{ content: 'out-a' }, { content: 'out-b' }, { content: 'out-judge' }]);
    const { program: compiled } = compile(program);
    const result = await new Runner(compiled, {
      provider,
      io: { emit: async () => {}, waitForInput: async () => '' },
    }).run();

    const events = assertTrace(result).hasEvent('await.satisfied', { awaitId: 'j' }).getEvents();
    expect(events.filter(e => e.type === 'await.satisfied')).toHaveLength(1);
    expect(events.filter(e => e.type === 'await.slot_filled')).toHaveLength(1);
    expect(events.filter(e => e.type === 'actor.complete' && e.nodeId === 'judge')).toHaveLength(1);
    // Both branches still run — the join only short-circuits what happens after it.
    expect(provider.getCallCount()).toBe(3);
  });

  it('fails a join that times out without enough slots when on_timeout is "fail"', async () => {
    const program = new GraphBuilder('join-timeout')
      .defaults({ model: 'mock', maxIterations: 1 })
      .roundStart('rs')
      .actor('a', { type: 'llm', prompt: 'A', after: 'rs' })
      .awaitAll('j', { count: 2, timeout_ms: 0, after: 'a' })
      .actor('judge', { type: 'llm', prompt: 'Judge', after: 'j' })
      .roundEnd('re', { after: 'judge', maxIterations: 1 })
      .build();
    const joinNode = program.nodes.find(n => n.type === 'join');
    if (joinNode?.type === 'join') joinNode.on_timeout = 'fail';

    // Deliberately under-provisioned (await_count 2 with only 1 reachable actor) to
    // exercise the timeout path — compile() would reject this via AWAIT_REACHABLE,
    // so build the IR directly rather than going through the normal validated path.
    const provider = new MockProvider([{ content: 'out-a' }]);
    const compiled = buildGraph(program);

    await expect(
      new Runner(compiled, {
        provider,
        io: { emit: async () => {}, waitForInput: async () => '' },
      }).run(),
    ).rejects.toThrow(/timed out/);
  });

  it('resolves Actor.tools to tool definitions and forwards them to the provider', async () => {
    const program = new GraphBuilder('actor-tools')
      .defaults({ model: 'mock', maxIterations: 1 })
      .roundStart('rs')
      .effect('lookup', { effectType: 'webhook', config: { url: 'https://example.com' }, after: '' })
      .actor('main', { type: 'llm', prompt: 'Go', tools: ['lookup'], after: 'rs' })
      .roundEnd('re', { after: 'main', maxIterations: 1 })
      .build();

    const provider = new MockProvider([{ content: 'ok' }]);
    const { program: compiled } = compile(program);
    const result = await new Runner(compiled, {
      provider,
      io: { emit: async () => {}, waitForInput: async () => '' },
    }).run();

    expect(provider.getCalls()[0]?.tools).toEqual([
      { name: 'lookup', description: 'Call an external HTTP webhook.', parameters: { type: 'object', properties: { body: { type: 'object' } } } },
    ]);
    const complete = assertTrace(result).getEvents().find(e => e.type === 'actor.complete');
    expect(complete?.type === 'actor.complete' && complete.model).toBe('mock');
    expect(complete?.type === 'actor.complete' && complete.finishReason).toBe('stop');
  });

  it('rejects an actor referencing a tool id that does not exist', () => {
    const program = new GraphBuilder('missing-tool')
      .defaults({ model: 'mock', maxIterations: 1 })
      .roundStart('rs')
      .actor('main', { type: 'llm', prompt: 'Go', tools: ['does-not-exist'], after: 'rs' })
      .roundEnd('re', { after: 'main', maxIterations: 1 })
      .build();

    expect(() => compile(program)).toThrow(/TOOLS_EXIST/);
  });

  it('actor_type "agent" loops on tool calls until the model stops requesting them', async () => {
    const program = new GraphBuilder('agent-loop')
      .defaults({ model: 'mock', maxIterations: 1 })
      .store('scratch', { mode: 'append' })
      .roundStart('rs')
      .effect('lookup', { effectType: 'store_write', config: { store: 'scratch' }, after: '' })
      .actor('main', { type: 'agent', prompt: 'Go', tools: ['lookup'], after: 'rs' })
      .roundEnd('re', { after: 'main', maxIterations: 1 })
      .build();

    let calls = 0;
    const provider: LLMProvider = {
      complete: async (request) => {
        calls++;
        if (calls === 1) {
          return {
            content: 'calling tool',
            model: request.model,
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            finishReason: 'tool_calls',
            toolCalls: [{ id: 't1', name: 'lookup', arguments: JSON.stringify('hello') }],
          };
        }
        return {
          content: 'done',
          model: request.model,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          finishReason: 'stop',
        };
      },
    };

    const { program: compiled } = compile(program);
    const result = await new Runner(compiled, {
      provider,
      io: { emit: async () => {}, waitForInput: async () => '' },
    }).run();

    expect(calls).toBe(2);
    expect(result.finalMemory.get('scratch')).toBe('hello');
    const complete = assertTrace(result).getEvents().find(e => e.type === 'actor.complete');
    expect(complete?.type === 'actor.complete' && complete.output).toBe('done');
  });

  it('actor_type "llm" still executes a requested tool call but does not loop back to the model', async () => {
    const program = new GraphBuilder('llm-single-shot-tool')
      .defaults({ model: 'mock', maxIterations: 1 })
      .store('scratch', { mode: 'append' })
      .roundStart('rs')
      .effect('lookup', { effectType: 'store_write', config: { store: 'scratch' }, after: '' })
      .actor('main', { type: 'llm', prompt: 'Go', tools: ['lookup'], after: 'rs' })
      .roundEnd('re', { after: 'main', maxIterations: 1 })
      .build();

    let calls = 0;
    const provider: LLMProvider = {
      complete: async (request) => {
        calls++;
        return {
          content: 'calling tool',
          model: request.model,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          finishReason: 'tool_calls',
          toolCalls: [{ id: 't1', name: 'lookup', arguments: JSON.stringify('hello') }],
        };
      },
    };

    const { program: compiled } = compile(program);
    const result = await new Runner(compiled, {
      provider,
      io: { emit: async () => {}, waitForInput: async () => '' },
    }).run();

    expect(calls).toBe(1);
    expect(result.finalMemory.get('scratch')).toBe('hello');
  });

  it('rejects a store schema declared without format: "structured"', () => {
    const program = new GraphBuilder('bad-store-schema')
      .defaults({ model: 'mock', maxIterations: 1 })
      .roundStart('rs')
      .roundEnd('re', { maxIterations: 1 })
      .build();
    program.stores.push({ id: 'notes', name: 'notes', write_mode: 'append', schema: { required: ['x'] } });

    expect(() => compile(program)).toThrow(/STORE_SCHEMA_REQUIRES_STRUCTURED/);
  });

  it('enforces format: "structured" writes are valid JSON with required fields', () => {
    const memory = new StoreManager([
      { id: 'notes', name: 'notes', write_mode: 'append', format: 'structured', schema: { required: ['status'] } },
    ]);

    expect(() => memory.write('notes', 'not json')).toThrow(/non-JSON/);
    expect(() => memory.write('notes', JSON.stringify({ other: 1 }))).toThrow(/missing required field/);
    expect(() => memory.write('notes', JSON.stringify({ status: 'ok' }))).not.toThrow();
  });

  it('compiles a Goal to a store, not an actor, and wires connected actors to it', () => {
    const nodes: Array<Node<ChakraNodeData>> = [
      { id: 'rs', type: 'chakra', position: { x: 0, y: 0 }, data: { chakraType: 'loop_start', label: 'Start', config: {} } },
      {
        id: 'goal_1',
        type: 'chakra',
        position: { x: 100, y: 0 },
        data: {
          chakraType: 'goal',
          label: 'Goal',
          config: {
            name: 'Goal',
            statement: 'Ship the report',
            definition_of_done: 'Report is complete',
            verification_criteria: ['Has a summary'],
          },
        },
      },
      {
        id: 'worker',
        type: 'chakra',
        position: { x: 200, y: 0 },
        data: {
          chakraType: 'actor',
          label: 'Worker',
          config: { name: 'Worker', model: 'mock', prompt_template: 'Do the work.', subscribe: ['transcript'], publish: 'notes', temperature: 0.5 },
        },
      },
      { id: 're', type: 'chakra', position: { x: 300, y: 0 }, data: { chakraType: 'loop_end', label: 'End', config: { max_iterations: 1 } } },
    ];
    const edges: Edge[] = [
      { id: 'e1', source: 'rs', target: 'worker' },
      { id: 'e2', source: 'goal_1', target: 'worker' },
      { id: 'e3', source: 'worker', target: 're' },
    ];

    const yaml = graphToYAML(nodes, edges);

    // Goal is a store seeded with its own text, not an actor node.
    expect(yaml).toMatch(/id: "goal_1"[\s\S]*?write_mode: replace[\s\S]*?initial_value: ".*Ship the report/);
    expect(yaml).not.toMatch(/id: goal_1\s*\n\s*name:.*\n\s*actor_type: llm/);

    // The actor it connects to picks up the store automatically.
    expect(yaml).toMatch(/subscribe: \["transcript", "goal_1"\]/);
    expect(yaml).toMatch(/Goal context:\n\s*\{\{channel:goal_1\}\}/);

    // No control-flow edge is emitted for the goal connection.
    expect(yaml).not.toMatch(/from: goal_1/);
  });

  it('a Goal never executes and its context reaches the actor prompt every round unchanged', async () => {
    const nodes: Array<Node<ChakraNodeData>> = [
      { id: 'rs', type: 'chakra', position: { x: 0, y: 0 }, data: { chakraType: 'loop_start', label: 'Start', config: {} } },
      {
        id: 'goal_1',
        type: 'chakra',
        position: { x: 100, y: 0 },
        data: {
          chakraType: 'goal',
          label: 'Goal',
          config: { name: 'Goal', statement: 'Ship the report', definition_of_done: 'Report is complete', verification_criteria: [] },
        },
      },
      {
        id: 'worker',
        type: 'chakra',
        position: { x: 200, y: 0 },
        data: {
          chakraType: 'actor',
          label: 'Worker',
          config: { name: 'Worker', model: 'mock', prompt_template: 'Do the work.', subscribe: [], publish: 'notes', temperature: 0.5 },
        },
      },
      { id: 're', type: 'chakra', position: { x: 300, y: 0 }, data: { chakraType: 'loop_end', label: 'End', config: { max_iterations: 2 } } },
    ];
    const edges: Edge[] = [
      { id: 'e1', source: 'rs', target: 'worker' },
      { id: 'e2', source: 'goal_1', target: 'worker' },
      { id: 'e3', source: 'worker', target: 're' },
    ];

    const provider = new MockProvider([{ content: 'ok round 1' }, { content: 'ok round 2' }]);
    const { program: compiled } = compile(graphToYAML(nodes, edges), 'yaml');
    const result = await new Runner(compiled, {
      provider,
      io: { emit: async () => {}, waitForInput: async () => '' },
    }).run();

    expect(result.finalMemory.get('goal_1')).toContain('Ship the report');
    expect(provider.getCalls()).toHaveLength(2);
    for (const call of provider.getCalls()) {
      expect(call.messages[0]?.content).toContain('Ship the report');
    }
    const events = assertTrace(result).getEvents();
    expect(events.some(e => 'nodeId' in e && e.nodeId === 'goal_1')).toBe(false);
  });
});
