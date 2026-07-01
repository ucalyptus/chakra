import type { CompiledGraph, CompiledNode } from '../compiler/ir.js';
import { StoreManager } from '../memory/store-manager.js';
import { EventBus } from '../events/bus.js';
import { TraceLog } from '../events/trace.js';
import type { RuntimeEvent } from '../events/types.js';
import type { Actor, Router, Join, Tool, ToolType, LoopEnd } from '../schema/types.js';
import type { LLMProvider, Message, ToolDefinition } from './provider.js';

export type { Message, ToolDefinition, CompletionRequest, CompletionResponse, LLMProvider } from './provider.js';

export interface UserIOBridge {
  emit(message: string): Promise<void>;
  waitForInput(): Promise<string>;
}

export interface RuntimeConfig {
  provider: LLMProvider;
  io: UserIOBridge;
  maxConcurrency?: number;
  onEvent?: (event: RuntimeEvent) => void;
  initialMemory?: Record<string, string>;
}

export interface GraphResult {
  rounds: number;
  trace: TraceLog;
  finalMemory: Map<string, string>;
  halted: boolean;
  haltReason?: string;
}

interface JoinGateState {
  slots: unknown[];
  required: number;
  firstArrivalAt: number;
  timeoutMs?: number;
  onTimeout: 'proceed_partial' | 'fail';
  resolved: boolean;
}

export class Runner {
  private round = 0;
  private program: CompiledGraph;
  private memory: StoreManager;
  private provider: LLMProvider;
  private io: UserIOBridge;
  private eventBus: EventBus;
  private trace: TraceLog;
  private maxConcurrency: number;
  private joinGates = new Map<string, JoinGateState>();
  private upstreamActorTotals = new Map<string, number>();
  private halted = false;
  private haltReason?: string;

  constructor(program: CompiledGraph, config: RuntimeConfig) {
    this.program = program;
    this.provider = config.provider;
    this.io = config.io;
    this.maxConcurrency = config.maxConcurrency ?? 5;
    this.eventBus = new EventBus();
    this.trace = new TraceLog();

    // Initialize memory from compiled program channels
    const channelConfigs = Array.from(program.stores.values()).map(ch => ({
      id: ch.id,
      name: ch.name,
      write_mode: ch.writeMode,
      max_entries: ch.maxEntries,
      max_tokens: ch.maxTokens,
      initial_value: ch.initialValue,
      builtin: ch.builtin,
    }));
    this.memory = new StoreManager(channelConfigs);
    for (const [storeId, value] of Object.entries(config.initialMemory ?? {})) {
      if (this.memory.getStore(storeId)) {
        this.memory.write(storeId, value);
      }
    }

    // Wire event recording
    this.eventBus.on((event) => {
      this.trace.record(event);
      config.onEvent?.(event);
    });
  }

  public async run(): Promise<GraphResult> {
    const maxRounds = this.program.defaults.maxIterations ?? 100;

    while (!this.halted && this.round < maxRounds) {
      this.round++;
      this.memory.setRound(this.round);
      this.joinGates.clear();

      this.emitEvent({ type: 'round.start', round: this.round, timestamp: Date.now() });

      // Snapshot memory for potential rollback
      // Activate all LoopStart nodes
      for (const startId of this.program.loopStarts) {
        await this.activate(startId, undefined);
      }

      this.emitEvent({ type: 'round.end', round: this.round, timestamp: Date.now() });
    }

    if (this.round >= maxRounds && !this.halted) {
      this.haltReason = `Max rounds (${maxRounds}) reached`;
    }

    // Collect final memory state
    const finalMemory = new Map<string, string>();
    for (const chId of this.memory.getAllStoreIds()) {
      finalMemory.set(chId, this.memory.read(chId));
    }

    return {
      rounds: this.round,
      trace: this.trace,
      finalMemory,
      halted: this.halted,
      haltReason: this.haltReason,
    };
  }

