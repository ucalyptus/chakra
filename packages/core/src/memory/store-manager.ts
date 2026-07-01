import type { Store as StoreConfig } from '../schema/types.js';
import type { MemoryEntry } from './store.js';
import { StoreInstance } from './store.js';

export interface MemorySnapshot {
  stores: Map<string, MemoryEntry[]>;
}

export interface InjectionSlot {
  storeId: string;
  maxTokens?: number;
}

export interface CompiledTemplate {
  staticFragments: string[];
  injections: InjectionSlot[];
}

export class StoreManager {
  private stores = new Map<string, StoreInstance>();
  private currentRound = 0;

  constructor(configs: StoreConfig[]) {
    for (const config of configs) {
      const channel = new StoreInstance(config);
      this.stores.set(config.id, channel);

      if (config.initial_value !== undefined) {
        channel.write(config.initial_value, 0);
      }
    }
  }

  public setRound(round: number): void {
    this.currentRound = round;
  }

  public write(storeId: string, data: string): void {
    const channel = this.stores.get(storeId);

    if (!channel) {
      throw new Error(`Unknown memory channel: ${storeId}`);
    }

    channel.write(data, this.currentRound);
  }

  public read(storeId: string): string {
    const channel = this.stores.get(storeId);

    if (!channel) {
      throw new Error(`Unknown memory channel: ${storeId}`);
    }

    return channel.read();
  }

  public inject(template: CompiledTemplate, subscriptions: string[]): string {
    const subscriptionSet = new Set(subscriptions);
    let prompt = '';

    for (let index = 0; index < template.staticFragments.length; index += 1) {
      prompt += template.staticFragments[index];

      const injection = template.injections.at(index);
      if (injection === undefined || !subscriptionSet.has(injection.storeId)) {
        continue;
      }

      const channel = this.stores.get(injection.storeId);
      if (!channel) {
        throw new Error(`Unknown memory channel: ${injection.storeId}`);
      }

      const maxTokens = injection.maxTokens ?? channel.maxTokens;
      prompt += this.truncateToTokenBudget(channel.read(), maxTokens);
    }

    return prompt;
  }

  public snapshot(): MemorySnapshot {
    const stores = new Map<string, MemoryEntry[]>();

    for (const [storeId, channel] of this.stores.entries()) {
      stores.set(storeId, channel.snapshot());
    }

    return { stores };
  }

  public restore(snapshot: MemorySnapshot): void {
    for (const [storeId, channel] of this.stores.entries()) {
      channel.restore(snapshot.stores.get(storeId) ?? []);
    }
  }

  public getStore(id: string): StoreInstance | undefined {
    return this.stores.get(id);
  }

  public getAllStoreIds(): string[] {
    return Array.from(this.stores.keys());
  }

  private truncateToTokenBudget(content: string, maxTokens?: number): string {
    if (maxTokens === undefined) {
      return content;
    }

    const maxCharacters = Math.max(0, maxTokens) * 4;
    return content.length <= maxCharacters ? content : content.slice(0, maxCharacters);
  }
}
