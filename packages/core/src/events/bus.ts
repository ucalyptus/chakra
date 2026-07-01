import type { RuntimeEvent } from './types.js';

export type EventListener = (event: RuntimeEvent) => void;
export type EventFilter = (event: RuntimeEvent) => boolean;

export class EventBus {
  private listeners: EventListener[] = [];
  private filteredListeners: { filter: EventFilter; listener: EventListener }[] = [];

  public on(listener: EventListener): () => void {
    this.listeners.push(listener);

    return () => {
      this.listeners = this.listeners.filter((currentListener) => currentListener !== listener);
    };
  }

  public onType(type: RuntimeEvent['type'], listener: EventListener): () => void {
    const entry = {
      filter: (event: RuntimeEvent) => event.type === type,
      listener,
    };

    this.filteredListeners.push(entry);

    return () => {
      this.filteredListeners = this.filteredListeners.filter((currentEntry) => currentEntry !== entry);
    };
  }

  public emit(event: RuntimeEvent): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }

    for (const { filter, listener } of [...this.filteredListeners]) {
      if (filter(event)) {
        listener(event);
      }
    }
  }

  public clear(): void {
    this.listeners = [];
    this.filteredListeners = [];
  }
}
