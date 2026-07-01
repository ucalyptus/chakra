import type { LLMProvider } from '../runtime/runner.js';
import type { EventBus } from '../events/bus.js';

/**
 * Streaming support — wraps an LLM provider to emit partial tokens
 * as they arrive, while still collecting the full response.
 */

export interface StreamChunk {
  content: string;
  done: boolean;
  tokenIndex: number;
}

export type StreamCallback = (chunk: StreamChunk) => void;

export interface StreamingProvider extends LLMProvider {
  stream(request: {
    model: string;
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
    temperature?: number;
    max_tokens?: number;
  }, onChunk: StreamCallback): Promise<{
    content: string;
    usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  }>;
}

/**
 * Wraps any provider that supports streaming to emit chunks through the event bus.
 * Falls back to non-streaming complete() if stream() is not available.
 */
export class StreamingAdapter {
  private provider: LLMProvider;
  private eventBus: EventBus;
  private onChunk?: StreamCallback;

  constructor(provider: LLMProvider, eventBus: EventBus, onChunk?: StreamCallback) {
    this.provider = provider;
    this.eventBus = eventBus;
    this.onChunk = onChunk;
  }

  public async completeWithStreaming(request: {
    model: string;
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
    temperature?: number;
    max_tokens?: number;
  }): Promise<{
    content: string;
    usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  }> {
    // Check if provider supports streaming
    if (this.isStreamingProvider(this.provider)) {
      let tokenIndex = 0;
      const result = await this.provider.stream(request, (chunk) => {
        this.onChunk?.({
          content: chunk.content,
          done: chunk.done,
          tokenIndex: tokenIndex++,
        });
      });
      return result;
    }

    // Fallback to non-streaming
    const response = await this.provider.complete(request);
    this.onChunk?.({
      content: response.content,
      done: true,
      tokenIndex: 0,
    });
    return response;
  }

  private isStreamingProvider(provider: LLMProvider): provider is StreamingProvider {
    return 'stream' in provider && typeof (provider as StreamingProvider).stream === 'function';
  }
}

/**
 * Create a simple SSE (Server-Sent Events) formatter for streaming chunks.
 */
export function formatSSE(chunk: StreamChunk): string {
  const data = JSON.stringify({ content: chunk.content, done: chunk.done });
  return `data: ${data}\n\n`;
}
