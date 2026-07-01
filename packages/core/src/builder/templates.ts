import type { Graph } from '../schema/types.js';
import { GraphBuilder } from './graph-builder.js';

/**
 * Pre-built program templates for common cognitive patterns.
 */

/** Deep reasoning template — mirrors the reference diagram from PLAN.md */
export function deepReasonerTemplate(opts?: { model?: string }): Graph {
  return new GraphBuilder('deep-reasoner')
    .defaults({ model: opts?.model ?? 'claude-sonnet-4-6', temperature: 0.7 })
    .store('private_notes', { mode: 'append' })
    .store('working_ledger', { mode: 'replace' })
    .roundStart('rs1')
    .actor('orchestrator', {
      type: 'llm',
      subscribe: ['transcript', 'private_notes', 'working_ledger'],
      publish: 'private_notes',
      prompt: `You are the orchestrator of a deep reasoning process.

Review the conversation, your private notes, and the working ledger.
Decide your next move:
- "LLM reasoning" — delegate to the problem solver for deeper thinking
- "workspace" — delegate to the codex worker for code execution
- "ask and wait" — ask the user a clarifying question

End your response with <decision>your router</decision>

Private notes: {{channel:private_notes}}
Working ledger: {{channel:working_ledger}}
Conversation: {{channel:transcript}}`,
    })
    .router('choose_move', {
      mode: 'llm_driven',
      branches: {
        'LLM reasoning': 'problem_solver',
        'workspace': 'codex_worker',
        'ask and wait': 'wait_for_user',
      },
    })
    .actor('problem_solver', {
      type: 'llm',
      subscribe: ['working_ledger', 'transcript'],
      publish: 'working_ledger',
      prompt: `You are a problem solver. Analyze the current state and provide detailed reasoning.

Working ledger: {{channel:working_ledger}}
Conversation: {{channel:transcript}}

Think step by step and update the working ledger with your findings.`,
      after: 'choose_move',
    })
    .actor('codex_worker', {
      type: 'agent',
      subscribe: ['working_ledger'],
      publish: 'working_ledger',
      tools: ['execute_code', 'read_file', 'write_file'],
      prompt: `You are a code execution agent. Use your tools to solve the task described in the working ledger.

Working ledger: {{channel:working_ledger}}`,
      after: 'choose_move',
    })
    .effect('wait_for_user', {
      effectType: 'wait_for_user',
      after: 'choose_move',
    })
    .effect('emit_response', {
      effectType: 'emit_to_user',
      after: 'problem_solver',
    })
    .edge('codex_worker', 'emit_response')
    .edge('wait_for_user', 'emit_response')
    .roundEnd('re1', { after: 'emit_response' })
    .build();
}

/** Research template — parallel hypothesis generation with verification */
export function researchTemplate(opts?: { model?: string; topic?: string }): Graph {
  return new GraphBuilder('researcher')
    .defaults({ model: opts?.model, temperature: 0.8 })
    .store('hypotheses', { mode: 'append' })
    .store('findings', { mode: 'append' })
    .roundStart('rs')
    .actor('hypothesis_gen', {
      type: 'llm',
      instances: 3,
      subscribe: ['transcript', 'findings'],
      publish: 'hypotheses',
      prompt: `Generate a hypothesis about: ${opts?.topic ?? '{{channel:transcript}}'}
      
Previous findings: {{channel:findings}}

Be creative and propose a novel angle.`,
    })
    .awaitAll('hyp_sync', { count: 3, after: 'hypothesis_gen' })
    .actor('verifier', {
      type: 'llm',
      subscribe: ['hypotheses', 'findings'],
      publish: 'findings',
      prompt: `Review these hypotheses and verify which are supported by evidence.

Hypotheses: {{channel:hypotheses}}
Previous findings: {{channel:findings}}

Rate each hypothesis and synthesize findings.`,
      after: 'hyp_sync',
    })
    .effect('emit', { effectType: 'emit_to_user', after: 'verifier' })
    .roundEnd('re', { after: 'emit', maxIterations: 5 })
    .build();
}

/** Simple chatbot template */
export function chatbotTemplate(opts?: { model?: string; systemPrompt?: string }): Graph {
  return new GraphBuilder('chatbot')
    .defaults({ model: opts?.model, maxIterations: 100 })
    .roundStart('rs')
    .actor('responder', {
      type: 'llm',
      subscribe: ['transcript'],
      prompt: opts?.systemPrompt ?? `You are a helpful assistant. Respond to the user's latest message.

Conversation: {{channel:transcript}}`,
    })
    .effect('emit', { effectType: 'emit_to_user' })
    .effect('wait', { effectType: 'wait_for_user' })
    .roundEnd('re')
    .build();
}

// ---------------------------------------------------------------------------
// Looper template — "Flavor 2" pattern
//
//   Goal (seeded store)
//     -> Implementer actor(s) [parallel, actor_type: agent]
//     -> Join (mode: all) to collect outputs
//     -> Collator actor [synthesises one packet]
//     -> Gate (judge + router with pass/revise branches)
//          pass  -> emit_to_user -> loop_end
//          revise -> loop_end   (round restarts)
//   loop_end with configurable max_iterations
// ---------------------------------------------------------------------------

