import type { CompiledGraph, CompiledNode } from '../compiler/ir.js';
import type { Edge } from '../schema/types.js';

/**
 * Render a compiled program graph as Mermaid diagram syntax.
 */
export function renderMermaid(program: CompiledGraph): string {
  const lines: string[] = ['graph TD'];

  // Render nodes
  for (const [id, node] of program.nodes) {
    const label = getNodeLabel(node);
    const shape = getNodeShape(node);
    lines.push(`  ${id}${shape[0]}${label}${shape[1]}`);
  }

  // Render edges
  for (const [fromId, edges] of program.edges) {
    for (const edge of edges) {
      const style = getEdgeStyle(edge);
      const label = edge.label !== undefined && edge.label !== '' ? `|${edge.label}|` : '';
      lines.push(`  ${fromId} ${style[0]}${label}${style[1]} ${edge.to}`);
    }
  }

  // Render router branches (not in edges map)
  for (const [id, node] of program.nodes) {
    if (node.type === 'router' && node.config.type === 'router') {
      for (const branch of node.config.branches) {
        lines.push(`  ${id} -->|${branch.label}| ${branch.target}`);
      }
    }
  }

  // Style classes
  lines.push('');
  lines.push('  classDef actor fill:#4a9eff,stroke:#2171c9,color:white');
  lines.push('  classDef router fill:#ffa94d,stroke:#e67700,color:white');
  lines.push('  classDef effect fill:#69db7c,stroke:#37b24d,color:white');
  lines.push('  classDef boundary fill:#868e96,stroke:#495057,color:white');
  lines.push('  classDef await fill:#da77f2,stroke:#ae3ec9,color:white');

  // Apply classes
  for (const [id, node] of program.nodes) {
    const cls = getNodeClass(node);
    if (cls !== '') {
      lines.push(`  class ${id} ${cls}`);
    }
  }

  return lines.join('\n');
}

/**
 * Render as DOT (Graphviz) format.
 */
export function renderDot(program: CompiledGraph): string {
  const lines: string[] = [
    'digraph program {',
    '  rankdir=TB;',
    '  node [fontname="Inter", fontsize=11];',
    '  edge [fontname="Inter", fontsize=9];',
    '',
  ];

  // Nodes
  for (const [id, node] of program.nodes) {
    const label = getNodeLabel(node);
    const attrs = getDotNodeAttrs(node);
    lines.push(`  "${id}" [label="${label}"${attrs}];`);
  }

  lines.push('');

  // Edges
  for (const [fromId, edges] of program.edges) {
    for (const edge of edges) {
      const label = edge.label !== undefined && edge.label !== '' ? ` [label="${edge.label}"]` : '';
      const style = edge.type === 'store_inject' || edge.type === 'store_write' ? ' [style=dashed]' : '';
      lines.push(`  "${fromId}" -> "${edge.to}"${label}${style};`);
    }
  }

  // Router branches
  for (const [id, node] of program.nodes) {
    if (node.type === 'router' && node.config.type === 'router') {
      for (const branch of node.config.branches) {
        lines.push(`  "${id}" -> "${branch.target}" [label="${branch.label}"];`);
      }
    }
  }

  lines.push('}');
  return lines.join('\n');
}

function getNodeLabel(node: CompiledNode): string {
  if ('name' in node.config && typeof node.config.name === 'string') {
    return node.config.name;
  }
  return node.id;
}

function getNodeShape(node: CompiledNode): [string, string] {
  switch (node.type) {
    case 'loop_start':
    case 'loop_end':
      return ['([', '])'];
    case 'router':
      return ['{', '}'];
    case 'join':
      return ['[[', ']]'];
    case 'tool':
      return ['[/', '/]'];
    case 'actor':
      return ['[', ']'];
  }
}

function getEdgeStyle(edge: Edge): [string, string] {
  switch (edge.type) {
    case 'data':
      return ['==>', ''];
    case 'store_inject':
    case 'store_write':
      return ['-.->', ''];
    case 'control':
      return ['-->', ''];
  }
}

function getNodeClass(node: CompiledNode): string {
  switch (node.type) {
    case 'actor': return 'actor';
    case 'router': return 'router';
    case 'tool': return 'effect';
    case 'loop_start':
    case 'loop_end': return 'boundary';
    case 'join': return 'await';
    default: return '';
  }
}

function getDotNodeAttrs(node: CompiledNode): string {
  switch (node.type) {
    case 'actor': return ', shape=box, style=filled, fillcolor="#4a9eff", fontcolor=white';
    case 'router': return ', shape=diamond, style=filled, fillcolor="#ffa94d", fontcolor=white';
    case 'tool': return ', shape=parallelogram, style=filled, fillcolor="#69db7c"';
    case 'loop_start':
    case 'loop_end': return ', shape=ellipse, style=filled, fillcolor="#868e96", fontcolor=white';
    case 'join': return ', shape=doubleoctagon, style=filled, fillcolor="#da77f2", fontcolor=white';
    default: return '';
  }
}
