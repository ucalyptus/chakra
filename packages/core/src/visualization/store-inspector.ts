import type { TraceLog } from '../events/trace.js';
import type { RuntimeEvent } from '../events/types.js';
import type { StoreManager } from '../memory/store-manager.js';

/**
 * Memory inspector — view channel contents across rounds.
 * Enables debugging memory flow and content evolution.
 */

export interface ChannelSnapshot {
  storeId: string;
  round: number;
  content: string | null; // null when trace doesn't record actual content
  sizeBytes: number;
  writeCount: number;
}

export interface MemoryTimeline {
  storeId: string;
  snapshots: ChannelSnapshot[];
}

export class MemoryInspector {
  private trace: TraceLog;

  constructor(trace: TraceLog) {
    this.trace = trace;
  }

  /** Get all memory write events grouped by channel */
  public getWritesByStore(): Map<string, RuntimeEvent[]> {
    const writes = new Map<string, RuntimeEvent[]>();
    const events = this.trace.getEvents();

    for (const event of events) {
      if (event.type === 'store.write') {
        const existing = writes.get(event.storeId) ?? [];
        existing.push(event);
        writes.set(event.storeId, existing);
      }
    }

    return writes;
  }

  /** Get memory write timeline for a specific channel */
  public getStoreTimeline(storeId: string): ChannelSnapshot[] {
    const snapshots: ChannelSnapshot[] = [];
    const events = this.trace.getEvents();
    let writeCount = 0;

    for (const event of events) {
      if (event.type === 'store.write' && event.storeId === storeId) {
        writeCount++;
        snapshots.push({
          storeId,
          round: event.round,
          content: null, // actual content requires store.write event to carry payload — add to trace event type to unlock
          sizeBytes: event.dataSizeBytes,
          writeCount,
        });
      }
    }

    return snapshots;
  }

  /** Get channels that were written to, with stats */
  public getStoreStats(): Map<string, { writes: number; totalBytes: number; rounds: Set<number> }> {
    const stats = new Map<string, { writes: number; totalBytes: number; rounds: Set<number> }>();
    const events = this.trace.getEvents();

    for (const event of events) {
      if (event.type === 'store.write') {
        const existing = stats.get(event.storeId) ?? { writes: 0, totalBytes: 0, rounds: new Set<number>() };
        existing.writes++;
        existing.totalBytes += event.dataSizeBytes;
        existing.rounds.add(event.round);
        stats.set(event.storeId, existing);
      }
    }

    return stats;
  }

  /** Render a terminal-friendly view of memory activity */
  public renderTerminal(): string {
    const stats = this.getStoreStats();
    const lines: string[] = ['\x1b[1mMemory Channel Activity\x1b[0m', ''];

    for (const [storeId, stat] of stats) {
      const bar = '█'.repeat(Math.min(stat.writes, 40));
      lines.push(`  \x1b[36m${storeId.padEnd(20)}\x1b[0m ${bar} ${stat.writes} writes, ${stat.totalBytes}B across ${stat.rounds.size} rounds`);
    }

    return lines.join('\n');
  }

  /**
   * Inspect current memory state (live, requires StoreManager reference).
   */
  public static inspectLive(memory: StoreManager): Map<string, { content: string; length: number }> {
    const result = new Map<string, { content: string; length: number }>();

    for (const storeId of memory.getAllStoreIds()) {
      const content = memory.read(storeId);
      result.set(storeId, { content, length: content.length });
    }

    return result;
  }
}
