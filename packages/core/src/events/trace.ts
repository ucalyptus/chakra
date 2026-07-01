import type { RuntimeEvent } from './types.js';

export class TraceLog {
  private events: RuntimeEvent[] = [];

  public record(event: RuntimeEvent): void {
    this.events.push(event);
  }

  public getEvents(): RuntimeEvent[] {
    return [...this.events];
  }

  public getEventsByType(type: RuntimeEvent['type']): RuntimeEvent[] {
    return this.events.filter((event) => event.type === type);
  }

  public getEventsByNode(nodeId: string): RuntimeEvent[] {
    return this.events.filter((event) => 'nodeId' in event && event.nodeId === nodeId);
  }

  public getEventsByRound(round: number): RuntimeEvent[] {
    return this.events.filter((event) => 'round' in event && event.round === round);
  }

  public toJSONLines(): string {
    return this.events.map((event) => JSON.stringify(event)).join('\n');
  }

  public static fromJSONLines(lines: string): TraceLog {
    const log = new TraceLog();

    lines
      .split('\n')
      .filter((line) => line.trim())
      .forEach((line) => {
        log.record(JSON.parse(line) as RuntimeEvent);
      });

    return log;
  }

  public clear(): void {
    this.events = [];
  }
}
