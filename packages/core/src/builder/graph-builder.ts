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

// ---------------------------------------------------------------------------
// Prompt builders (mirror Studio's buildGoalPrompt / buildGatePrompt
// so the programmatic API produces identical output — Studio re-exports are
// kept as-is; these are self-contained.)
// ---------------------------------------------------------------------------

export interface GoalOpts {
  statement: string;
  definition_of_done: string;
  verification_criteria?: string[];
}

export interface GateOpts {
  name?: string;
  gate_kind: 'plan' | 'delivery';
  statement: string;
  definition_of_done: string;
  verification_criteria?: string[];
  subscribe?: string[];
  publish?: string;
  model?: string;
  temperature?: number;
  pass_target: string;
  revise_target: string;
  after?: string;
}

export function buildGoalPrompt(cfg: GoalOpts): string {
  const criteria = cfg.verification_criteria && cfg.verification_criteria.length > 0
    ? cfg.verification_criteria.map((criterion, index) => `${index + 1}. ${criterion}`).join('\n')
    : '1. Produce a response that directly satisfies the requested goal.';

  return [
    'You are the primary delivery actor for this goal.',
    '',
    `Goal statement:\n${cfg.statement}`,
    '',
    `Definition of done:\n${cfg.definition_of_done}`,
    '',
    `Verification criteria:\n${criteria}`,
    '',
    'Use the subscribed stores as context. Produce the best next output that moves the work to done.',
  ].join('\n');
}

export function buildGatePrompt(cfg: GateOpts): string {
  const criteria = cfg.verification_criteria && cfg.verification_criteria.length > 0
    ? cfg.verification_criteria.map((criterion, index) => `${index + 1}. ${criterion}`).join('\n')
    : '1. Confirm the output satisfies the requested work.';

  return [
    `You are a ${cfg.gate_kind} gate.`,
    '',
    `Review target:\n${cfg.statement}`,
    '',
    `Definition of done:\n${cfg.definition_of_done}`,
    '',
    `Verification criteria:\n${criteria}`,
    '',
    'Return a concise verdict and rationale.',
    'If the work is ready, include <decision>pass</decision>.',
    'If the work needs more work, include <decision>revise</decision>.',
    'Never emit any other decision label.',
  ].join('\n');
}

// ---------------------------------------------------------------------------

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
    // Auto-add transcript store
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

  public store(id: string, opts: { mode: 'append' | 'replace'; maxEntries?: number; maxTokens?: number; initialValue?: string }): this {
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

  // -----------------------------------------------------------------------
  // Goal — compile to a seeded Store (same semantics as Studio serializer)
  // -----------------------------------------------------------------------

  /**
   * Register a Goal as a seeded Store. The goal text is compiled into the
   * store's `initial_value`. Use `.goalInjectTo(goalId, actorId)` to wire
   * an actor to subscribe to this store and have the context header prepended
   * to its prompt template — this mirrors the auto-wiring Studio's visual
   * edges produce at export time.
   */
  public goal(id: string, opts: GoalOpts): this {
    const prompt = buildGoalPrompt(opts);
    this.stores.push({
      id,
      name: id,
      write_mode: 'replace',
      initial_value: prompt,
    });
    // No node is created — a Goal compiles to a store, not a runtime step.
    // Do NOT update lastNodeId — the goal has no execution position.
    return this;
  }

  /**
   * Wire an existing actor node `${actorId}` to receive the goal store
   * `${goalId}` — the store id is added to the actor's `subscribe` array
   * and a `{{channel:<goalId>}}` header is prepended to its prompt template.
   *
   * This mirrors the auto-subscribe / prompt-header injection the Studio
   * serializer applies when a visual edge connects a Goal node to an Actor
   * node.
   */
  public goalInjectTo(goalId: string, actorId: string): this {
    const store = this.stores.find(s => s.id === goalId);
    if (!store) {
      throw new Error(`Goal store "${goalId}" not found. Call .goal("${goalId}", ...) before wiring actors to it.`);
    }
    const actorNode = this.nodes.find(n => n.id === actorId);
    if (actorNode?.type !== 'actor') {
      throw new Error(`Actor node "${actorId}" not found. Call .actor("${actorId}", ...) before wiring a goal to it.`);
    }

    // Add goal store id to subscribe
    if (!actorNode.subscribe.includes(goalId)) {
      actorNode.subscribe.push(goalId);
    }

    // Prepend goal context header to prompt
    const header = `Goal context:\n{{channel:${goalId}}}\n\n`;
    if (!actorNode.prompt_template.startsWith(header)) {
      actorNode.prompt_template = header + actorNode.prompt_template;
    }

    return this;
  }

  // -----------------------------------------------------------------------
  // Gate — compile to judge Actor + pass/revise Router (same as Studio)
  // -----------------------------------------------------------------------

  /**
   * Register a Gate node that expands into two core primitives:
   *
   *   1. A judge Actor (`${id}__judge`, type: llm) — its prompt is built
   *      from the gate config via `buildGatePrompt()`.
   *   2. A Router (`${id}__router`, mode: llm_driven) — branches to
   *      `pass_target` or `revise_target` based on
   *      `<decision>pass</decision>` / `<decision>revise</decision>`.
   *
   * The judge is the "entry" node in the chain; the router is set as the
   * builder's `lastNodeId` so subsequent chaining (e.g. `.effect(...)`)
   * continues from the router.
   */
  public gate(id: string, opts: GateOpts): this {
    const judgeId = `${id}__judge`;
    const routerId = `${id}__router`;

    // 1. Judge actor
    const judge: Actor = {
      type: 'actor',
      id: judgeId,
      name: opts.name ?? `${id} judge`,
      actor_type: 'llm',
      prompt_template: buildGatePrompt(opts),
      subscribe: opts.subscribe ?? [],
      publish: opts.publish,
      model: opts.model,
      temperature: opts.temperature,
    };
    this.nodes.push(judge);

    // 2. Router with pass/revise branches
    const router: Router = {
      type: 'router',
      id: routerId,
      name: opts.name ? `${opts.name} Router` : `${id} router`,
      mode: 'llm_driven',
      branches: [
        { label: 'pass', target: opts.pass_target },
        { label: 'revise', target: opts.revise_target },
      ],
    };
    this.nodes.push(router);

    // 3. Wire judge -> router via data edge
    this.edges.push({ from: judgeId, to: routerId, type: 'data' });

    // 4. Connect the gate's incoming chain to the judge
    const afterId = opts.after ?? this.lastNodeId;
    if (afterId !== undefined && afterId !== '') {
      this.edges.push({ from: afterId, to: judgeId, type: 'control' });
    }

    // The router is the last node for further chaining
    this.lastNodeId = routerId;
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
