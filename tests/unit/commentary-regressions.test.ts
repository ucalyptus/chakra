import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { GraphBuilder, Runner, assertTrace, compile, buildGraph } from '@chakra-dsl/core';
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
      .channel('notes', { mode: 'append' })
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
      .channel('notes', { mode: 'append' })
      .roundStart('rs')
      .effect('write', { effectType: 'store_write', config: { channel: 'notes', data: 'hello' } })
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

  it('quotes serialized channel and router targets and rewrites gate-to-gate edges', () => {
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
});
