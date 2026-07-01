import type { Store as StoreConfig, WriteMode } from '../schema/types.js';

export interface MemoryEntry {
  round: number;
  data: string;
  timestamp: number;
}

export class StoreInstance {
  public readonly id: string;
  public readonly name: string;
  public readonly writeMode: WriteMode;
  public readonly maxEntries?: number;
  public readonly maxTokens?: number;
  private entries: MemoryEntry[] = [];

  constructor(config: StoreConfig) {
    this.id = config.id;
    this.name = config.name;
    this.writeMode = config.write_mode;
    this.maxEntries = config.max_entries;
    this.maxTokens = config.max_tokens;
  }

  public write(data: string, round: number): void {
    const entry: MemoryEntry = {
      round,
      data,
      timestamp: Date.now(),
    };

    if (this.writeMode === 'replace') {
      this.entries = [entry];
      return;
    }

    this.entries.push(entry);

    if (this.maxEntries !== undefined && this.maxEntries >= 0) {
      while (this.entries.length > this.maxEntries) {
        this.entries.shift();
      }
    }
  }

  public read(): string {
    return this.entries.map((entry) => entry.data).join('\n');
  }

  public getEntries(): MemoryEntry[] {
    return this.entries;
  }

  public snapshot(): MemoryEntry[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  public restore(entries: MemoryEntry[]): void {
    this.entries = entries.map((entry) => ({ ...entry }));
  }

  public clear(): void {
    this.entries = [];
  }
}
