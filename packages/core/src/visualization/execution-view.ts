import type { RuntimeEvent } from '../events/types.js';
import type { TraceLog } from '../events/trace.js';

/**
 * Execution view — generates a timeline visualization of trace events.
 * Outputs ANSI-colored terminal representation or structured data for UIs.
 */

export interface ExecutionFrame {
  timestamp: number;
  round: number;
  activeNodes: string[];
  completedNodes: string[];
  selectedBranches: Map<string, string>;
  memoryWrites: { storeId: string; dataSizeBytes: number }[];
}

export class ExecutionView {
  private events: RuntimeEvent[];

  constructor(trace: TraceLog) {
    this.events = trace.getEvents();
  }

  /** Generate frames for animated visualization */
  public getFrames(): ExecutionFrame[] {
    const frames: ExecutionFrame[] = [];
    let currentRound = 0;
    let activeNodes: string[] = [];
    let completedNodes: string[] = [];
    const selectedBranches = new Map<string, string>();
    let memoryWrites: { storeId: string; dataSizeBytes: number }[] = [];

    for (const event of this.events) {
      if (event.type === 'round.start') {
        currentRound = event.round;
        activeNodes = [];
        completedNodes = [];
        memoryWrites = [];
      }

      if (event.type === 'node.activated') {
        activeNodes.push(event.nodeId);
      }

      if (event.type === 'actor.complete') {
        activeNodes = activeNodes.filter(n => n !== event.nodeId);
        completedNodes.push(event.nodeId);
      }

      if (event.type === 'router.evaluated') {
        selectedBranches.set(event.nodeId, event.selectedBranch);
      }

      if (event.type === 'store.write') {
        memoryWrites.push({ storeId: event.storeId, dataSizeBytes: event.dataSizeBytes });
      }

      frames.push({
        timestamp: 'timestamp' in event ? event.timestamp : Date.now(),
        round: currentRound,
        activeNodes: [...activeNodes],
        completedNodes: [...completedNodes],
        selectedBranches: new Map(selectedBranches),
        memoryWrites: [...memoryWrites],
      });
    }

    return frames;
  }

  /** Render as ANSI-colored terminal output */
  public renderTerminal(): string {
    const lines: string[] = [];

    for (const event of this.events) {
      const ts = 'timestamp' in event
        ? new Date(event.timestamp).toISOString().slice(11, 23)
        : '';

      switch (event.type) {
        case 'round.start':
          lines.push(`\n\x1b[1;36m━━━ Round ${event.round} ━━━\x1b[0m`);
          break;
        case 'node.activated':
          lines.push(`  \x1b[33m→\x1b[0m ${ts} ${event.nodeId}`);
          break;
        case 'actor.start':
          lines.push(`  \x1b[34m⚡\x1b[0m ${ts} ${event.nodeId}[${event.instanceIndex}] executing...`);
          break;
        case 'actor.complete':
          lines.push(`  \x1b[32m✓\x1b[0m ${ts} ${event.nodeId}[${event.instanceIndex}] \x1b[2m(${event.latencyMs}ms, ${event.tokenUsage.totalTokens}tok)\x1b[0m`);
          break;
        case 'router.evaluated':
          lines.push(`  \x1b[35m⑂\x1b[0m ${ts} ${event.nodeId} → "${event.selectedBranch}"`);
          break;
        case 'await.slot_filled':
          lines.push(`  \x1b[36m◐\x1b[0m ${ts} ${event.awaitId} slot ${event.filledCount}/${event.totalCount}`);
          break;
        case 'await.satisfied':
          lines.push(`  \x1b[36m⊕\x1b[0m ${ts} ${event.awaitId} satisfied (${event.outputs.length} outputs)`);
          break;
        case 'store.write':
          lines.push(`  \x1b[2m✎\x1b[0m ${ts} ${event.storeId} (${event.mode}, ${event.dataSizeBytes}B)`);
          break;
        case 'store.inject':
          lines.push(`  \x1b[2m↓\x1b[0m ${ts} ${event.storeId} → ${event.intoActor} (${event.injectedTokens}tok)`);
          break;
        case 'user.output':
          lines.push(`  \x1b[32m◁\x1b[0m ${ts} → ${event.message.slice(0, 80)}`);
          break;
        case 'user.input':
          lines.push(`  \x1b[33m▷\x1b[0m ${ts} ← ${event.message.slice(0, 80)}`);
          break;
        case 'error':
          lines.push(`  \x1b[31m✗\x1b[0m ${ts} ${event.nodeId}: ${event.error}`);
          break;
        case 'round.end':
          lines.push(`\x1b[2m── end round ${event.round} ──\x1b[0m`);
          break;
      }
    }

    return lines.join('\n');
  }

  /** Get summary statistics */
  public getSummary(): {
    rounds: number;
    totalDurationMs: number;
    nodeActivations: number;
    actorCompletions: number;
    routers: number;
    totalTokens: number;
  } {
    let rounds = 0;
    let nodeActivations = 0;
    let actorCompletions = 0;
    let routers = 0;
    let totalTokens = 0;
    let startTime = 0;
    let endTime = 0;

    for (const event of this.events) {
      if (event.type === 'round.start') {
        rounds++;
        if (startTime === 0) startTime = event.timestamp;
      }
      if (event.type === 'round.end') {
        endTime = event.timestamp;
      }
      if (event.type === 'node.activated') nodeActivations++;
      if (event.type === 'actor.complete') {
        actorCompletions++;
        totalTokens += event.tokenUsage.totalTokens;
      }
      if (event.type === 'router.evaluated') routers++;
    }

    return {
      rounds,
      totalDurationMs: endTime - startTime,
      nodeActivations,
      actorCompletions,
      routers,
      totalTokens,
    };
  }
}
