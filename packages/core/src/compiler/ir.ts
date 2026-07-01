import type { Node, Edge } from '../schema/types.js';

export interface CompiledNode {
  id: string;
  type: Node['type'];
  config: Node;
  inDegree: number;
  outDegree: number;
}

export interface InjectionSlot {
  storeId: string;
  maxTokens?: number;
}

export interface CompiledTemplate {
  staticFragments: string[];
  injections: InjectionSlot[];
  estimatedBaseTokens: number;
}

export interface ExecutionGroup {
  nodeIds: string[];
  parallel: boolean;
}

export interface CompiledGraph {
  id: string;
  name: string;
  nodes: Map<string, CompiledNode>;
  edges: Map<string, Edge[]>; // adjacency: nodeId -> outgoing edges
  reverseEdges: Map<string, string[]>; // nodeId -> incoming node IDs
  stores: Map<string, { id: string; name: string; writeMode: 'append' | 'replace'; maxEntries?: number; maxTokens?: number; initialValue?: string; builtin?: boolean }>;
  loopStarts: string[];
  loopEnds: string[];
  executionGroups: ExecutionGroup[];
  promptTemplates: Map<string, CompiledTemplate>;
  defaults: { model?: string; temperature?: number; maxIterations?: number };
}
