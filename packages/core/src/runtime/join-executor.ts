import type { Join } from '../schema/types.js';
import type { ExecutorContext } from './node-executor.js';

export interface AwaitGate {
  id: string;
  requiredCount: number;
  mode: 'all' | 'any' | 'n_of_m';
  results: unknown[];
  resolved: boolean;
  resolve?: (value: unknown[]) => void;
}

export class AwaitExecutor {
  private gates = new Map<string, AwaitGate>();

  public execute(awaitAll: Join, input: unknown, ctx: ExecutorContext): Promise<unknown[]> {
    // In sequential execution, input arrives as an array from parallel instances
    if (Array.isArray(input)) {
      const outputs = input.map((item): unknown => item);
      ctx.eventBus.emit({
        type: 'await.satisfied',
        awaitId: awaitAll.id,
        outputs,
        timestamp: Date.now(),
      });
      return Promise.resolve(outputs);
    }

    // Single input — wrap in array
    const results: unknown[] = [input];
    ctx.eventBus.emit({
      type: 'await.satisfied',
      awaitId: awaitAll.id,
      outputs: results,
      timestamp: Date.now(),
    });
    return Promise.resolve(results);
  }

  /** Register a gate for true concurrent execution scenarios.
   * Returns a Promise that resolves when the gate is fully satisfied. */
  public registerGate(awaitId: string, count: number, mode: 'all' | 'any' | 'n_of_m' = 'all'): Promise<unknown[]> {
    return new Promise<unknown[]>((resolve) => {
      const gate: AwaitGate = {
        id: awaitId,
        requiredCount: count,
        mode,
        results: [],
        resolved: false,
        resolve,
      };
      this.gates.set(awaitId, gate);
    });
  }

  /** Satisfy one slot in a gate, returns true if gate is now fully satisfied */
  public satisfySlot(awaitId: string, result: unknown): boolean {
    const gate = this.gates.get(awaitId);
    if (!gate || gate.resolved) return false;

    gate.results.push(result);

    const satisfied = gate.mode === 'any'
      ? gate.results.length >= 1
      : gate.results.length >= gate.requiredCount;

    if (satisfied) {
      gate.resolved = true;
      gate.resolve?.(gate.results);
    }

    return satisfied;
  }

  public clearGates(): void {
    this.gates.clear();
  }
}
