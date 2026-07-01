import type { Graph } from './graph.js';
import type { Edge, Node, LoopStart } from './types.js';

export interface ValidationError {
  severity: 'error' | 'warning';
  rule: string;
  message: string;
  nodeId?: string;
}

type NodeMap = Map<string, Node>;
type AdjacencyMap = Map<string, string[]>;

const CHANNEL_TEMPLATE_PATTERN = /\{\{\s*channel\s*:\s*(\w+)(?::(\d+))?\s*\}\}/g;
const FALLBACK_LABELS = new Set(['fallback', 'default', 'else']);

export function validateGraph(program: Graph): ValidationError[] {
  if (program?.nodes == null) {
    return [{ severity: 'error', rule: 'INVALID_INPUT', message: 'Invalid graph: missing nodes array' }];
  }
  const errors: ValidationError[] = [];
  const nodeMap = new Map(program.nodes.map((node) => [node.id, node]));
  const storeIds = new Set(program.stores.map((channel) => channel.id));
  const allEdges = program.edges.filter((edge) => edge.type === 'control' || edge.type === 'data');
  const adjacency = buildAdjacency(allEdges);
  const reverseAdjacency = buildReverseAdjacency(allEdges);

  validateNoSelfLoops(program.edges, errors);
  validateInstanceCounts(program.nodes, errors);
  validateStores(program.nodes, storeIds, errors);
  validateTemplates(program.nodes, storeIds, errors);
  validateRouterFallbacks(program.nodes, errors);
  validateAwaitReachable(program.nodes, nodeMap, reverseAdjacency, errors);
  validateOrphanNodes(program.nodes, adjacency, errors);
  validateLegalCycles(program.nodes, nodeMap, adjacency, errors);
  validateLoopTerminates(program.nodes, nodeMap, adjacency, errors);

  return errors;
}

function buildAdjacency(edges: Edge[]): AdjacencyMap {
  const adjacency = new Map<string, string[]>();

  for (const edge of edges) {
    const targets = adjacency.get(edge.from);
    if (targets) {
      targets.push(edge.to);
    } else {
      adjacency.set(edge.from, [edge.to]);
    }
  }

  return adjacency;
}

function buildReverseAdjacency(edges: Edge[]): AdjacencyMap {
  const adjacency = new Map<string, string[]>();

  for (const edge of edges) {
    const sources = adjacency.get(edge.to);
    if (sources) {
      sources.push(edge.from);
    } else {
      adjacency.set(edge.to, [edge.from]);
    }
  }

  return adjacency;
}

function validateNoSelfLoops(edges: Edge[], errors: ValidationError[]): void {
  for (const edge of edges) {
    if (edge.from !== edge.to) {
      continue;
    }

    errors.push({
      severity: 'error',
      rule: 'NO_SELF_LOOPS',
      message: `Self-loop detected on node "${edge.from}".`,
      nodeId: edge.from,
    });
  }
}

function validateInstanceCounts(nodes: Node[], errors: ValidationError[]): void {
  for (const node of nodes) {
    if (node.type !== 'actor' || node.instances === undefined || node.instances >= 1) {
      continue;
    }

    errors.push({
      severity: 'error',
      rule: 'INSTANCE_POSITIVE',
      message: `Actor "${node.id}" must declare instances >= 1.`,
      nodeId: node.id,
    });
  }
}

function validateStores(nodes: Node[], storeIds: Set<string>, errors: ValidationError[]): void {
  for (const node of nodes) {
    if (node.type !== 'actor') {
      continue;
    }

    for (const storeId of node.subscribe) {
      if (storeIds.has(storeId)) {
        continue;
      }

      errors.push({
        severity: 'error',
        rule: 'CHANNEL_EXISTS',
        message: `Actor "${node.id}" subscribes to undeclared channel "${storeId}".`,
        nodeId: node.id,
      });
    }

    if (node.publish !== undefined && node.publish !== '' && !storeIds.has(node.publish)) {
      errors.push({
        severity: 'error',
        rule: 'CHANNEL_EXISTS',
        message: `Actor "${node.id}" publishes to undeclared channel "${node.publish}".`,
        nodeId: node.id,
      });
    }
  }
}

function validateTemplates(nodes: Node[], storeIds: Set<string>, errors: ValidationError[]): void {
  for (const node of nodes) {
    if (node.type !== 'actor') {
      continue;
    }

    for (const storeId of extractTemplateChannels(node.prompt_template)) {
      if (storeIds.has(storeId)) {
        continue;
      }

      errors.push({
        severity: 'error',
        rule: 'TEMPLATE_VALID',
        message: `Actor "${node.id}" references undeclared channel "${storeId}" in its prompt template.`,
        nodeId: node.id,
      });
    }
  }
}

function validateRouterFallbacks(nodes: Node[], errors: ValidationError[]): void {
  for (const node of nodes) {
    if (node.type !== 'router' || node.mode !== 'llm_driven') {
      continue;
    }

    const hasFallback = node.branches.some((branch) => FALLBACK_LABELS.has(branch.label.trim().toLowerCase()));
    if (hasFallback) {
      continue;
    }

    errors.push({
      severity: 'warning',
      rule: 'CHOICE_EXHAUSTIVE',
      message: `LLM-driven router "${node.id}" has no branch labeled fallback/default/else.`,
      nodeId: node.id,
    });
  }
}

