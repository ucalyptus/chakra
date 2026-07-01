import type { CompletionRequest, CompletionResponse, LLMProvider } from './interface.js';

export interface AnthropicConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
}

interface AnthropicAPIResponse {
  id: string;
  model: string;
  content: ({ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown })[];
  stop_reason: 'end_turn' | 'max_tokens' | 'tool_use';
  usage: { input_tokens: number; output_tokens: number };
}

export class AnthropicProvider implements LLMProvider {
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(config: AnthropicConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://api.anthropic.com';
    this.defaultModel = config.defaultModel ?? 'claude-sonnet-4-20250514';
  }

  public async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const model = request.model || this.defaultModel;

    const body: Record<string, unknown> = {
      model,
      max_tokens: request.max_tokens ?? 4096,
      messages: request.messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role,
        content: m.content,
      })),
    };

    // System message goes in a separate field
    const systemMsg = request.messages.find(m => m.role === 'system');
    if (systemMsg !== undefined) {
      body.system = systemMsg.content;
    }

    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    if (request.tools !== undefined && request.tools.length > 0) {
      body.tools = request.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }));
    }

    const maxRetries = 3;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => { controller.abort(); }, 60_000);
      try {
    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const status = response.status;
      // Retry on server errors and rate limits
      if (status >= 500 || status === 429) {
        throw Object.assign(new Error(`Anthropic API error ${status}: ${errorText}`), { status });
      }
      throw new Error(`Anthropic API error ${status}: ${errorText}`);
    }

    const data = (await response.json()) as AnthropicAPIResponse;

    const textContent = data.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('');

    const toolCalls = data.content
      .filter((block): block is { type: 'tool_use'; id: string; name: string; input: unknown } => block.type === 'tool_use')
      .map(block => ({
        id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input),
      }));

    const finishReason = data.stop_reason === 'tool_use' ? 'tool_calls' as const
      : data.stop_reason === 'max_tokens' ? 'length' as const
      : 'stop' as const;

    return {
      content: textContent,
      model: data.model,
      usage: {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      },
      finishReason,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
      } catch (err) {
        lastError = err as Error;
        const status = (err as { status?: number }).status;
        if (status !== undefined && status < 500 && status !== 429) throw err;
        if (attempt < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError;
  }
}
