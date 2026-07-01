import type { CompletionRequest, CompletionResponse, LLMProvider } from './interface.js';

export interface OpenAIConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  organization?: string;
}

interface OpenAIResponse {
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  choices: {
    finish_reason: string;
    message: {
      content: string | null;
      tool_calls?: { id: string; function: { name: string; arguments: string } }[];
    };
  }[];
}

export class OpenAIProvider implements LLMProvider {
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;
  private organization?: string;

  constructor(config: OpenAIConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';
    this.defaultModel = config.defaultModel ?? 'gpt-4o';
    this.organization = config.organization;
  }

  public async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const model = request.model || this.defaultModel;
    const maxRetries = 3;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => { controller.abort(); }, 60_000);
      try {
        const body: Record<string, unknown> = {
          model,
          messages: request.messages,
          max_tokens: request.max_tokens ?? 4096,
        };

        if (request.temperature !== undefined) {
          body.temperature = request.temperature;
        }

        if (request.tools !== undefined && request.tools.length > 0) {
          body.tools = request.tools.map(tool => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          }));
        }

        const headers: Record<string, string> = {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        };
        if (this.organization !== undefined && this.organization !== '') {
          headers['OpenAI-Organization'] = this.organization;
        }

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          signal: controller.signal,
          headers,
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorText = await response.text();
          const status = response.status;
          // Retry on server errors and rate limits
          if (status >= 500 || status === 429) {
             
        throw Object.assign(new Error(`OpenAI API error ${status}: ${errorText}`), { status });
          }
          throw new Error(`OpenAI API error ${status}: ${errorText}`);
        }

        const data = (await response.json()) as OpenAIResponse;
        const choice = data.choices[0];
        const toolCalls = choice.message.tool_calls?.map(tc => ({
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        }));

        const finishReason = choice.finish_reason === 'tool_calls' || (toolCalls !== undefined && toolCalls.length > 0)
          ? 'tool_calls' as const
          : choice.finish_reason === 'length' ? 'length' as const
          : 'stop' as const;

        return {
          content: choice.message.content ?? '',
          model: data.model,
          usage: {
            inputTokens: data.usage?.prompt_tokens ?? 0,
            outputTokens: data.usage?.completion_tokens ?? 0,
            totalTokens: data.usage?.total_tokens ?? 0,
          },
          finishReason,
          toolCalls: toolCalls !== undefined && toolCalls.length > 0 ? toolCalls : undefined,
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
