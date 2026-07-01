import type {
  Graph,
  Node,
  Actor,
  Router,
  Tool,
  Join,
  LoopStart,
  LoopEnd,
  Edge,
  Store,
  Branch,
  GraphDefaults,
} from '../schema/types.js';

export class GraphBuilder {
  private name: string;
  private version?: string;
  private graphDefaults: GraphDefaults = {};
  private stores: Store[] = [];
  private nodes: Node[] = [];
  private edges: Edge[] = [];
  private lastNodeId?: string;

  constructor(name: string) {
    this.name = name;
    // Auto-add transcript channel
    this.stores.push({
      id: 'transcript',
      name: 'Conversation Transcript',
      write_mode: 'append',
      builtin: true,
    });
  }

  public defaults(opts: { model?: string; temperature?: number; maxIterations?: number }): this {
    this.graphDefaults = {
      model: opts.model,
      temperature: opts.temperature,
      max_iterations: opts.maxIterations,
    };
    return this;
  }

  public channel(id: string, opts: { mode: 'append' | 'replace'; maxEntries?: number; maxTokens?: number; initialValue?: string }): this {
    this.stores.push({
      id,
      name: id,
      write_mode: opts.mode,
      max_entries: opts.maxEntries,
      max_tokens: opts.maxTokens,
      initial_value: opts.initialValue,
    });
    return this;
  }

  public roundStart(id: string): this {
    const node: LoopStart = { type: 'loop_start', id };
    this.nodes.push(node);
    this.lastNodeId = id;
    return this;
  }

  public actor(id: string, opts: {
    type: 'llm' | 'agent';
    name?: string;
    subscribe?: string[];
    publish?: string;
    prompt?: string;
    instances?: number;
    model?: string;
    tools?: string[];
    temperature?: number;
    after?: string;
  }): this {
    const node: Actor = {
      type: 'actor',
      id,
      name: opts.name ?? id,
      actor_type: opts.type,
      instances: opts.instances,
      prompt_template: opts.prompt ?? '',
      subscribe: opts.subscribe ?? [],
      publish: opts.publish,
      model: opts.model,
      tools: opts.tools,
      temperature: opts.temperature,
    };
    this.nodes.push(node);

    const afterId = opts.after ?? this.lastNodeId;
    if (afterId !== undefined && afterId !== '') {
      this.edges.push({ from: afterId, to: id, type: 'control' });
    }
    this.lastNodeId = id;
    return this;
  }

  public router(id: string, opts: {
    mode: 'llm_driven' | 'expression';
    name?: string;
    branches: Record<string, string>;
    after?: string;
  }): this {
    const branches: Branch[] = Object.entries(opts.branches).map(([label, target]) => ({
      label,
      target,
    }));

    const node: Router = {
      type: 'router',
      id,
      name: opts.name ?? id,
      mode: opts.mode,
      branches,
    };
    this.nodes.push(node);

    const afterId = opts.after ?? this.lastNodeId;
    if (afterId !== undefined && afterId !== '') {
      this.edges.push({ from: afterId, to: id, type: 'data' });
    }
    this.lastNodeId = id;
    return this;
  }

  public awaitAll(id: string, opts: {
    count: number | 'all';
    after?: string;
    mode?: 'all' | 'any' | 'n_of_m';
    timeout_ms?: number;
  }): this {
    const node: Join = {
      type: 'join',
      id,
      await_count: opts.count,
      mode: opts.mode,
      timeout_ms: opts.timeout_ms,
    };
    this.nodes.push(node);

    const afterId = opts.after ?? this.lastNodeId;
    if (afterId !== undefined && afterId !== '') {
      this.edges.push({ from: afterId, to: id, type: 'control' });
    }
    this.lastNodeId = id;
    return this;
  }

  public effect(id: string, opts: {
    name?: string;
    effectType: 'wait_for_user' | 'emit_to_user' | 'store_write' | 'webhook' | 'log';
    config?: Record<string, unknown>;
    after?: string;
  }): this {
    const node: Tool = {
      type: 'tool',
      id,
      name: opts.name ?? id,
      tool_type: opts.effectType,
      config: opts.config ?? {},
    };
    this.nodes.push(node);

    const afterId = opts.after ?? this.lastNodeId;
    if (afterId !== undefined && afterId !== '') {
      this.edges.push({ from: afterId, to: id, type: 'control' });
    }
    this.lastNodeId = id;
    return this;
  }

  public roundEnd(id: string, opts?: { after?: string; haltCondition?: string; maxIterations?: number }): this {
    const node: LoopEnd = {
      type: 'loop_end',
      id,
      halt_condition: opts?.haltCondition,
      max_iterations: opts?.maxIterations,
    };
    this.nodes.push(node);

    const afterId = opts?.after ?? this.lastNodeId;
    if (afterId !== undefined && afterId !== '') {
      this.edges.push({ from: afterId, to: id, type: 'control' });
    }
    this.lastNodeId = id;
    return this;
  }

  public edge(from: string, to: string, type: Edge['type'] = 'control', label?: string): this {
    this.edges.push({ from, to, type, label });
    return this;
  }

  public build(): Graph {
    return {
      name: this.name,
      version: this.version,
      defaults: this.graphDefaults,
      stores: this.stores,
      nodes: this.nodes,
      edges: this.edges,
    };
  }
}
