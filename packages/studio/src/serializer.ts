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

function yamlQuote(value: string): string {
  return JSON.stringify(value);
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

function getOutgoingTargets(nodeId: string, edges: Edge[]): string[] {
  return edges
    .filter(edge => edge.source === nodeId)
    .map(edge => edge.target);
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
    lines.push(`    - id: ${ch}`);
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
        if (cfg.subscribe?.length) lines.push(`      subscribe: [${cfg.subscribe.join(', ')}]`);
        if (cfg.publish) lines.push(`      publish: ${cfg.publish}`);
        if (cfg.prompt_template) {
          writePromptBlock(lines, cfg.prompt_template);
        }
        break;
      }
      case 'goal': {
        const cfg = d.config as GoalConfig;
        lines.push('    - type: actor');
        lines.push(`      id: ${id}`);
        lines.push(`      name: ${yamlQuote(cfg.name || id)}`);
        lines.push('      actor_type: llm');
        if (cfg.model) lines.push(`      model: ${yamlQuote(cfg.model)}`);
        if (cfg.temperature != null) lines.push(`      temperature: ${cfg.temperature}`);
        if (cfg.subscribe?.length) lines.push(`      subscribe: [${cfg.subscribe.join(', ')}]`);
        if (cfg.publish) lines.push(`      publish: ${cfg.publish}`);
        writePromptBlock(lines, buildGoalPrompt(cfg));
        break;
      }
      case 'gate': {
        const cfg = d.config as GateConfig;
        const judgeId = `${id}__judge`;
        const routerId = `${id}__router`;
        const inferredTargets = getOutgoingTargets(id, edges);
        const passTarget = cfg.pass_target || inferredTargets[0] || '';
        const reviseTarget = cfg.revise_target || inferredTargets[1] || '';

        lines.push('    - type: actor');
        lines.push(`      id: ${judgeId}`);
        lines.push(`      name: ${yamlQuote(cfg.name || `${id} judge`)}`);
        lines.push('      actor_type: llm');
        if (cfg.model) lines.push(`      model: ${yamlQuote(cfg.model)}`);
        if (cfg.temperature != null) lines.push(`      temperature: ${cfg.temperature}`);
        if (cfg.subscribe?.length) lines.push(`      subscribe: [${cfg.subscribe.join(', ')}]`);
        if (cfg.publish) lines.push(`      publish: ${cfg.publish}`);
        writePromptBlock(lines, buildGatePrompt(cfg));

        lines.push('    - type: router');
        lines.push(`      id: ${routerId}`);
        lines.push(`      name: ${yamlQuote(cfg.name ? `${cfg.name} Router` : `${id} router`)}`);
        lines.push('      mode: llm_driven');
        lines.push('      branches:');
        lines.push('        - label: pass');
        lines.push(`          target: ${passTarget}`);
        lines.push('        - label: revise');
        lines.push(`          target: ${reviseTarget}`);
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
          lines.push(`        - label: ${branch.label}`);
          lines.push(`          target: ${branch.target}`);
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

    const to = targetNode?.data.chakraType === 'gate'
      ? `${edge.target}__judge`
      : edge.target;

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
