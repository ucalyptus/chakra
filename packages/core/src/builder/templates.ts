import type { Graph } from '../schema/types.js';
import { GraphBuilder } from './graph-builder.js';

/**
 * Pre-built program templates for common cognitive patterns.
 */

/** Deep reasoning template — mirrors the reference diagram from PLAN.md */
export function deepReasonerTemplate(opts?: { model?: string }): Graph {
  return new GraphBuilder('deep-reasoner')
    .defaults({ model: opts?.model ?? 'claude-sonnet-4-6', temperature: 0.7 })
    .channel('private_notes', { mode: 'append' })
    .channel('working_ledger', { mode: 'replace' })
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
    .roundEnd('re1', { after: 'emit_response' })
    .build();
}

/** Research template — parallel hypothesis generation with verification */
export function researchTemplate(opts?: { model?: string; topic?: string }): Graph {
  return new GraphBuilder('researcher')
    .defaults({ model: opts?.model, temperature: 0.8 })
    .channel('hypotheses', { mode: 'append' })
    .channel('findings', { mode: 'append' })
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
