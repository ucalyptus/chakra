import type { RuntimeEvent } from './types.js';
import type { TraceLog } from './trace.js';

interface ReplayCompletionRequest {
  model: string;
  messages: { role: string; content: string }[];
  temperature?: number;
  max_tokens?: number;
}

interface ReplayCompletionResponse {
  content: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  finishReason: 'stop' | 'length' | 'tool_calls';
}

interface ReplayLLMProvider {
  complete(request: ReplayCompletionRequest): Promise<ReplayCompletionResponse>;
}

/**
 * Replay engine — feeds recorded actor outputs to a mock provider,
 * enabling deterministic re-execution of a program trace.
 */
export class ReplayEngine {
  private trace: TraceLog;
  private eventIndex = 0;

  constructor(trace: TraceLog) {
    this.trace = trace;
  }

  /**
   * Create an LLM provider that replays recorded actor.complete events
   * in sequence, returning the recorded outputs.
   */
  public createReplayProvider(): ReplayLLMProvider {
    const completions = this.trace.getEventsByType('actor.complete') as {
      type: 'actor.complete';
      nodeId: string;
      instanceIndex: number;
      output: string;
      latencyMs: number;
      tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
    }[];

    let callIndex = 0;

    return {
      complete(request: ReplayCompletionRequest): Promise<ReplayCompletionResponse> {
        const recorded = completions.at(callIndex);
        callIndex++;

        if (recorded === undefined) {
          return Promise.resolve({
            content: '[replay exhausted]',
            model: request.model,
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            finishReason: 'stop',
          });
        }

        return Promise.resolve({
          content: recorded.output,
          model: request.model,
          usage: recorded.tokenUsage,
          finishReason: 'stop',
        });
      },
    };
  }

  /**
   * Get recorded events as a stream, suitable for animated visualization.
   */
  public *events(): Generator<RuntimeEvent> {
    for (const event of this.trace.getEvents()) {
      yield event;
    }
  }

  /**
   * Get summary stats from the trace.
   */
  public summary(): {
    rounds: number;
    totalTokens: number;
    totalLatencyMs: number;
    actorCount: number;
    routerCount: number;
  } {
    const completions = this.trace.getEventsByType('actor.complete') as {
      latencyMs: number;
      tokenUsage: { totalTokens: number };
    }[];

    return {
      rounds: this.trace.getEventsByType('round.start').length,
      totalTokens: completions.reduce((s, e) => s + e.tokenUsage.totalTokens, 0),
      totalLatencyMs: completions.reduce((s, e) => s + e.latencyMs, 0),
      actorCount: completions.length,
      routerCount: this.trace.getEventsByType('router.evaluated').length,
    };
  }
}
