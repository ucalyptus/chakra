export type ChakraNodeType = 'loop_start' | 'loop_end' | 'actor' | 'router' | 'tool' | 'goal' | 'gate';

export interface ActorConfig {
  name: string;
  model: string;
  prompt_template: string;
  subscribe: string[];
  publish: string;
  temperature: number;
}

export interface RouterConfig {
  name: string;
  mode: 'llm_driven' | 'expression';
  branches: Array<{ label: string; target: string }>;
}

export interface ToolConfig {
  name: string;
  tool_type: 'wait_for_user' | 'emit_to_user' | 'store_write' | 'webhook' | 'log';
}

export interface LoopEndConfig {
  max_iterations: number;
}

export interface LoopStartConfig {
  name?: string;
}

export interface GoalConfig {
  name: string;
  statement: string;
  definition_of_done: string;
  verification_criteria: string[];
  subscribe: string[];
  publish: string;
  model: string;
  temperature: number;
}

export interface GateConfig {
  name: string;
  gate_kind: 'plan' | 'delivery';
  statement: string;
  definition_of_done: string;
  verification_criteria: string[];
  subscribe: string[];
  publish: string;
  model: string;
  temperature: number;
  pass_target: string;
  revise_target: string;
}

export type ChakraConfig =
  | ActorConfig
  | RouterConfig
  | ToolConfig
  | LoopEndConfig
  | LoopStartConfig
  | GoalConfig
  | GateConfig;

export interface ChakraNodeData extends Record<string, unknown> {
  chakraType: ChakraNodeType;
  config: ChakraConfig;
  label: string;
}

export interface RunResult {
  response: string;
  rounds: number;
  error?: string;
}
