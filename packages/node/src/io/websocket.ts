import type { UserIOBridge } from './interface.js';
import type { RawData, WebSocket, WebSocketServer } from 'ws';

export interface WebSocketUserIOConfig {
  port?: number;
  host?: string;
}

interface WebSocketClientMessage {
  type: 'input';
  data: string;
}

interface WebSocketServerMessage {
  type: 'emit' | 'waiting';
  data?: string;
}

/**
 * WebSocket-based I/O for web UI integration.
 * Uses a simple message protocol: { type: 'emit' | 'input', data: string }
 */
export class WebSocketUserIO implements UserIOBridge {
  private readonly port: number;
  private readonly host: string;
  private server: WebSocketServer | null = null;
  private readonly connections = new Set<WebSocket>();
  private readonly inputResolvers: ((value: string) => void)[] = [];
  private readonly inputCallbacks: ((input: string) => void)[] = [];

  constructor(config: WebSocketUserIOConfig = {}) {
    this.port = config.port ?? 8080;
    this.host = config.host ?? 'localhost';
  }

  public async start(): Promise<void> {
    // Dynamic import to avoid hard dependency on ws
    const { WebSocketServer } = await import('ws');
    this.server = new WebSocketServer({ port: this.port, host: this.host });
    this.server.on('connection', (ws: WebSocket) => {
      this.connections.add(ws);
      ws.on('message', (data: RawData) => {
        const msg = this.parseClientMessage(data);
        if (msg !== null) {
          const resolver = this.inputResolvers.shift();
          if (resolver !== undefined) {
            resolver(msg.data);
          }
          for (const cb of this.inputCallbacks) cb(msg.data);
        }
      });
      ws.on('close', () => this.connections.delete(ws));
    });
  }

  public emit(message: string): Promise<void> {
    const payload = JSON.stringify({ type: 'emit', data: message } satisfies WebSocketServerMessage);
    for (const ws of this.connections) {
      ws.send(payload);
    }
    return Promise.resolve();
  }

  public waitForInput(): Promise<string> {
    // Signal to clients that we're waiting
    const payload = JSON.stringify({ type: 'waiting' } satisfies WebSocketServerMessage);
    for (const ws of this.connections) {
      ws.send(payload);
    }

    return new Promise<string>((resolve) => {
      this.inputResolvers.push(resolve);
    });
  }

  public onInput(callback: (input: string) => void): void {
    this.inputCallbacks.push(callback);
  }

  public close(): Promise<void> {
    if (this.server !== null) {
      this.server.close();
    }
    return Promise.resolve();
  }

  private parseClientMessage(data: RawData): WebSocketClientMessage | null {
    const text = this.rawDataToString(data);
    const parsed: unknown = JSON.parse(text);
    return this.isClientMessage(parsed) ? parsed : null;
  }

  private rawDataToString(data: RawData): string {
    if (typeof data === 'string') {
      return data;
    }

    if (data instanceof Buffer) {
      return data.toString();
    }

    if (Array.isArray(data)) {
      return Buffer.concat(data).toString();
    }

    return new TextDecoder().decode(data);
  }

  private isClientMessage(value: unknown): value is WebSocketClientMessage {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const { type, data } = value as { data?: unknown; type?: unknown };
    return type === 'input' && typeof data === 'string';
  }
}
