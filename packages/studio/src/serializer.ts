import type { Node, Edge } from '@xyflow/react';
import type {
  ChakraNodeData,
  ActorConfig,
  RouterConfig,
  ToolConfig,
  LoopEndConfig,
  GoalConfig,
  GateConfig,
} from './types';

/**
 * GOAL / GATE EXPANSION SEMANTICS
 *
 * Goal and Gate are STUDIO-ONLY abstractions. They exist only in the
 * visual editor's node palette and config panels. The core schema
 * (packages/core/src/schema/types.ts) has NO GoalNode or GateNode type —
 * the Node union is Actor | Router | Tool | Join | LoopStart | LoopEnd.
 *
 * At export (serializer.ts), the Studio expands them into core primitives:
 *
 *   Goal (1 node) → Actor (1 node)
 *     └─ The prompt_template is synthesized from GoalConfig fields
 *        (statement, definition_of_done, verification_criteria) via
 *        buildGoalPrompt(). Those fields are preserved as YAML comments
 *        for round-trip fidelity.
 *
 *   Gate (1 node) → Actor (1 node, ${id}__judge) + Router (1 node, ${id}__router)
 *     └─ The judge actor runs the gate prompt and emits a <decision>pass</decision>
 *        or <decision>revise</decision> verdict. The router parses that tag and
 *        branches to the appropriate target.
 *     └─ All edges targeting the gate are redirected to ${id}__judge.
 *        The original gate node's edges are suppressed; a data edge carries
 *        the judge's output to the router.
 *
 * Round-trip metadata: every expanded node carries a YAML comment
 *   # _chakra_node_type: original_chakra_type
 * so that YAML files can be re-parsed back into their studio types.
 * Goal fields (statement, definition_of_done, verification_criteria)
 * are written as structured YAML comments immediately preceding the
 * expanded actor node.
 */

function yamlQuote(value: string): string {
  return JSON.stringify(value);
}

function yamlInlineSequence(values: string[]): string {
  return `[${values.map(yamlQuote).join(', ')}]`;
}

function buildGoalPrompt(cfg: GoalConfig): string {
  const criteria = cfg.verification_criteria.length > 0
    ? cfg.verification_criteria.map((criterion, index) => `${index + 1}. ${criterion}`).join('\n')
    : '1. Produce a response that directly satisfies the requested goal.';

  return [
    'You are the primary delivery actor for this goal.',
    '',
    `Goal statement:\n${cfg.statement}`,
    '',
    `Definition of done:\n${cfg.definition_of_done}`,
    '',
    `Verification criteria:\n${criteria}`,
    '',
    'Use the subscribed channels as context. Produce the best next output that moves the work to done.',
  ].join('\n');
}

function buildGatePrompt(cfg: GateConfig): string {
  const criteria = cfg.verification_criteria.length > 0
    ? cfg.verification_criteria.map((criterion, index) => `${index + 1}. ${criterion}`).join('\n')
    : '1. Confirm the output satisfies the requested work.';

  return [
    `You are a ${cfg.gate_kind} gate.`,
    '',
    `Review target:\n${cfg.statement}`,
    '',
    `Definition of done:\n${cfg.definition_of_done}`,
    '',
    `Verification criteria:\n${criteria}`,
    '',
    'Return a concise verdict and rationale.',
    'If the work is ready, include <decision>pass</decision>.',
    'If the work needs more work, include <decision>revise</decision>.',
    'Never emit any other decision label.',
  ].join('\n');
}

function getOutgoingTargets(nodeId: string, nodes: Node<ChakraNodeData>[], edges: Edge[]): string[] {
  return edges
    .filter(edge => edge.source === nodeId)
    .map((edge) => translateTargetId(edge.target, nodes.find(node => node.id === edge.target)?.data));
}

function translateTargetId(targetId: string, targetData?: ChakraNodeData): string {
  return targetData?.chakraType === 'gate' ? `${targetId}__judge` : targetId;
}

