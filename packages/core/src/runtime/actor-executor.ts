import type { Actor } from '../schema/types.js';
import type { ExecutorContext } from './node-executor.js';

export class ActorExecutor {
  public async execute(actor: Actor, input: unknown, ctx: ExecutorContext): Promise<string | string[]> {
    const instances = actor.instances ?? 1;
    const model = actor.model ?? ctx.defaults.model ?? 'minimax/minimax-m1-m3';
    const temperature = actor.temperature ?? ctx.defaults.temperature;

    // Permissive regex for template injection — allows whitespace between braces
    const CHANNEL_RX = /\{\{\s*channel\s*:\s*(\w+)(?::(\d+))?\s*\}\}/g;
    let prompt = actor.prompt_template;
    for (const storeId of actor.subscribe) {
      const content = ctx.memory.read(storeId);
      prompt = prompt.replace(CHANNEL_RX, (match, id) => id === storeId ? content : match);
    }

    // Append input context if present
    if (input !== undefined && input !== null) {
      prompt += `\n\nInput from previous step:\n${stringifyUnknown(input)}`;
    }

    const executeOne = async (instanceIndex: number): Promise<string> => {
      try {
        const startTime = Date.now();
        ctx.eventBus.emit({
          type: 'actor.start',
          nodeId: actor.id,
          instanceIndex,
          prompt,
          timestamp: startTime,
        });

        const response = await ctx.scheduler.enqueue(async () => {
          return ctx.provider.complete({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature,
          });
        });

        const latencyMs = Date.now() - startTime;
        ctx.eventBus.emit({
          type: 'actor.complete',
          nodeId: actor.id,
          instanceIndex,
          output: response.content,
          latencyMs,
          tokenUsage: response.usage,
          model: response.model,
          finishReason: response.finishReason,
          toolCalls: response.toolCalls,
          timestamp: Date.now(),
        });

        // Publish to channel if configured
        if (actor.publish !== undefined && actor.publish !== '') {
          ctx.memory.write(actor.publish, response.content);
          const channel = ctx.memory.getStore(actor.publish);
          ctx.eventBus.emit({
            type: 'store.write',
            storeId: actor.publish,
            mode: channel?.writeMode ?? 'append',
            round: ctx.round,
            dataSizeBytes: response.content.length,
            timestamp: Date.now(),
          });
        }

        return response.content;
      } catch (err) {
        ctx.eventBus.emit({
          type: 'error',
          nodeId: actor.id,
          error: `Actor "${actor.id}"[${instanceIndex}] failed: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: Date.now(),
        });
        throw err;
      }
    };

    if (instances === 1) {
      return executeOne(0);
    }

    // Parallel instances
    const tasks = Array.from({ length: instances }, (_, i) => executeOne(i));
    return Promise.all(tasks);
  }
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  if (value === null || value === undefined) {
    return '';
  }

  return JSON.stringify(value);
}
