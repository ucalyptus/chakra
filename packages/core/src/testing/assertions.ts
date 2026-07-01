import type { TraceLog } from '../events/trace.js';
import type { RuntimeEvent } from '../events/types.js';
import type { GraphResult } from '../runtime/runner.js';

/**
 * Fluent assertion API for program trace events and outputs.
 */
export class TraceAssertions {
  private trace: TraceLog;
  private events: RuntimeEvent[];
  private result?: { halted: boolean; rounds: number };

  constructor(trace: TraceLog, result?: { halted: boolean; rounds: number }) {
    this.trace = trace;
    this.events = trace.getEvents();
    this.result = result;
  }

  /** Assert that an event of the given type exists, optionally matching fields */
  public hasEvent(type: RuntimeEvent['type'], match?: Record<string, unknown>): this {
    const found = this.events.filter(e => e.type === type);
    if (found.length === 0) {
      throw new Error(`Expected event of type "${type}" but none found`);
    }
    if (match !== undefined) {
      const matched = found.some(e => {
        for (const [key, value] of Object.entries(match)) {
          if ((e as Record<string, unknown>)[key] !== value) return false;
        }
        return true;
      });
      if (!matched) {
        throw new Error(`Expected event "${type}" matching ${JSON.stringify(match)} but none matched`);
      }
    }
    return this;
  }

  /** Assert no event of the given type exists */
  public hasNoEvent(type: RuntimeEvent['type']): this {
    const found = this.events.filter(e => e.type === type);
    if (found.length > 0) {
      throw new Error(`Expected no event of type "${type}" but found ${found.length}`);
    }
    return this;
  }

  /** Assert round count satisfies predicate */
  public roundCount(predicate: (n: number) => boolean): this {
    const rounds = this.events.filter(e => e.type === 'round.start').length;
    if (!predicate(rounds)) {
      throw new Error(`Round count ${rounds} did not satisfy predicate`);
    }
    return this;
  }

  /** Assert exact round count */
  public hasRounds(expected: number): this {
    const rounds = this.events.filter(e => e.type === 'round.start').length;
    if (rounds !== expected) {
      throw new Error(`Expected ${expected} rounds but got ${rounds}`);
    }
    return this;
  }

  /** Assert a specific router was made */
  public routerMade(nodeId: string, branch: string): this {
    const routers = this.events.filter(
      e => e.type === 'router.evaluated' && e.nodeId === nodeId,
    ) as { type: 'router.evaluated'; nodeId: string; selectedBranch: string }[];

    if (routers.length === 0) {
      throw new Error(`No router evaluated for node "${nodeId}"`);
    }

    const found = routers.some(c => c.selectedBranch === branch);
    if (!found) {
      const actual = routers.map(c => c.selectedBranch).join(', ');
      throw new Error(`Expected router "${nodeId}" to select "${branch}" but got: ${actual}`);
    }
    return this;
  }

  /** Assert an actor completed */
  public actorCompleted(nodeId: string): this {
    return this.hasEvent('actor.complete', { nodeId });
  }

  /** Assert total token usage is within budget */
  public tokenUsageBelow(maxTokens: number): this {
    const completions = this.events.filter(e => e.type === 'actor.complete') as {
      type: 'actor.complete';
      tokenUsage: { totalTokens: number };
    }[];
    const total = completions.reduce((sum, e) => sum + e.tokenUsage.totalTokens, 0);
    if (total > maxTokens) {
      throw new Error(`Token usage ${total} exceeds budget ${maxTokens}`);
    }
    return this;
  }

  /** Assert no errors occurred */
  public noErrors(): this {
    return this.hasNoEvent('error');
  }

  /** Assert program halted */
  public halted(): this {
    if (this.result?.halted !== true) {
      throw new Error(`Expected program to halt, but it completed normally (${this.result?.rounds ?? '?'} rounds)`);
    }
    return this;
  }

  /** Get the event list for custom assertions */
  public getEvents(): RuntimeEvent[] {
    return this.events;
  }
}

/** Create a trace assertion builder from a runner result */
export function assertTrace(result: GraphResult): TraceAssertions {
  return new TraceAssertions(result.trace, { halted: result.halted, rounds: result.rounds });
}

/** Assert on outputs emitted to the user */
export function assertOutputs(result: GraphResult, outputs: string[]): OutputAssertions {
  return new OutputAssertions(outputs);
}

export class OutputAssertions {
  private outputs: string[];

  constructor(outputs: string[]) {
    this.outputs = outputs;
  }

  public count(expected: number): this {
    if (this.outputs.length !== expected) {
      throw new Error(`Expected ${expected} outputs but got ${this.outputs.length}`);
    }
    return this;
  }

  public contains(substring: string): this {
    const found = this.outputs.some(o => o.includes(substring));
    if (!found) {
      throw new Error(`No output contains "${substring}"`);
    }
    return this;
  }

  public atIndex(index: number, predicate: (output: string) => boolean): this {
    if (index >= this.outputs.length) {
      throw new Error(`Output index ${index} out of range (${this.outputs.length} outputs)`);
    }
    if (!predicate(this.outputs[index])) {
      throw new Error(`Output at index ${index} did not satisfy predicate: "${this.outputs[index].slice(0, 100)}"`);
    }
    return this;
  }
}