function requireGateTarget(nodeId: string, branch: 'pass' | 'revise', target: string): string {
  if (target.trim() === '') {
    throw new Error(`Gate "${nodeId}" is missing its ${branch} target. Connect both branches or set explicit targets before export.`);
  }
  return target;
}

function writePromptBlock(lines: string[], prompt: string): void {
  lines.push('      prompt_template: |');
  for (const line of prompt.split('\n')) {
    lines.push(`        ${line}`);
  }
}

export function graphToYAML(nodes: Node<ChakraNodeData>[], edges: Edge[]): string {
  const lines: string[] = ['program:'];
  lines.push('  name: "visual-program"');
  lines.push('  version: "1.0"');
  lines.push('  defaults:');
  lines.push('    model: "minimax/minimax-m3"');
  lines.push('    temperature: 0.7');
  lines.push('    max_iterations: 10');
  lines.push('');

  const channels = new Set<string>();
  channels.add('transcript');

  for (const node of nodes) {
    if (node.data.chakraType === 'actor') {
      const cfg = node.data.config as ActorConfig;
      cfg.subscribe?.forEach(ch => channels.add(ch));
      if (cfg.publish) channels.add(cfg.publish);
    }

    if (node.data.chakraType === 'goal') {
      const cfg = node.data.config as GoalConfig;
      cfg.subscribe?.forEach(ch => channels.add(ch));
      if (cfg.publish) channels.add(cfg.publish);
    }

    if (node.data.chakraType === 'gate') {
      const cfg = node.data.config as GateConfig;
      cfg.subscribe?.forEach(ch => channels.add(ch));
      if (cfg.publish) channels.add(cfg.publish);
    }
  }

  lines.push('  stores:');
  for (const ch of Array.from(channels)) {
    lines.push(`    - id: ${yamlQuote(ch)}`);
    lines.push(`      name: ${yamlQuote(ch)}`);
    lines.push('      write_mode: append');
    if (ch === 'transcript') lines.push('      builtin: true');
  }
  lines.push('');

  lines.push('  nodes:');
  for (const node of nodes) {
    const d = node.data;
    const id = node.id;

    switch (d.chakraType) {
      case 'loop_start':
        lines.push('    - type: loop_start');
        lines.push(`      id: ${id}`);
        break;
      case 'loop_end': {
        const cfg = d.config as LoopEndConfig;
        lines.push('    - type: loop_end');
        lines.push(`      id: ${id}`);
        lines.push(`      max_iterations: ${cfg.max_iterations ?? 1}`);
        break;
      }
      case 'actor': {
        const cfg = d.config as ActorConfig;
        lines.push('    - type: actor');
        lines.push(`      id: ${id}`);
        lines.push(`      name: ${yamlQuote(cfg.name || id)}`);
        lines.push('      actor_type: llm');
        if (cfg.model) lines.push(`      model: ${yamlQuote(cfg.model)}`);
        if (cfg.temperature != null) lines.push(`      temperature: ${cfg.temperature}`);
        if (cfg.subscribe?.length) lines.push(`      subscribe: ${yamlInlineSequence(cfg.subscribe)}`);
        if (cfg.publish) lines.push(`      publish: ${yamlQuote(cfg.publish)}`);
        if (cfg.prompt_template) {
          writePromptBlock(lines, cfg.prompt_template);
        }
        break;
      }
      case 'goal': {
        const cfg = d.config as GoalConfig;
        lines.push('    # _chakra_node_type: goal');
        lines.push(`    # Goal fields — statement, definition_of_done, verification_criteria`);
        lines.push(`    #   statement: ${yamlQuote(cfg.statement)}`);
        lines.push(`    #   definition_of_done: ${yamlQuote(cfg.definition_of_done)}`);
        for (const criterion of cfg.verification_criteria) {
          lines.push(`    #   verification_criteria: ${yamlQuote(criterion)}`);
        }
        lines.push('    - type: actor');
        lines.push(`      id: ${id}`);
        lines.push(`      name: ${yamlQuote(cfg.name || id)}`);
        lines.push('      actor_type: llm');
        if (cfg.model) lines.push(`      model: ${yamlQuote(cfg.model)}`);
        if (cfg.temperature != null) lines.push(`      temperature: ${cfg.temperature}`);
        if (cfg.subscribe?.length) lines.push(`      subscribe: ${yamlInlineSequence(cfg.subscribe)}`);
        if (cfg.publish) lines.push(`      publish: ${yamlQuote(cfg.publish)}`);
        writePromptBlock(lines, buildGoalPrompt(cfg));
        break;
      }
      case 'gate': {
        const cfg = d.config as GateConfig;
        const judgeId = `${id}__judge`;
        const routerId = `${id}__router`;
        const inferredTargets = getOutgoingTargets(id, nodes, edges);
        const passTarget = requireGateTarget(id, 'pass', cfg.pass_target || inferredTargets[0] || '');
        const reviseTarget = requireGateTarget(id, 'revise', cfg.revise_target || inferredTargets[1] || '');

        lines.push('    # _chakra_node_type: gate');
        lines.push('    - type: actor');
        lines.push(`      id: ${judgeId}`);
        lines.push(`      name: ${yamlQuote(cfg.name || `${id} judge`)}`);
        lines.push('      actor_type: llm');
        if (cfg.model) lines.push(`      model: ${yamlQuote(cfg.model)}`);
        if (cfg.temperature != null) lines.push(`      temperature: ${cfg.temperature}`);
        if (cfg.subscribe?.length) lines.push(`      subscribe: ${yamlInlineSequence(cfg.subscribe)}`);
        if (cfg.publish) lines.push(`      publish: ${yamlQuote(cfg.publish)}`);
        writePromptBlock(lines, buildGatePrompt(cfg));

        lines.push('    - type: router');
        lines.push(`      id: ${routerId}`);
        lines.push(`      name: ${yamlQuote(cfg.name ? `${cfg.name} Router` : `${id} router`)}`);
        lines.push('      mode: llm_driven');
        lines.push('      branches:');
        lines.push(`        - label: ${yamlQuote('pass')}`);
        lines.push(`          target: ${yamlQuote(passTarget)}`);
        lines.push(`        - label: ${yamlQuote('revise')}`);
        lines.push(`          target: ${yamlQuote(reviseTarget)}`);
        break;
      }
      case 'router': {
        const cfg = d.config as RouterConfig;
        lines.push('    - type: router');
        lines.push(`      id: ${id}`);
        lines.push(`      name: ${yamlQuote(cfg.name || id)}`);
        lines.push(`      mode: ${cfg.mode ?? 'llm_driven'}`);
        lines.push('      branches:');
        for (const branch of cfg.branches ?? []) {
          lines.push(`        - label: ${yamlQuote(branch.label)}`);
          lines.push(`          target: ${yamlQuote(branch.target)}`);
        }
        break;
      }
      case 'tool': {
        const cfg = d.config as ToolConfig;
        lines.push('    - type: tool');
        lines.push(`      id: ${id}`);
        lines.push(`      name: ${yamlQuote(cfg.name || id)}`);
        lines.push(`      tool_type: ${cfg.tool_type ?? 'emit_to_user'}`);
        lines.push('      config: {}');
        break;
      }
    }
  }

  lines.push('');
  lines.push('  edges:');
  for (const edge of edges) {
    const sourceNode = nodes.find(node => node.id === edge.source);
    const targetNode = nodes.find(node => node.id === edge.target);
    const edgeType = edge.data?.edgeType ?? 'control';

    if (sourceNode?.data.chakraType === 'gate') {
      continue;
    }

    const from = edge.source;

    const to = translateTargetId(edge.target, targetNode?.data);

    lines.push(`    - from: ${from}`);
    lines.push(`      to: ${to}`);
    lines.push(`      type: ${edgeType}`);
  }

  for (const node of nodes) {
    if (node.data.chakraType === 'gate') {
      lines.push(`    - from: ${node.id}__judge`);
      lines.push(`      to: ${node.id}__router`);
      lines.push('      type: data');
    }
  }

  return lines.join('\n');
}
