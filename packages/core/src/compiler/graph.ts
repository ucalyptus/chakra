import type { Graph, Node, Edge, Store } from '../schema/types.js';
import type { CompiledNode, CompiledGraph, CompiledTemplate, ExecutionGroup } from './ir.js';
import { compilePromptTemplate } from './prompt-compiler.js';

export function buildGraph(program: Graph): CompiledGraph {
  const nodes = new Map<string, CompiledNode>();
  const edges = new Map<string, Edge[]>();
  const reverseEdges = new Map<string, string[]>();

  // Initialize node maps
  for (const node of program.nodes) {
    nodes.set(node.id, {
      id: node.id,
      type: node.type,
      config: node,
      inDegree: 0,
      outDegree: 0,
    });
    edges.set(node.id, []);
    reverseEdges.set(node.id, []);
  }

  // Populate edges
  for (const edge of program.edges) {
    const outList = edges.get(edge.from);
    if (outList) {
      outList.push(edge);
      const fromNode = nodes.get(edge.from);
      if (fromNode) fromNode.outDegree++;
    }
    const inList = reverseEdges.get(edge.to);
    if (inList) {
      inList.push(edge.from);
      const toNode = nodes.get(edge.to);
      if (toNode) toNode.inDegree++;
    }
  }

  // Memory channels
  const stores = new Map<string, {
    id: string;
    name: string;
    writeMode: Store['write_mode'];
    maxEntries?: number;
    maxTokens?: number;
    initialValue?: string;
    builtin?: boolean;
  }>(
    program.stores.map(ch => [ch.id, {
      id: ch.id,
      name: ch.name,
      writeMode: ch.write_mode,
      maxEntries: ch.max_entries,
      maxTokens: ch.max_tokens,
      initialValue: ch.initial_value,
      builtin: ch.builtin,
    }])
  );

  // Round boundaries
  const loopStarts = program.nodes.filter(n => n.type === 'loop_start').map(n => n.id);
  const loopEnds = program.nodes.filter(n => n.type === 'loop_end').map(n => n.id);

  // Compile prompt templates
  const promptTemplates = new Map<string, CompiledTemplate>();
  for (const node of program.nodes) {
    if (node.type === 'actor' && node.prompt_template) {
      promptTemplates.set(node.id, compilePromptTemplate(node.prompt_template));
    }
  }

  // Compute execution groups (simple: parallel actors at same depth)
  const executionGroups = computeExecutionGroups(program.nodes, edges);

  return {
    id: `${program.name}-${Date.now()}`,
    name: program.name,
    nodes,
    edges,
    reverseEdges,
    stores,
    loopStarts,
    loopEnds,
    executionGroups,
    promptTemplates,
    defaults: {
      model: program.defaults?.model,
      temperature: program.defaults?.temperature,
      maxIterations: program.defaults?.max_iterations,
    },
  };
}

function computeExecutionGroups(nodes: Node[], edges: Map<string, Edge[]>): ExecutionGroup[] {
  // Build adjacency for topological-level grouping
  const inDegree = new Map<string, number>();
  for (const node of nodes) {
    inDegree.set(node.id, 0);
  }
  for (const [, edgeList] of edges) {
    for (const edge of edgeList) {
      const current = inDegree.get(edge.to) ?? 0;
      inDegree.set(edge.to, current + 1);
    }
  }

  // Group independent nodes (in-degree 0) for parallel execution
  const groups: ExecutionGroup[] = [];
  const visited = new Set<string>();

  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    if (node.type === 'actor' && 'instances' in node && (node.instances ?? 1) > 1) {
      // Multi-instance actors can run their instances in parallel
      groups.push({ nodeIds: [node.id], parallel: true });
      visited.add(node.id);
    } else if ((inDegree.get(node.id) ?? 0) === 0 && !visited.has(node.id)) {
      // Group all independent (in-degree 0) sibling nodes for parallel execution
      const siblingGroup: string[] = [];
      for (const sibling of nodes) {
        if (!visited.has(sibling.id) && (inDegree.get(sibling.id) ?? 0) === 0) {
          siblingGroup.push(sibling.id);
          visited.add(sibling.id);
        }
      }
      if (siblingGroup.length > 1) {
        groups.push({ nodeIds: siblingGroup, parallel: true });
      }
    }
  }

  return groups;
}
