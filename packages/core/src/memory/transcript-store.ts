import type { MemoryEntry } from './store.js';
import { StoreInstance } from './store.js';

/**
 * Built-in transcript channel with structured message formatting.
 * Handles user/assistant message tagging and optional summarization.
 */
export class TranscriptStore {
  private channel: StoreInstance;

  constructor(maxEntries?: number, maxTokens?: number) {
    this.channel = new StoreInstance({
      id: 'transcript',
      name: 'Conversation Transcript',
      write_mode: 'append',
      max_entries: maxEntries,
      max_tokens: maxTokens,
      builtin: true,
    });
  }

  public addUserMessage(message: string, round: number): void {
    this.channel.write(`[user] ${message}`, round);
  }

  public addAssistantMessage(message: string, round: number): void {
    this.channel.write(`[assistant] ${message}`, round);
  }

  public addSystemMessage(message: string, round: number): void {
    this.channel.write(`[system] ${message}`, round);
  }

  public read(): string {
    return this.channel.read();
  }

  public getEntries(): MemoryEntry[] {
    return this.channel.getEntries();
  }

  public getMessages(): { role: 'user' | 'assistant' | 'system'; content: string; round: number }[] {
    return this.channel.getEntries().map(entry => {
      const match = /^\[(user|assistant|system)\]\s(.*)$/s.exec(entry.data);
      if (match) {
        return { role: match[1] as 'user' | 'assistant' | 'system', content: match[2], round: entry.round };
      }
      return { role: 'system' as const, content: entry.data, round: entry.round };
    });
  }

  public snapshot(): MemoryEntry[] {
    return this.channel.snapshot();
  }

  public restore(entries: MemoryEntry[]): void {
    this.channel.restore(entries);
  }

  public clear(): void {
    this.channel.clear();
  }

  public get instance(): StoreInstance {
    return this.channel;
  }
}
