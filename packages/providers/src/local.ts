import type { CompletionRequest, CompletionResponse, LLMProvider } from './interface.js';

export interface LocalProviderConfig {
  baseUrl?: string;
  defaultModel?: string;
}

/**
 * Provider for local LLM servers (Ollama, vLLM, llama.cpp, LM Studio).
 * Uses OpenAI-compatible /v1/chat/completions endpoint.
 */
export class LocalProvider implements LLMProvider {
  private baseUrl: string;
  private defaultModel: string;

  constructor(config: LocalProviderConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'http://localhost:11434/v1';
    this.defaultModel = config.defaultModel ?? 'llama3.2';
  }

  public async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const model = request.model || this.defaultModel;
    const maxRetries = 2; // lower for local servers
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => { controller.abort(); }, 60_000);
      try {
    const body: Record<string, unknown> = {
      model,
      messages: request.messages,
      stream: false,
    };

    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    if (request.max_tokens !== undefined) {
      body.max_tokens = request.max_tokens;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const status = response.status;
      if (status >= 500 || status === 429) {
         
        throw Object.assign(new Error(`Local LLM API error ${status}: ${errorText}`), { status });
      }
      throw new Error(`Local LLM API error ${status}: ${errorText}`);
    }

    const data = (await response.json()) as {
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      choices?: { finish_reason?: string; message?: { content?: string | null } }[];
    };

    const choice = data.choices?.[0];

    return {
      content: choice?.message?.content ?? '',
      model: data.model ?? model,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      finishReason: choice?.finish_reason === 'length' ? 'length' : 'stop',
    };
      } catch (err) {
        lastError = err as Error;
        const status = (err as { status?: number }).status;
        if (status !== undefined && status < 500 && status !== 429) throw err;
        if (attempt < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError;
  }
}