export interface LooperTemplateOpts {
  /** The overarching goal statement */
  goalStatement?: string;
  /** Definition of done for the goal */
  definitionOfDone?: string;
  /** Verification criteria the gate uses to decide pass/revise */
  verificationCriteria?: string[];
  /** Model for implementer actors (agent type). Default: 'deepseek/deepseek-chat' */
  implementerModel?: string;
  /** Model for the collator actor. Default: 'openrouter/minimax-m3' */
  collatorModel?: string;
  /** Model for the gate (verifier judge). Default: same as collatorModel */
  verifierModel?: string;
  /** Max loop iterations (stop condition). Default: 3 */
  maxIterations?: number;
  /** Number of parallel implementer instances. Default: 2 */
  implementerCount?: number;
  /** Base name for the program. Default: 'looper' */
  name?: string;
}

const DEFAULT_GOAL_STATEMENT = 'Solve the requested task completely and correctly.';
const DEFAULT_DOD = 'The output satisfies all stated requirements with clear, verifiable evidence.';

export function looperTemplate(opts?: LooperTemplateOpts): Graph {
  const goalStatement = opts?.goalStatement ?? DEFAULT_GOAL_STATEMENT;
  const definitionOfDone = opts?.definitionOfDone ?? DEFAULT_DOD;
  const verificationCriteria = opts?.verificationCriteria ?? [
    'All requested issues are closed or outcomes are satisfied.',
    'The artifact works and contains no obvious errors or slop.',
    'Lint, type check, and tests pass on the produced artifact.',
  ];
  const implementerModel = opts?.implementerModel ?? 'deepseek/deepseek-chat';
  const collatorModel = opts?.collatorModel ?? 'openrouter/minimax-m3';
  const verifierModel = opts?.verifierModel ?? collatorModel;
  const maxIterations = opts?.maxIterations ?? 3;
  const implementerCount = opts?.implementerCount ?? 2;
  const name = opts?.name ?? 'looper';

  const builder = new GraphBuilder(name)
    .defaults({ model: implementerModel, maxIterations })
    .goal('goal', {
      statement: goalStatement,
      definition_of_done: definitionOfDone,
      verification_criteria: verificationCriteria,
    })
    // The gate publishes its verdict here, not back into the 'goal' store —
    // 'goal' has write_mode: 'replace' and is seeded once at construction
    // (StoreManager never re-applies initial_value), so publishing the
    // verdict there would silently overwrite the original goal statement
    // with the previous round's judgment on every revise.
    .store('verdict', { mode: 'replace' })
    .roundStart('rs');

  // Parallel implementer agents — all start from loop_start
  for (let i = 0; i < implementerCount; i++) {
    builder.actor(`implementer_${i}`, {
      type: 'agent',
      subscribe: ['transcript'],
      prompt: `You are implementer ${i + 1} in a looper team. Your goal is to produce working output that satisfies the delivery goal.

Produce the best implementation or solution you can. Use your tools to write code, create files, or perform research as needed.`,
      instances: 1,
      model: implementerModel,
      tools: [],
      after: 'rs',
    });
    // Wire the goal's store into this actor's subscribe + prompt
    builder.goalInjectTo('goal', `implementer_${i}`);
  }

  // Join — wait for all implementers to finish
  builder.awaitAll('join', {
    count: 'all',
    after: `implementer_${implementerCount - 1}`,
  });
  // Wire remaining implementers to join
  for (let i = 0; i < implementerCount; i++) {
    if (i < implementerCount - 1) {
      builder.edge(`implementer_${i}`, 'join');
    }
  }

  // Collator — synthesises all implementer outputs into one coherent packet
  builder.actor('collator', {
    type: 'llm',
    subscribe: ['goal'],
    prompt: `You are a collator. Multiple parallel implementers have produced outputs.

Goal context: {{channel:goal}}

Synthesize their work into a single coherent output. Resolve any conflicts, merge the best parts, and produce one unified deliverable.`,
    model: collatorModel,
    after: 'join',
  });

  // Gate (verifier judge + router) — checks if the work is done
  builder.gate('gate', {
    name: 'Verifier Gate',
    gate_kind: 'delivery',
    statement: goalStatement,
    definition_of_done: definitionOfDone,
    verification_criteria: verificationCriteria,
    publish: 'verdict',
    model: verifierModel,
    temperature: 0.3,
    subscribe: ['goal'],
    // pass: emit result to user then end the round
    pass_target: 'emit_result',
    // revise: restart the round via loop_end (which triggers next iteration)
    revise_target: 're',
    after: 'collator',
  });

  // Emit result on pass — chains from gate__router (lastNodeId)
  builder.effect('emit_result', {
    effectType: 'emit_to_user',
  });

  // Router needs explicit graph edges to both branch targets so the
  // graph validator can see these nodes as reachable from loop_start.
  builder.edge('gate__router', 're');

  // Round end with configurable max iterations
  builder.roundEnd('re', { after: 'emit_result', maxIterations });

  return builder.build();
}
