import type { Edge } from '../schema/types.js';
import type { StoreManager } from '../memory/store-manager.js';

/**
 * A conditional edge evaluator — edges that activate based on runtime state,
 * not just Router node output. This enables data-driven routing.
 */

export interface ConditionalEdge extends Edge {
  condition: EdgeCondition;
}

export type EdgeCondition =
  | { type: 'channel_contains'; storeId: string; pattern: string }
  | { type: 'channel_empty'; storeId: string }
  | { type: 'channel_not_empty'; storeId: string }
  | { type: 'round_gte'; value: number }
  | { type: 'round_lte'; value: number }
  | { type: 'expression'; expr: string };

export class ConditionalWiringEvaluator {
  private memory: StoreManager;
  private round: number;

  constructor(memory: StoreManager, round: number) {
    this.memory = memory;
    this.round = round;
  }

  public setRound(round: number): void {
    this.round = round;
  }

  public evaluate(condition: EdgeCondition): boolean {
    switch (condition.type) {
      case 'channel_contains': {
        const content = this.memory.read(condition.storeId);
        return content.includes(condition.pattern);
      }
      case 'channel_empty': {
        const content = this.memory.read(condition.storeId);
        return content.trim() === '';
      }
      case 'channel_not_empty': {
        const content = this.memory.read(condition.storeId);
        return content.trim() !== '';
      }
      case 'round_gte':
        return this.round >= condition.value;
      case 'round_lte':
        return this.round <= condition.value;
      case 'expression':
        // Safe subset: only allow round comparisons
        return this.evaluateSafeExpression(condition.expr);
    }
  }

  /**
   * Filter edges based on runtime conditions.
   * Non-conditional edges always pass.
   */
  public filterEdges(edges: Edge[]): Edge[] {
    return edges.filter(edge => {
      if (!('condition' in edge)) return true;
      const condEdge = edge as ConditionalEdge;
      return this.evaluate(condEdge.condition);
    });
  }

  private evaluateSafeExpression(expr: string): boolean {
    // Only support: "round > N", "round < N", "round === N", "round >= N", "round <= N"
    const match = /^round\s*(>=|<=|>|<|===?)\s*(\d+)$/.exec(expr);
    if (match === null) return false;

    const [, op, valueStr] = match;
    const value = parseInt(valueStr, 10);

    switch (op) {
      case '>': return this.round > value;
      case '<': return this.round < value;
      case '>=': return this.round >= value;
      case '<=': return this.round <= value;
      case '==':
      case '===': return this.round === value;
      default: return false;
    }
  }
}
