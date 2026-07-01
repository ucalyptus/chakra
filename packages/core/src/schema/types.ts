export interface Actor {
  type: 'actor';
  id: string;
  name: string;
  actor_type: 'llm' | 'agent';
  instances?: number;
  prompt_template: string;
  subscribe: string[];
  publish?: string;
  model?: string;
  tools?: string[];
  temperature?: number;
}

export interface Branch {
  label: string;
  condition?: string;
  target: string;
}

export interface Router {
  type: 'router';
  id: string;
  name: string;
  mode: 'llm_driven' | 'expression';
  branches: Branch[];
}

export type ToolType = 'wait_for_user' | 'emit_to_user' | 'store_write' | 'webhook' | 'log';

export interface Tool {
  type: 'tool';
  id: string;
  name: string;
  tool_type: ToolType;
  config: Record<string, unknown>;
}

export interface Join {
  type: 'join';
  id: string;
  name?: string;
  await_count: number | 'all';
  timeout_ms?: number;
  on_timeout?: 'proceed_partial' | 'fail';
  mode?: 'all' | 'any' | 'n_of_m';
}

export type WriteMode = 'append' | 'replace';

export interface Store {
  id: string;
  name: string;
  write_mode: WriteMode;
  max_entries?: number;
  max_tokens?: number;
  format?: 'raw' | 'structured';
  schema?: Record<string, unknown>;
  initial_value?: string;
  builtin?: boolean;
}

export interface LoopStart {
  type: 'loop_start';
  id: string;
}

export interface LoopEnd {
  type: 'loop_end';
  id: string;
  halt_condition?: string;
  max_iterations?: number;
}

export type EdgeType = 'control' | 'data' | 'store_inject' | 'store_write';

export interface Edge {
  from: string;
  to: string;
  type: EdgeType;
  label?: string;
}

export type Node = Actor | Router | Tool | Join | LoopStart | LoopEnd;
export type NodeType = Node['type'];
export type { Graph, GraphDefaults } from './graph.js';