  private async activate(nodeId: string, input: unknown): Promise<unknown> {
    const compiledNode = this.program.nodes.get(nodeId);
    if (!compiledNode) throw new Error(`Node not found: ${nodeId}`);

    this.emitEvent({ type: 'node.activated', nodeId, round: this.round, input, timestamp: Date.now() });

    let result: unknown;
    try {
      result = await this.executeNode(compiledNode, input);
    } catch (err) {
      this.emitEvent({
        type: 'error',
        nodeId,
        error: `Node "${nodeId}" failed: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      });
      throw err;
    }

    // Router and loop_end handle their own routing — don't follow edges
    if (compiledNode.type === 'router' || compiledNode.type === 'loop_end') {
      return result;
    }

    // Join hasn't collected enough slots yet — this arrival stops here.
    // The call that completes the gate is the one that proceeds downstream.
    if (compiledNode.type === 'join' && result === undefined) {
      return undefined;
    }

    // Follow outgoing edges for other node types
    const outEdges = this.program.edges.get(nodeId) ?? [];
    const controlEdges = outEdges.filter(e => e.type === 'control' || e.type === 'data');

    for (const edge of controlEdges) {
      await this.activate(edge.to, result);
    }

    return result;
  }

  private async executeNode(node: CompiledNode, input: unknown): Promise<unknown> {
    switch (node.type) {
      case 'loop_start':
        return undefined;

      case 'loop_end':
        { this.executeLoopEnd(node.config as LoopEnd, input); return; }

      case 'actor':
        return this.executeActor(node.config as Actor, input);

      case 'router':
        return this.executeRouter(node.config as Router, input);

      case 'join':
        return this.executeJoin(node.config as Join, input);

      case 'tool':
        return this.executeEffect(node.config as Tool, input);

      default:
        return assertNever(node.type);
    }
  }

  private async executeActor(actor: Actor, input: unknown): Promise<string | string[]> {
    const instances = actor.instances ?? 1;
    const model = actor.model ?? this.program.defaults.model ?? 'minimax/minimax-m1-m3';
    const temperature = actor.temperature ?? this.program.defaults.temperature;

    // Permissive regex for template injection — allows {{ channel : storeId }} 
    // whitespace variants that the permissive validator accepts.
    const CHANNEL_RX = /\{\{\s*channel\s*:\s*(\w+)(?::(\d+))?\s*\}\}/g;
    let prompt = actor.prompt_template;
    for (const storeId of actor.subscribe) {
      const content = this.memory.read(storeId);
      prompt = prompt.replace(CHANNEL_RX, (match, id) => id === storeId ? content : match);
    }

    // Add input context if present
    if (input !== undefined && input !== null) {
      prompt += `\n\nInput from previous step:\n${stringifyUnknown(input)}`;
    }

    const { definitions: tools, byName: toolsByName } = this.resolveToolDefinitions(actor.tools);

    const executeOne = async (instanceIndex: number): Promise<string> => {
      try {
        const startTime = Date.now();
        this.emitEvent({ type: 'actor.start', nodeId: actor.id, instanceIndex, prompt, timestamp: startTime });

        const messages: Message[] = [{ role: 'user', content: prompt }];
        let response = await this.provider.complete({
          model,
          messages,
          temperature,
          tools: tools.length > 0 ? tools : undefined,
        });
        const totalUsage = { ...response.usage };

        // actor_type 'agent' loops: execute requested tool calls, feed their
        // results back, and keep going until the model stops calling tools
        // or the round budget runs out. actor_type 'llm' is single-shot — a
        // tool call it makes still runs (see below), but there's no second
        // turn to report back to.
        if (actor.actor_type === 'agent') {
          let iterations = 0;
          while (response.finishReason === 'tool_calls' && (response.toolCalls?.length ?? 0) > 0 && iterations < MAX_AGENT_TOOL_ITERATIONS) {
            iterations++;
            messages.push({ role: 'assistant', content: response.content });
            for (const call of response.toolCalls ?? []) {
              const output = await this.runToolCall(call, toolsByName);
              messages.push({ role: 'user', content: `Tool "${call.name}" result: ${output}` });
            }
            response = await this.provider.complete({ model, messages, temperature, tools });
            totalUsage.inputTokens += response.usage.inputTokens;
            totalUsage.outputTokens += response.usage.outputTokens;
            totalUsage.totalTokens += response.usage.totalTokens;
          }
        } else if (response.finishReason === 'tool_calls') {
          for (const call of response.toolCalls ?? []) {
            await this.runToolCall(call, toolsByName);
          }
        }

        const latencyMs = Date.now() - startTime;
        this.emitEvent({
          type: 'actor.complete',
          nodeId: actor.id,
          instanceIndex,
          output: response.content,
          latencyMs,
          tokenUsage: totalUsage,
          model: response.model,
          finishReason: response.finishReason,
          toolCalls: response.toolCalls,
          timestamp: Date.now(),
        });

        // Publish to channel if configured
        if (actor.publish !== undefined && actor.publish !== '') {
          this.memory.write(actor.publish, response.content);
          this.emitEvent({
            type: 'store.write',
            storeId: actor.publish,
            mode: this.program.stores.get(actor.publish)?.writeMode ?? 'append',
            round: this.round,
            dataSizeBytes: response.content.length,
            timestamp: Date.now(),
          });
        }

        return response.content;
      } catch (err) {
        this.emitEvent({
          type: 'error',
          nodeId: actor.id,
          error: `Actor "${actor.id}"[${instanceIndex}] failed: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: Date.now(),
        });
        throw err;
      }
    };

