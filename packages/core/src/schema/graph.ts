import type { Edge, Store, Node } from './types.js';

export interface GraphDefaults {
  model?: string;
  temperature?: number;
  max_iterations?: number;
}

export interface Graph {
  name: string;
  version?: string;
  defaults?: GraphDefaults;
  stores: Store[];
  nodes: Node[];
  edges: Edge[];
}
