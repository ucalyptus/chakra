import type { Graph, Node, Edge } from '../schema/types.js';

export interface AnalysisResult {
  errors: AnalysisDiagnostic[];
  warnings: AnalysisDiagnostic[];
}

export interface AnalysisDiagnostic {
  rule: string;
  message: string;
  nodeId?: string;
}

type AdjacencyMap = Map<string, string[]>;

export function analyzeGraph(program: Graph): AnalysisResult {
  const errors: AnalysisDiagnostic[] = [];
  const warnings: AnalysisDiagnostic[] = [];

  const nodeMap = new Map(program.nodes.map(n => [n.id, n]));
  const adjacency = buildForwardAdjacency(program.edges);
  const reverseAdj = buildReverseAdjacency(program.edges);
  const loopStarts = program.nodes.filter(n => n.type === 'loop_start').map(n => n.id);
  const loopEnds = program.nodes.filter(n => n.type === 'loop_end').map(n => n.id);

  detectCycles(program.nodes, nodeMap, adjacency, loopEnds, errors);
  detectDeadlocks(program.nodes, nodeMap, reverseAdj, errors);
  detectUnreachable(program.nodes, loopStarts, adjacency, errors);
  checkQuiescence(program.nodes, loopStarts, adjacency, loopEnds, warnings);

  return { errors, warnings };
}

function buildForwardAdjacency(edges: Edge[]): AdjacencyMap {
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.type === 'control' || edge.type === 'data') {
      const list = adj.get(edge.from) ?? [];
      list.push(edge.to);
      adj.set(edge.from, list);
    }
  }
  return adj;
}

function buildReverseAdjacency(edges: Edge[]): AdjacencyMap {
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.type === 'control' || edge.type === 'data') {
      const list = adj.get(edge.to) ?? [];
      list.push(edge.from);
      adj.set(edge.to, list);
    }
  }
  return adj;
}

/** Cycles are only legal if they pass through a LoopEnd→LoopStart boundary */
function detectCycles(
  nodes: Node[],
  nodeMap: Map<string, Node>,
  adjacency: AdjacencyMap,
  loopEnds: string[],
  errors: AnalysisDiagnostic[],
): void {
  const roundEndSet = new Set(loopEnds);
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const node of nodes) color.set(node.id, WHITE);

  function dfs(nodeId: string, path: string[]): void {
    color.set(nodeId, GRAY);
    const neighbors = adjacency.get(nodeId) ?? [];
    for (const next of neighbors) {
      // Skip edges from loop_end (those loop back legally)
      if (roundEndSet.has(nodeId)) continue;

      if (color.get(next) === GRAY) {
        errors.push({
          rule: 'LEGAL_CYCLES',
          message: `Illegal cycle detected: ${[...path, nodeId, next].join(' → ')}. Cycles are only allowed through LoopEnd→LoopStart.`,
          nodeId: next,
        });
      } else if (color.get(next) === WHITE) {
        dfs(next, [...path, nodeId]);
      }
    }
    color.set(nodeId, BLACK);
  }

  for (const node of nodes) {
    if (color.get(node.id) === WHITE) {
      dfs(node.id, []);
    }
  }
}

/** Join with await_count exceeding reachable upstream actors */
function detectDeadlocks(
  nodes: Node[],
  nodeMap: Map<string, Node>,
  reverseAdj: AdjacencyMap,
  errors: AnalysisDiagnostic[],
): void {
  for (const node of nodes) {
    if (node.type !== 'join') continue;
    const awaitCount = node.await_count === 'all' ? Infinity : node.await_count;

    // Count reachable upstream actors via BFS on reverse edges
    const visited = new Set<string>();
    const queue = [...(reverseAdj.get(node.id) ?? [])];
    let upstreamActors = 0;

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) {
        continue;
      }
      if (visited.has(current)) continue;
      visited.add(current);
      const upstream = nodeMap.get(current);
      if (upstream?.type === 'actor') {
        const instances = 'instances' in upstream && upstream.instances !== undefined ? upstream.instances : 1;
        upstreamActors += instances;
      }
      for (const prev of reverseAdj.get(current) ?? []) {
        if (!visited.has(prev)) queue.push(prev);
      }
    }

    if (awaitCount !== Infinity && awaitCount > upstreamActors) {
      errors.push({
        rule: 'AWAIT_REACHABLE',
        message: `Join "${node.id}" expects ${awaitCount} completions but only ${upstreamActors} upstream actor instance(s) are reachable.`,
        nodeId: node.id,
      });
    }
  }
}

/** Every node must be reachable from at least one LoopStart */
function detectUnreachable(
  nodes: Node[],
  loopStarts: string[],
  adjacency: AdjacencyMap,
  errors: AnalysisDiagnostic[],
): void {
  const reachable = new Set<string>();
  const queue = [...loopStarts];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      continue;
    }
    if (reachable.has(current)) continue;
    reachable.add(current);
    for (const next of adjacency.get(current) ?? []) {
      if (!reachable.has(next)) queue.push(next);
    }
  }

  // Also add router branch targets
  for (const node of nodes) {
    if (node.type === 'router') {
      for (const branch of node.branches) {
        if (reachable.has(node.id)) {
          reachable.add(branch.target);
          // BFS from branch target
          const bfsQueue = [branch.target];
          while (bfsQueue.length > 0) {
            const cur = bfsQueue.shift();
            if (cur === undefined) {
              continue;
            }
            for (const next of adjacency.get(cur) ?? []) {
              if (!reachable.has(next)) {
                reachable.add(next);
                bfsQueue.push(next);
              }
            }
          }
        }
      }
    }
  }

  for (const node of nodes) {
    if (!reachable.has(node.id)) {
      errors.push({
        rule: 'NO_ORPHAN_NODES',
        message: `Node "${node.id}" is not reachable from any LoopStart.`,
        nodeId: node.id,
      });
    }
  }
}

/** Warn if no path from LoopStart reaches LoopEnd without a user block */
function checkQuiescence(
  nodes: Node[],
  loopStarts: string[],
  adjacency: AdjacencyMap,
  loopEnds: string[],
  warnings: AnalysisDiagnostic[],
): void {
  if (loopEnds.length === 0) {
    warnings.push({
      rule: 'ROUND_TERMINATES',
      message: 'No LoopEnd node found. Graph may loop indefinitely.',
    });
    return;
  }

  const roundEndSet = new Set(loopEnds);
  // BFS from each round start, skip wait_for_user nodes
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  let canReachEnd = false;

  for (const start of loopStarts) {
    const visited = new Set<string>();
    const queue = [start];
    while (queue.length > 0) {
      const cur = queue.shift();
      if (cur === undefined) {
        continue;
      }
      if (visited.has(cur)) continue;
      visited.add(cur);
      if (roundEndSet.has(cur)) {
        canReachEnd = true;
        break;
      }
      const node = nodeMap.get(cur);
      // Skip user-blocking nodes
      if (node?.type === 'tool' && node.tool_type === 'wait_for_user') continue;
      for (const next of adjacency.get(cur) ?? []) {
        if (!visited.has(next)) queue.push(next);
      }
      // Also traverse router branches
      if (node?.type === 'router') {
        for (const branch of node.branches) {
          if (!visited.has(branch.target)) queue.push(branch.target);
        }
      }
    }
    if (canReachEnd) break;
  }

  if (!canReachEnd) {
    warnings.push({
      rule: 'ROUND_TERMINATES',
      message: 'No non-blocking path from LoopStart to LoopEnd found.',
    });
  }
}
