import type { RuntimeEvent } from './types.js';
import type { EventBus } from './bus.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerConfig {
  level?: LogLevel;
  prefix?: string;
  output?: (line: string) => void;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * Structured logging subscriber for the event bus.
 */
export class EventLogger {
  private level: LogLevel;
  private prefix: string;
  private output: (line: string) => void;
  private unsubscribe?: () => void;

  constructor(config: LoggerConfig = {}) {
    this.level = config.level ?? 'info';
    this.prefix = config.prefix ?? '[chakra]';
    this.output = config.output ?? (() => { /* noop — inject your own logger */ });
  }

  public attach(bus: EventBus): void {
    this.unsubscribe = bus.on((event) => { this.handleEvent(event); });
  }

  public detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private handleEvent(event: RuntimeEvent): void {
    const { level, message } = this.formatEvent(event);
    if (LEVEL_ORDER[level] >= LEVEL_ORDER[this.level]) {
      const ts = new Date('timestamp' in event ? event.timestamp : Date.now())
        .toISOString().slice(11, 23);
      this.output(`${this.prefix} ${ts} [${level.toUpperCase()}] ${message}`);
    }
  }

  private formatEvent(event: RuntimeEvent): { level: LogLevel; message: string } {
    switch (event.type) {
      case 'round.start':
        return { level: 'info', message: `Round ${event.round} started` };
      case 'round.end':
        return { level: 'info', message: `Round ${event.round} ended` };
      case 'node.activated':
        return { level: 'debug', message: `Node activated: ${event.nodeId}` };
      case 'actor.start':
        return { level: 'debug', message: `Actor ${event.nodeId}[${event.instanceIndex}] starting` };
      case 'actor.complete':
        return { level: 'info', message: `Actor ${event.nodeId}[${event.instanceIndex}] completed (${event.latencyMs}ms, ${event.tokenUsage.totalTokens} tokens)` };
      case 'router.evaluated':
        return { level: 'info', message: `Router ${event.nodeId} → "${event.selectedBranch}"` };
      case 'await.satisfied':
        return { level: 'debug', message: `Join ${event.awaitId} satisfied (${event.outputs.length} outputs)` };
      case 'await.slot_filled':
        return { level: 'debug', message: `Join ${event.awaitId} slot filled (${event.filledCount}/${event.totalCount})` };
      case 'store.write':
        return { level: 'debug', message: `Memory write: ${event.storeId} (${event.mode}, ${event.dataSizeBytes}B)` };
      case 'store.inject':
        return { level: 'debug', message: `Memory inject: ${event.storeId} -> ${event.intoActor} (${event.injectedTokens} tokens)` };
      case 'user.output':
        return { level: 'info', message: `→ User: ${event.message.slice(0, 100)}` };
      case 'user.input':
        return { level: 'info', message: `← User: ${event.message.slice(0, 100)} (waited ${event.waitDurationMs}ms)` };
      case 'error':
        return { level: 'error', message: `Error at ${event.nodeId}: ${event.error}` };
      default:
        return assertNever(event);
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled runtime event: ${JSON.stringify(value)}`);
}
