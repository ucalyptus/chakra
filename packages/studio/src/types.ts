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

/**
 * Goal and Gate are STUDIO-ONLY abstractions.
 *
 * The core schema (packages/core/src/schema/types.ts) has NO GoalNode
 * or GateNode type. These types exist only for the visual editor's
 * node palette and config panels.
 *
 * At export time (serializer.ts → graphToYAML), they are expanded into
 * core primitives:
 *   Goal → Actor (synthesized prompt_template from GoalConfig fields)
 *   Gate → Actor (judge) + Router (pass/revise branches)
 *
 * The YAML output carries round-trip metadata:
 *   # _chakra_node_type: goal | gate
 * and for goals the original fields (statement, definition_of_done,
 * verification_criteria) are emitted as structured YAML comments.
 */
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

/**
 * Gate is a STUDIO-ONLY abstraction (see GoalConfig docs).
 *
 * At export, Gate → Actor (judge) + Router (pass/revise branches).
 * The YAML output carries # _chakra_node_type: gate metadata.
 */
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
  pass_target?: string;
  revise_target?: string;
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
