export interface SchedulerConfig {
  maxConcurrency: number;
}

interface QueuedTask<T> {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  priority: number;
}

/**
 * Concurrency-limited task scheduler with priority queue.
 * Ensures at most `maxConcurrency` LLM calls run in parallel.
 */
export class ConcurrencyScheduler {
  private maxConcurrency: number;
  private active = 0;
  private queue: QueuedTask<unknown>[] = [];

  constructor(config: SchedulerConfig) {
    this.maxConcurrency = config.maxConcurrency;
  }

  /**
   * Enqueue a task for execution. Returns when the task completes.
   * Tasks are scheduled FIFO within same priority (higher priority = earlier).
   */
  public async enqueue<T>(fn: () => Promise<T>, priority = 0): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ fn: fn, resolve: resolve as (v: unknown) => void, reject, priority });
      // Sort by priority descending
      this.queue.sort((a, b) => b.priority - a.priority);
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < this.maxConcurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      if (task === undefined) {
        continue;
      }
      this.active++;
      task.fn()
        .then(task.resolve)
        .catch(task.reject)
        .finally(() => {
          this.active--;
          this.drain();
        });
    }
  }

  public get pendingCount(): number {
    return this.queue.length;
  }

  public get activeCount(): number {
    return this.active;
  }
}
