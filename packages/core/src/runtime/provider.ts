export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface CompletionRequest {
  model: string;
  messages: Message[];
  temperature?: number;
  tools?: ToolDefinition[];
  max_tokens?: number;
}

export interface CompletionResponse {
  content: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  finishReason: 'stop' | 'length' | 'tool_calls';
  toolCalls?: {
    id: string;
    name: string;
    arguments: string;
  }[];
}

export interface LLMProvider {
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}
