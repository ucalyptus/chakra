import type { RuntimeEvent } from '../events/types.js';
import type { EventBus } from '../events/bus.js';
import type { StoreManager } from '../memory/store-manager.js';

/**
 * Adaptive instances — dynamically adjust actor instance counts
 * based on runtime state (memory channel content, round number, etc.).
 */

export interface AdaptiveRule {
  /** Actor ID this rule applies to */
  actorId: string;
  /** Condition to evaluate */
  condition: AdaptiveCondition;
  /** Target instance count when condition is true */
  instances: number;
}

export type AdaptiveCondition =
  | { type: 'round_range'; min?: number; max?: number }
  | { type: 'channel_length_gt'; storeId: string; threshold: number }
  | { type: 'channel_length_lt'; storeId: string; threshold: number }
  | { type: 'previous_output_contains'; pattern: string }
  | { type: 'always' };

export class AdaptiveInstanceController {
  private rules: AdaptiveRule[];
  private memory: StoreManager;
  private currentRound = 0;
  private lastOutputs = new Map<string, string>();
  private unsubscribe?: () => void;

  constructor(rules: AdaptiveRule[], memory: StoreManager) {
    this.rules = rules;
    this.memory = memory;
  }

  /** Attach to event bus to track actor outputs */
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

  /**
   * Get the effective instance count for an actor at the current state.
   * Returns undefined if no adaptive rule applies (use default).
   */
  public getInstanceCount(actorId: string, defaultCount: number): number {
    // Find matching rules (last matching rule wins)
    let result = defaultCount;

    for (const rule of this.rules) {
      if (rule.actorId !== actorId) continue;
      if (this.evaluateCondition(rule.condition)) {
        result = rule.instances;
      }
    }

    return Math.max(1, result);
  }

  private evaluateCondition(condition: AdaptiveCondition): boolean {
    switch (condition.type) {
      case 'always':
        return true;

      case 'round_range': {
        const min = condition.min ?? 0;
        const max = condition.max ?? Infinity;
        return this.currentRound >= min && this.currentRound <= max;
      }

      case 'channel_length_gt': {
        const content = this.memory.read(condition.storeId);
        return content.length > condition.threshold;
      }

      case 'channel_length_lt': {
        const content = this.memory.read(condition.storeId);
        return content.length < condition.threshold;
      }

      case 'previous_output_contains': {
        for (const output of this.lastOutputs.values()) {
          if (output.includes(condition.pattern)) return true;
        }
        return false;
      }
    }
  }

  private processEvent(event: RuntimeEvent): void {
    if (event.type === 'round.start') {
      this.currentRound = event.round;
    }
    if (event.type === 'actor.complete') {
      this.lastOutputs.set(event.nodeId, event.output);
    }
  }
}