function validateAwaitReachable(
  nodes: Node[],
  nodeMap: NodeMap,
  reverseAdjacency: AdjacencyMap,
  errors: ValidationError[],
): void {
  for (const node of nodes) {
    if (node.type !== 'join' || node.await_count === 'all') {
      continue;
    }

    const reachableActors = collectUpstreamActors(node.id, nodeMap, reverseAdjacency);
    const reachableCount = Array.from(reachableActors).reduce((sum, actorId) => {
      const actor = nodeMap.get(actorId);
      return actor?.type === 'actor' ? sum + (actor.instances ?? 1) : sum;
    }, 0);

    if (node.await_count <= reachableCount) {
      continue;
    }

    errors.push({
      severity: 'error',
      rule: 'AWAIT_REACHABLE',
      message: `Await node "${node.id}" requests ${node.await_count} results but only ${reachableCount} upstream actor instance(s) are reachable.`,
      nodeId: node.id,
    });
  }
}

function collectUpstreamActors(nodeId: string, nodeMap: NodeMap, reverseAdjacency: AdjacencyMap): Set<string> {
  const visited = new Set<string>();
  const actorIds = new Set<string>();
  const stack = [...(reverseAdjacency.get(nodeId) ?? [])];

  while (stack.length > 0) {
    const currentId = stack.pop();
    if (currentId === undefined || visited.has(currentId)) {
      continue;
    }

    visited.add(currentId);
    const node = nodeMap.get(currentId);
    if (node?.type === 'actor') {
      actorIds.add(currentId);
    }

    const parents = reverseAdjacency.get(currentId);
    if (parents) {
      stack.push(...parents);
    }
  }

  return actorIds;
}

function validateOrphanNodes(nodes: Node[], adjacency: AdjacencyMap, errors: ValidationError[]): void {
  const startIds = nodes.filter(isLoopStart).map((node) => node.id);
  const reachable = traverse(startIds, adjacency);

  for (const node of nodes) {
    if (reachable.has(node.id)) {
      continue;
    }

    errors.push({
      severity: 'error',
      rule: 'NO_ORPHAN_NODES',
      message: `Node "${node.id}" is not reachable from any loop_start node.`,
      nodeId: node.id,
    });
  }
}

function validateLegalCycles(nodes: Node[], nodeMap: NodeMap, adjacency: AdjacencyMap, errors: ValidationError[]): void {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const reported = new Set<string>();

  for (const node of nodes) {
    if (visited.has(node.id)) {
      continue;
    }

    detectIllegalCycles(node.id, nodeMap, adjacency, visited, visiting, reported, [], errors);
  }
}

function detectIllegalCycles(
  nodeId: string,
  nodeMap: NodeMap,
  adjacency: AdjacencyMap,
  visited: Set<string>,
  visiting: Set<string>,
  reported: Set<string>,
  path: string[],
  errors: ValidationError[],
): void {
  visited.add(nodeId);
  visiting.add(nodeId);
  path.push(nodeId);

  for (const nextId of adjacency.get(nodeId) ?? []) {
    if (nextId === nodeId) {
      continue;
    }

    if (!visited.has(nextId)) {
      detectIllegalCycles(nextId, nodeMap, adjacency, visited, visiting, reported, path, errors);
      continue;
    }

    if (!visiting.has(nextId)) {
      continue;
    }

    const cycleStart = path.indexOf(nextId);
    if (cycleStart === -1) {
      continue;
    }

    const cycle = path.slice(cycleStart);
    if (cycle.some((id) => isLoopBoundary(nodeMap.get(id)))) {
      continue;
    }

    const signature = [...cycle].sort().join('|');
    if (reported.has(signature)) {
      continue;
    }

    reported.add(signature);
    errors.push({
      severity: 'error',
      rule: 'LEGAL_CYCLES',
      message: `Illegal cycle detected: ${cycle.join(' -> ')} -> ${nextId}. Cycles must pass through a loop boundary.`,
      nodeId: nextId,
    });
  }

  path.pop();
  visiting.delete(nodeId);
}

function validateLoopTerminates(nodes: Node[], nodeMap: NodeMap, adjacency: AdjacencyMap, errors: ValidationError[]): void {
  const startIds = nodes.filter(isLoopStart).map((node) => node.id);
  const reachable = traverse(startIds, adjacency);
  const hasReachableEnd = Array.from(reachable).some((nodeId) => nodeMap.get(nodeId)?.type === 'loop_end');

  if (hasReachableEnd) {
    return;
  }

  errors.push({
    severity: 'warning',
    rule: 'ROUND_TERMINATES',
    message: 'No control-flow path from loop_start reaches a loop_end node.',
  });
}

function traverse(startIds: string[], adjacency: AdjacencyMap): Set<string> {
  const visited = new Set<string>();
  const stack = [...startIds];

  while (stack.length > 0) {
    const currentId = stack.pop();
    if (currentId === undefined || visited.has(currentId)) {
      continue;
    }

    visited.add(currentId);
    const targets = adjacency.get(currentId);
    if (targets) {
      stack.push(...targets);
    }
  }

  return visited;
}

function extractTemplateChannels(template: string): string[] {
  const storeIds: string[] = [];

  for (const match of template.matchAll(CHANNEL_TEMPLATE_PATTERN)) {
    const storeId = match[1].trim();
    if (storeId !== '') {
      storeIds.push(storeId);
    }
  }

  return storeIds;
}

function isLoopStart(node: Node): node is LoopStart {
  return node.type === 'loop_start';
}

function isLoopBoundary(node: Node | undefined): node is LoopStart | Extract<Node, { type: 'loop_end' }> {
  return node !== undefined && (node.type === 'loop_start' || node.type === 'loop_end');
}
