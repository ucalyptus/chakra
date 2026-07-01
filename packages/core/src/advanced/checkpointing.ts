import type { MemorySnapshot } from '../memory/store-manager.js';
import type { RuntimeEvent } from '../events/types.js';

/**
 * Checkpointing — save and restore full runtime state mid-execution.
 * Enables pause/resume, crash recovery, and time-travel debugging.
 */

export interface Checkpoint {
  id: string;
  programId: string;
  round: number;
  timestamp: number;
  memorySnapshot: MemorySnapshot;
  eventLog: RuntimeEvent[];
  activeNodes: string[];
  metadata?: Record<string, string>;
}

export interface CheckpointStorage {
  save(checkpoint: Checkpoint): Promise<void>;
  load(id: string): Promise<Checkpoint | undefined>;
  list(programId: string): Promise<Checkpoint[]>;
  delete(id: string): Promise<void>;
}

/**
 * In-memory checkpoint storage (for development/testing).
 */
export class MemoryCheckpointStorage implements CheckpointStorage {
  private checkpoints = new Map<string, Checkpoint>();

  public save(checkpoint: Checkpoint): Promise<void> {
    this.checkpoints.set(checkpoint.id, structuredClone(checkpoint));
    return Promise.resolve();
  }

  public load(id: string): Promise<Checkpoint | undefined> {
    const cp = this.checkpoints.get(id);
    return Promise.resolve(cp !== undefined ? structuredClone(cp) : undefined);
  }

  public list(programId: string): Promise<Checkpoint[]> {
    return Promise.resolve(
      Array.from(this.checkpoints.values())
        .filter(cp => cp.programId === programId)
        .sort((a, b) => a.timestamp - b.timestamp)
    );
  }

  public delete(id: string): Promise<void> {
    this.checkpoints.delete(id);
    return Promise.resolve();
  }
}

/**
 * JSON-file checkpoint storage (for persistence across restarts).
 */
export class JSONCheckpointStorage implements CheckpointStorage {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  public async save(checkpoint: Checkpoint): Promise<void> {
    const { writeFile, mkdir } = await import('fs/promises');
    await mkdir(this.basePath, { recursive: true });
    const filePath = `${this.basePath}/${checkpoint.id}.json`;
    await writeFile(filePath, JSON.stringify(checkpoint, mapReplacer, 2));
  }

  public async load(id: string): Promise<Checkpoint | undefined> {
    const { readFile } = await import('fs/promises');
    try {
      const data = await readFile(`${this.basePath}/${id}.json`, 'utf-8');
      return JSON.parse(data, mapReviver) as Checkpoint;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      return undefined;
    }
  }

  public async list(programId: string): Promise<Checkpoint[]> {
    const { readdir } = await import('fs/promises');
    try {
      const files = await readdir(this.basePath);
      const checkpoints: Checkpoint[] = [];
      for (const file of files) {
        if (file.endsWith('.json')) {
          const cp = await this.load(file.replace('.json', ''));
          if (cp?.programId === programId) {
            checkpoints.push(cp);
          }
        }
      }
      return checkpoints.sort((a, b) => a.timestamp - b.timestamp);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      return [];
    }
  }

  public async delete(id: string): Promise<void> {
    const { unlink } = await import('fs/promises');
    try {
      await unlink(`${this.basePath}/${id}.json`);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
    }
  }
}

/** Create a checkpoint ID from program + round */
export function createCheckpointId(programId: string, round: number): string {
  return `${programId}-r${round}-${Date.now()}`;
}

// JSON serialization helpers for Map objects
function mapReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) {
    return { __type: 'Map', entries: Array.from(value.entries()) };
  }
  return value;
}

function mapReviver(_key: string, value: unknown): unknown {
  if (typeof value === 'object' && value !== null && '__type' in value) {
    const obj = value as { __type: string; entries: [string, unknown][] };
    if (obj.__type === 'Map') {
      return new Map(obj.entries);
    }
  }
  return value;
}
