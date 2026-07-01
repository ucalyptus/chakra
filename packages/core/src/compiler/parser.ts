import type { Graph, GraphDefaults, Store, Node, Edge } from '../schema/types.js';
import YAML from 'yaml';

export function parseGraph(source: string, format: 'json' | 'yaml' = 'json'): Graph {
  let raw: unknown;

  if (format === 'yaml') {
    raw = YAML.parse(source);
  } else {
    raw = JSON.parse(source);
  }

  // Handle both wrapped { program: {...} } and flat format
  const prog = getGraphRecord(raw);

  return {
    name: getString(prog.name) ?? 'unnamed',
    version: getString(prog.version),
    defaults: parseDefaults(prog.defaults),
    stores: parseArray(prog.stores, isStore),
    nodes: parseArray(prog.nodes, isNode),
    edges: parseArray(prog.edges, isEdge),
  };
}

function getGraphRecord(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) {
    return {};
  }

  if (isRecord(raw.program)) {
    return raw.program;
  }

  return raw;
}

function parseDefaults(value: unknown): GraphDefaults | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    model: getString(value.model),
    temperature: getNumber(value.temperature),
    max_iterations: getNumber(value.max_iterations),
  };
}

function parseArray<T>(value: unknown, guard: (item: unknown) => item is T): T[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(guard);
}

function isStore(value: unknown): value is Store {
  if (!isRecord(value)) {
    return false;
  }

  return getString(value.id) !== undefined
    && getString(value.name) !== undefined
    && (value.write_mode === 'append' || value.write_mode === 'replace');
}

function isNode(value: unknown): value is Node {
  if (!isRecord(value)) {
    return false;
  }

  return value.type === 'actor'
    || value.type === 'router'
    || value.type === 'tool'
    || value.type === 'join'
    || value.type === 'loop_start'
    || value.type === 'loop_end';
}

function isEdge(value: unknown): value is Edge {
  if (!isRecord(value)) {
    return false;
  }

  return getString(value.from) !== undefined
    && getString(value.to) !== undefined
    && (value.type === 'control'
      || value.type === 'data'
      || value.type === 'store_inject'
      || value.type === 'store_write');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
