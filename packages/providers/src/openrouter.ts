import type { CompletionRequest, CompletionResponse, LLMProvider } from './interface.js';

export interface OpenRouterConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
}

interface OpenRouterResponse {
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  choices?: {
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: {
        id: string;
        function: {
          name: string;
          arguments: string;
        };
      }[];
    };
  }[];
}

export class OpenRouterProvider implements LLMProvider {
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(config: OpenRouterConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://openrouter.ai/api/v1';
    this.defaultModel = config.defaultModel ?? 'minimax/minimax-01';
  }

  public async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const model = request.model || this.defaultModel;
    const maxRetries = 3;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => { controller.abort(); }, 60_000);
        try {
          const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://github.com/ucalyptus/chakra',
            },
            body: JSON.stringify({
              model,
              messages: request.messages,
              temperature: request.temperature,
              max_tokens: request.max_tokens ?? 4096,
              tools: request.tools?.map((tool) => ({
                type: 'function',
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                },
              })),
            }),
          });
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenRouter API error ${response.status}: ${errorText}`);
          }
          const data = (await response.json()) as OpenRouterResponse;
          const choice = data.choices?.[0];
          const toolCalls = choice?.message?.tool_calls?.map((toolCall) => ({
            id: toolCall.id,
            name: toolCall.function.name,
            arguments: toolCall.function.arguments,
          }));
          const finishReason =
            choice?.finish_reason === 'tool_calls' || (toolCalls && toolCalls.length > 0)
              ? 'tool_calls'
              : choice?.finish_reason === 'length'
                ? 'length'
                : 'stop';

          return {
            content: choice?.message?.content ?? '',
            model: data.model ?? model,
            usage: {
              inputTokens: data.usage?.prompt_tokens ?? 0,
              outputTokens: data.usage?.completion_tokens ?? 0,
              totalTokens: data.usage?.total_tokens ?? 0,
            },
            finishReason,
            toolCalls,
          };
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        lastError = err as Error;
        const status = (err as { status?: number }).status;
        // Only retry on server errors (5xx) or rate limits (429)
        if (status !== undefined && status < 500 && status !== 429) throw err;
        if (attempt < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }
    throw lastError;
  }
}
