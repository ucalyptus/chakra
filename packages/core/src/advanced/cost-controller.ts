import type { RuntimeEvent, TokenUsage } from '../events/types.js';
import type { EventBus } from '../events/bus.js';

/**
 * Cost controller — enforces token budgets across rounds.
 * Halts execution when budget is exceeded.
 */

export interface CostBudget {
  /** Max total tokens (input + output) across all rounds */
  maxTotalTokens?: number;
  /** Max tokens per round */
  maxTokensPerRound?: number;
  /** Max tokens per actor call */
  maxTokensPerCall?: number;
  /** Max total cost in USD (requires pricing info) */
  maxCostUSD?: number;
}

export interface CostReport {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  tokensByRound: Map<number, { input: number; output: number }>;
  tokensByActor: Map<string, { input: number; output: number }>;
  estimatedCostUSD: number;
  budgetExceeded: boolean;
  exceedReason?: string;
}

/** Default pricing per 1M tokens (rough estimates) */
const DEFAULT_PRICING: Record<string, { input: number; output: number }> = {
  'default': { input: 3.0, output: 15.0 },
  'claude-sonnet': { input: 3.0, output: 15.0 },
  'claude-haiku': { input: 0.25, output: 1.25 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};

export class CostController {
  private budget: CostBudget;
  private modelName: string;
  private totalInput = 0;
  private totalOutput = 0;
  private roundTokens = new Map<number, { input: number; output: number }>();
  private actorTokens = new Map<string, { input: number; output: number }>();
  private currentRound = 0;
  private exceeded = false;
  private exceedReason?: string;
  private unsubscribe?: () => void;

  constructor(budget: CostBudget, modelName?: string) {
    this.budget = budget;
    this.modelName = modelName ?? '';
  }

  /** Attach to an event bus to automatically track costs */
  public attach(bus: EventBus): void {
    this.unsubscribe = bus.on((event) => {
      this.processEvent(event);
    });
  }

  public detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  public setRound(round: number): void {
    this.currentRound = round;
  }

  /** Check if a proposed call would exceed budget. Returns true if allowed. */
  public checkBudget(estimatedTokens?: number): { allowed: boolean; reason?: string } {
    if (this.exceeded) {
      return { allowed: false, reason: this.exceedReason };
    }

    if (this.budget.maxTotalTokens !== undefined) {
      const projected = this.totalInput + this.totalOutput + (estimatedTokens ?? 0);
      if (projected > this.budget.maxTotalTokens) {
        return { allowed: false, reason: `Total token budget (${this.budget.maxTotalTokens}) would be exceeded` };
      }
    }

    if (this.budget.maxTokensPerRound !== undefined) {
      const roundUsage = this.roundTokens.get(this.currentRound);
      const roundTotal = (roundUsage?.input ?? 0) + (roundUsage?.output ?? 0) + (estimatedTokens ?? 0);
      if (roundTotal > this.budget.maxTokensPerRound) {
        return { allowed: false, reason: `Per-round token budget (${this.budget.maxTokensPerRound}) would be exceeded` };
      }
    }

    if (this.budget.maxTokensPerCall !== undefined && estimatedTokens !== undefined) {
      if (estimatedTokens > this.budget.maxTokensPerCall) {
        return { allowed: false, reason: `Per-call token budget (${this.budget.maxTokensPerCall}) would be exceeded` };
      }
    }

    return { allowed: true };
  }

  /** Record token usage from a completed call */
  public recordUsage(nodeId: string, usage: TokenUsage): void {
    this.totalInput += usage.inputTokens;
    this.totalOutput += usage.outputTokens;

    // Round tracking
    const existing = this.roundTokens.get(this.currentRound) ?? { input: 0, output: 0 };
    existing.input += usage.inputTokens;
    existing.output += usage.outputTokens;
    this.roundTokens.set(this.currentRound, existing);

    // Actor tracking
    const actorExisting = this.actorTokens.get(nodeId) ?? { input: 0, output: 0 };
    actorExisting.input += usage.inputTokens;
    actorExisting.output += usage.outputTokens;
    this.actorTokens.set(nodeId, actorExisting);

    // Check if budget is now exceeded
    this.checkAndSetExceeded();
  }

  public get isExceeded(): boolean {
    return this.exceeded;
  }

  /** Generate a full cost report */
  public getReport(): CostReport {
    const totalTokens = this.totalInput + this.totalOutput;
    const estimatedCostUSD = this.estimateCost();

    return {
      totalInputTokens: this.totalInput,
      totalOutputTokens: this.totalOutput,
      totalTokens,
      tokensByRound: new Map(this.roundTokens),
      tokensByActor: new Map(this.actorTokens),
      estimatedCostUSD,
      budgetExceeded: this.exceeded,
      exceedReason: this.exceedReason,
    };
  }

  private processEvent(event: RuntimeEvent): void {
    if (event.type === 'round.start') {
      this.currentRound = event.round;
    }
    if (event.type === 'actor.complete') {
      this.recordUsage(event.nodeId, event.tokenUsage);
    }
  }

  private checkAndSetExceeded(): void {
    const totalTokens = this.totalInput + this.totalOutput;

    if (this.budget.maxTotalTokens !== undefined && totalTokens > this.budget.maxTotalTokens) {
      this.exceeded = true;
      this.exceedReason = `Total token budget exceeded: ${totalTokens} > ${this.budget.maxTotalTokens}`;
    }

    if (this.budget.maxCostUSD !== undefined) {
      const cost = this.estimateCost();
      if (cost > this.budget.maxCostUSD) {
        this.exceeded = true;
        this.exceedReason = `Cost budget exceeded: $${cost.toFixed(4)} > $${this.budget.maxCostUSD}`;
      }
    }
  }

  private estimateCost(): number {
    // Best-match pricing: prefix-match model name against known pricing tiers
    let pricing = DEFAULT_PRICING.default;
    const lower = this.modelName.toLowerCase();
    for (const [prefix, rate] of Object.entries(DEFAULT_PRICING)) {
      if (prefix !== 'default' && lower.includes(prefix)) {
        pricing = rate;
        break;
      }
    }
    const inputCost = (this.totalInput / 1_000_000) * pricing.input;
    const outputCost = (this.totalOutput / 1_000_000) * pricing.output;
    return inputCost + outputCost;
  }
}