    if (instances === 1) {
      return executeOne(0);
    }

    // Parallel instances with proper concurrency limit
    const results: string[] = [];
    let active = 0;
    let nextIndex = 0;

    await new Promise<void>((resolve, reject) => {
      const launchNext = (): void => {
        while (active < this.maxConcurrency && nextIndex < instances) {
          const idx = nextIndex++;
          active++;
          executeOne(idx)
            .then(r => {
              results.push(r);
              active--;
              if (results.length === instances) resolve();
              else launchNext();
            })
            .catch(reject);
        }
      };
      launchNext();
    });
    return results;
  }

  private async executeRouter(router: Router, input: unknown): Promise<unknown> {
    const inputStr = stringifyUnknown(input);
    let selectedBranch: string | undefined;

    if (router.mode === 'llm_driven') {
      // Parse structured output: look for <decision>label</decision>
      const match = /<decision>(.*?)<\/decision>/i.exec(inputStr);
      if (match !== null) {
        const decision = match[1].trim().toLowerCase();
        const branch = router.branches.find(b =>
          b.label.toLowerCase() === decision ||
          b.label.toLowerCase().includes(decision)
        );
        if (branch !== undefined) selectedBranch = branch.label;
      }

      // Fallback: keyword matching
      if (selectedBranch === undefined) {
        for (const branch of router.branches) {
          if (inputStr.toLowerCase().includes(branch.label.toLowerCase())) {
            selectedBranch = branch.label;
            break;
          }
        }
      }

      // Default to first branch if nothing matched
      if (selectedBranch === undefined && router.branches.length > 0) {
        const firstBranch = router.branches.at(0);
        if (firstBranch !== undefined) {
          selectedBranch = firstBranch.label;
        }
      }
    } else {
      // Expression mode — safe evaluation using simple string matching only
      // No arbitrary code execution: conditions are compared as string equality
      for (const branch of router.branches) {
        if (branch.condition !== undefined && branch.condition !== '') {
          const condition = branch.condition.trim();
          // Support simple comparisons: "input === 'value'" or just "value"
          const eqMatch = /^input\s*===?\s*['"](.+?)['"]$/.exec(condition);
          if (eqMatch !== null) {
            if (inputStr.trim() === eqMatch[1]) {
              selectedBranch = branch.label;
              break;
            }
          } else if (inputStr.toLowerCase().includes(condition.toLowerCase())) {
            selectedBranch = branch.label;
            break;
          }
        }
      }
      if (selectedBranch === undefined && router.branches.length > 0) {
        const lastBranch = router.branches.at(-1);
        if (lastBranch !== undefined) {
          selectedBranch = lastBranch.label;
        }
      }
    }

    this.emitEvent({
      type: 'router.evaluated',
      nodeId: router.id,
      selectedBranch: selectedBranch ?? 'none',
      timestamp: Date.now(),
    });

    // Activate the target of the selected branch
    const branch = router.branches.find(b => b.label === selectedBranch);
    if (branch !== undefined) {
      return this.activate(branch.target, input);
    }

    return undefined;
  }

  /**
   * Join accumulates one slot per incoming activation and only proceeds
   * downstream once the configured mode/await_count is met:
   *   any      → proceed on the first slot
   *   all      → wait for every reachable upstream actor instance
   *   n_of_m   → wait for await_count slots (default when await_count is a number)
   *
   * Returns undefined while the gate is still pending — the caller (activate())
   * treats that as "stop here"; only the call that completes the gate carries
   * the aggregated results downstream. timeout_ms/on_timeout are checked
   * against wall-clock time elapsed since the first slot arrived, so a join
   * that never collects enough slots this round can still resolve instead of
   * silently stalling forever.
   */
  private executeJoin(join: Join, input: unknown): unknown[] | undefined {
    const mode = join.mode ?? (join.await_count === 'all' ? 'all' : 'n_of_m');
    const required = mode === 'any'
      ? 1
      : mode === 'all'
        ? this.getUpstreamActorInstanceTotal(join.id)
        : (typeof join.await_count === 'number' ? join.await_count : this.getUpstreamActorInstanceTotal(join.id));

    let gate = this.joinGates.get(join.id);
    if (!gate) {
      gate = {
        slots: [],
        required,
        firstArrivalAt: Date.now(),
        timeoutMs: join.timeout_ms,
        onTimeout: join.on_timeout ?? 'proceed_partial',
        resolved: false,
      };
      this.joinGates.set(join.id, gate);
    }

    // Gate already fired downstream this round — a late slot is recorded
    // for observability but must not re-trigger the subgraph past the join.
    if (gate.resolved) {
      return undefined;
    }

    const incoming: unknown[] = Array.isArray(input) ? (input as unknown[]) : [input];
    gate.slots.push(...incoming);

    this.emitEvent({
      type: 'await.slot_filled',
      awaitId: join.id,
      filledCount: gate.slots.length,
      totalCount: gate.required,
      timestamp: Date.now(),
    });

    const satisfied = gate.slots.length >= gate.required;
    const timedOut = !satisfied && gate.timeoutMs !== undefined && Date.now() - gate.firstArrivalAt >= gate.timeoutMs;

    if (!satisfied && !timedOut) {
      return undefined;
    }

    if (timedOut && gate.onTimeout === 'fail') {
      gate.resolved = true;
      const message = `Join "${join.id}" timed out after ${gate.timeoutMs}ms with ${gate.slots.length}/${gate.required} slot(s) filled.`;
      this.emitEvent({ type: 'error', nodeId: join.id, error: message, timestamp: Date.now() });
      throw new Error(message);
    }

    gate.resolved = true;
    this.emitEvent({ type: 'await.satisfied', awaitId: join.id, outputs: gate.slots, timestamp: Date.now() });
    return gate.slots;
  }

  /** Total actor instances reachable upstream of a join — the denominator for mode: 'all'. */
  private getUpstreamActorInstanceTotal(joinId: string): number {
    const cached = this.upstreamActorTotals.get(joinId);
    if (cached !== undefined) return cached;

    const visited = new Set<string>();
    const queue = [...(this.program.reverseEdges.get(joinId) ?? [])];
    let total = 0;

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined || visited.has(current)) continue;
      visited.add(current);
      const node = this.program.nodes.get(current);
      if (node?.type === 'actor') {
        total += (node.config as Actor).instances ?? 1;
      }
      for (const prev of this.program.reverseEdges.get(current) ?? []) {
        if (!visited.has(prev)) queue.push(prev);
      }
    }

    this.upstreamActorTotals.set(joinId, total);
    return total;
  }

  /**
   * Actor.tools names existing Tool nodes by id — the graph-level effect they
   * already describe (webhook, store_write, ...) doubles as the function-calling
   * contract. Unknown ids are dropped with an error event rather than sent to
   * the provider (validate.ts's TOOLS_EXIST rule rejects them at compile time
   * for the same reason; this is defense in depth for graphs built without it,
   * e.g. via buildGraph() directly).
   */
  private resolveToolDefinitions(toolIds: string[] | undefined): { definitions: ToolDefinition[]; byName: Map<string, Tool> } {
    const definitions: ToolDefinition[] = [];
    const byName = new Map<string, Tool>();
    if (toolIds === undefined || toolIds.length === 0) return { definitions, byName };

    for (const toolId of toolIds) {
      const node = this.program.nodes.get(toolId);
      if (node?.type !== 'tool') {
        this.emitEvent({
          type: 'error',
          nodeId: toolId,
          error: `Tool "${toolId}" referenced by an actor does not exist as a tool node.`,
          timestamp: Date.now(),
        });
        continue;
      }
      const tool = node.config as Tool;
      definitions.push({
        name: tool.name,
        description: TOOL_TYPE_DESCRIPTIONS[tool.tool_type],
        parameters: TOOL_TYPE_PARAMETERS[tool.tool_type],
      });
      byName.set(tool.name, tool);
    }
    return { definitions, byName };
  }

  /** Executes a tool call the LLM requested by dispatching to the matching Tool node's effect. */
  private async runToolCall(call: { id: string; name: string; arguments: string }, toolsByName: Map<string, Tool>): Promise<string> {
    const tool = toolsByName.get(call.name);
    if (!tool) {
      return `Error: tool "${call.name}" is not available to this actor.`;
    }

    let args: unknown;
    try {
      args = JSON.parse(call.arguments) as unknown;
    } catch {
      args = call.arguments;
    }

    try {
      const result = await this.executeEffect(tool, args);
      return stringifyUnknown(result);
    } catch (err) {
      return `Error executing tool "${call.name}": ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private async executeEffect(effect: Tool, input: unknown): Promise<unknown> {
    switch (effect.tool_type) {
      case 'wait_for_user': {
        const startTime = Date.now();
        const userInput = await this.io.waitForInput();
        this.emitEvent({
          type: 'user.input',
          message: userInput,
          waitDurationMs: Date.now() - startTime,
          timestamp: Date.now(),
        });
        // Write to transcript if it exists
        if (this.memory.getStore('transcript')) {
          this.memory.write('transcript', `User: ${userInput}`);
        }
        return userInput;
      }

      case 'emit_to_user': {
        const message = stringifyUnknown(input ?? getConfigValue(effect.config, 'message') ?? '');
        await this.io.emit(message);
        this.emitEvent({ type: 'user.output', message, timestamp: Date.now() });
        // Write to transcript
        if (this.memory.getStore('transcript')) {
          this.memory.write('transcript', `Assistant: ${message}`);
        }
        return message;
      }

      case 'store_write': {
        const storeId = getConfigString(effect.config, 'channel');
        const data = stringifyUnknown(getConfigValue(effect.config, 'data') ?? input ?? '');
        if (storeId !== undefined && storeId !== '') {
          this.memory.write(storeId, data);
          this.emitEvent({
            type: 'store.write',
            storeId,
            mode: this.memory.getStore(storeId)?.writeMode ?? 'append',
            round: this.round,
            dataSizeBytes: data.length,
            timestamp: Date.now(),
          });
        }
        return data;
      }

      case 'webhook': {
        const url = getConfigString(effect.config, 'url');
        const method = getConfigString(effect.config, 'method') ?? 'POST';
        const body = getConfigValue(effect.config, 'body') ?? input;
        if (url !== undefined && url !== '') {
          const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          return { status: response.status, body: await response.text() };
        }
        return input;
      }

      case 'log': {
        this.emitEvent({
          type: 'user.output',
          message: `[LOG] ${stringifyUnknown(input)}`,
          timestamp: Date.now(),
        });
        return input;
      }
    }
  }

  private executeLoopEnd(roundEnd: LoopEnd, _input: unknown): undefined {
    // Check halt condition — only supports "true" (always halt) or max_iterations
    if (roundEnd.halt_condition !== undefined && roundEnd.halt_condition !== '') {
      const cond = roundEnd.halt_condition.trim().toLowerCase();
      if (cond === 'true' || cond === 'always') {
        this.halted = true;
        this.haltReason = `Halt condition met at round ${this.round}`;
      }
      // No arbitrary code execution — complex halt logic should use a Router node
    }

    if (roundEnd.max_iterations !== undefined && this.round >= roundEnd.max_iterations) {
      this.halted = true;
      this.haltReason = `Max rounds (${roundEnd.max_iterations}) reached at loop_end node`;
    }

    return undefined;
  }

  private emitEvent(event: RuntimeEvent): void {
    this.eventBus.emit(event);
  }
}

function getConfigValue(config: Record<string, unknown>, key: string): unknown {
  return config[key];
}

function getConfigString(config: Record<string, unknown>, key: string): string | undefined {
  const value = getConfigValue(config, key);
  return typeof value === 'string' ? value : undefined;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  if (value === null || value === undefined) {
    return '';
  }

  return JSON.stringify(value);
}

function assertNever(_value: never): never {
  throw new Error('Unhandled node type');
}

/** Bounds actor_type: 'agent' tool-call loops so a misbehaving model can't spin forever. */
const MAX_AGENT_TOOL_ITERATIONS = 4;

const TOOL_TYPE_DESCRIPTIONS: Record<ToolType, string> = {
  wait_for_user: 'Wait for the next message from the user.',
  emit_to_user: 'Send a message to the user.',
  store_write: 'Write data into a memory store.',
  webhook: 'Call an external HTTP webhook.',
  log: 'Write a line to the run log.',
};

const TOOL_TYPE_PARAMETERS: Record<ToolType, Record<string, unknown>> = {
  wait_for_user: { type: 'object', properties: {} },
  emit_to_user: {
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message'],
  },
  store_write: {
    type: 'object',
    properties: { data: { type: 'string' } },
    required: ['data'],
  },
  webhook: {
    type: 'object',
    properties: { body: { type: 'object' } },
  },
  log: {
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message'],
  },
};
