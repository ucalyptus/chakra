export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type RuntimeEvent =
  | { type: 'round.start'; round: number; timestamp: number }
  | { type: 'round.end'; round: number; timestamp: number }
  | { type: 'node.activated'; nodeId: string; round: number; input?: unknown; timestamp: number }
  | { type: 'actor.start'; nodeId: string; instanceIndex: number; prompt: string; timestamp: number }
  | {
      type: 'actor.complete';
      nodeId: string;
      instanceIndex: number;
      output: string;
      latencyMs: number;
      tokenUsage: TokenUsage;
      timestamp: number;
    }
  | { type: 'router.evaluated'; nodeId: string; selectedBranch: string; reason?: string; timestamp: number }
  | { type: 'await.slot_filled'; awaitId: string; filledCount: number; totalCount: number; timestamp: number }
  | { type: 'await.satisfied'; awaitId: string; outputs: unknown[]; timestamp: number }
  | { type: 'store.write'; storeId: string; mode: string; round: number; dataSizeBytes: number; timestamp: number }
  | { type: 'store.inject'; storeId: string; intoActor: string; injectedTokens: number; timestamp: number }
  | { type: 'user.output'; message: string; timestamp: number }
  | { type: 'user.input'; message: string; waitDurationMs: number; timestamp: number }
  | { type: 'error'; nodeId: string; error: string; timestamp: number };
