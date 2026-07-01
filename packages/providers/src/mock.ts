import type { CompletionRequest, CompletionResponse, LLMProvider } from './interface.js';

export interface MockResponse {
  nodeId?: string;
  instanceIndex?: number;
  content: string;
  latencyMs?: number;
}

interface MockCompletionRequest extends CompletionRequest {
  nodeId?: string;
  instanceIndex?: number;
}

export class MockProvider implements LLMProvider {
  private responses: MockResponse[];
  private callIndex = 0;
  private responseIndex = 0;
  private calls: CompletionRequest[] = [];

  constructor(responses: MockResponse[]) {
    this.responses = responses;
  }

  public async complete(request: CompletionRequest): Promise<CompletionResponse> {
    this.calls.push(request);
    this.callIndex++;

    const matchedResponse = this.findResponse(request);
    const response = matchedResponse?.response ?? {
      content: `Mock response #${this.callIndex - 1}`,
    };

    if (response.latencyMs !== undefined && response.latencyMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, response.latencyMs);
      });
    }

    const inputTokens = request.messages.reduce(
      (sum, message) => sum + Math.ceil(message.content.length / 4),
      0,
    );
    const outputTokens = Math.ceil(response.content.length / 4);

    return {
      content: response.content,
      model: request.model,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      finishReason: 'stop',
    };
  }

  public getCalls(): CompletionRequest[] {
    return this.calls;
  }

  public getCallCount(): number {
    return this.callIndex;
  }

  public reset(): void {
    this.callIndex = 0;
    this.responseIndex = 0;
    this.calls = [];
  }

  private findResponse(
    request: MockCompletionRequest,
  ): { response: MockResponse; index: number } | undefined {
    const match = this.responses.find((response, index) => {
      if (index < this.responseIndex) {
        return false;
      }

      if (
        response.nodeId !== undefined &&
        response.nodeId !== request.nodeId
      ) {
        return false;
      }

      if (
        response.instanceIndex !== undefined &&
        response.instanceIndex !== request.instanceIndex
      ) {
        return false;
      }

      return true;
    });

    if (!match) {
      return undefined;
    }

    const index = this.responses.indexOf(match);
    this.responseIndex = index + 1;

    return { response: match, index };
  }
}
