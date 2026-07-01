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
  public readonly format?: 'raw' | 'structured';
  public readonly schema?: Record<string, unknown>;
  public readonly builtin?: boolean;
  private entries: MemoryEntry[] = [];

  constructor(config: StoreConfig) {
    this.id = config.id;
    this.name = config.name;
    this.writeMode = config.write_mode;
    this.maxEntries = config.max_entries;
    this.maxTokens = config.max_tokens;
    this.format = config.format;
    this.schema = config.schema;
    this.builtin = config.builtin;
  }

  /**
   * format: 'structured' means every write must be valid JSON. If schema
   * declares `required` property names (the one JSON Schema constraint
   * worth enforcing without pulling in a full validator library), a parsed
   * object write must have all of them.
   */
  private validateStructured(data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      throw new Error(`Store "${this.id}" has format: 'structured' but received non-JSON data.`);
    }

    const required = this.schema?.required;
    if (!Array.isArray(required) || typeof parsed !== 'object' || parsed === null) {
      return;
    }

    const missing = required.filter((key): key is string => typeof key === 'string' && !(key in (parsed as Record<string, unknown>)));
    if (missing.length > 0) {
      throw new Error(`Store "${this.id}" write is missing required field(s): ${missing.join(', ')}.`);
    }
  }

  public write(data: string, round: number): void {
    if (this.format === 'structured') {
      this.validateStructured(data);
    }

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
