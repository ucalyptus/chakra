import type { Tool } from '../schema/types.js';
import type { ExecutorContext } from './node-executor.js';

export class EffectExecutor {
  public async execute(effect: Tool, input: unknown, ctx: ExecutorContext): Promise<unknown> {
    switch (effect.tool_type) {
      case 'wait_for_user': {
        const startTime = Date.now();
        const userInput = await ctx.io.waitForInput();
        ctx.eventBus.emit({
          type: 'user.input',
          message: userInput,
          waitDurationMs: Date.now() - startTime,
          timestamp: Date.now(),
        });
        // Write to transcript if available
        if (ctx.memory.getStore('transcript')) {
          ctx.memory.write('transcript', `User: ${userInput}`);
        }
        return userInput;
      }

      case 'emit_to_user': {
        const message = stringifyUnknown(input ?? getConfigValue(effect.config, 'message') ?? '');
        await ctx.io.emit(message);
        ctx.eventBus.emit({
          type: 'user.output',
          message,
          timestamp: Date.now(),
        });
        if (ctx.memory.getStore('transcript')) {
          ctx.memory.write('transcript', `Assistant: ${message}`);
        }
        return message;
      }

      case 'store_write': {
        const storeId = getConfigString(effect.config, 'channel');
        const data = stringifyUnknown(getConfigValue(effect.config, 'data') ?? input ?? '');
        if (storeId !== undefined && storeId !== '') {
          ctx.memory.write(storeId, data);
          ctx.eventBus.emit({
            type: 'store.write',
            storeId,
            mode: ctx.memory.getStore(storeId)?.writeMode ?? 'append',
            round: ctx.round,
            dataSizeBytes: data.length,
            timestamp: Date.now(),
          });
        }
        return data;
      }

      case 'webhook': {
        const url = getConfigString(effect.config, 'url');
        const method = getConfigString(effect.config, 'method') ?? 'POST';
        const body = getConfigValue(effect.config, 'body') ?? input;
        if (url !== undefined && url !== '') {
          const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          return { status: response.status, body: await response.text() };
        }
        return input;
      }

      case 'log': {
        ctx.eventBus.emit({
          type: 'user.output',
          message: `[LOG] ${stringifyUnknown(input)}`,
          timestamp: Date.now(),
        });
        return input;
      }
    }
  }
}

function getConfigValue(config: Record<string, unknown>, key: string): unknown {
  return config[key];
}

function getConfigString(config: Record<string, unknown>, key: string): string | undefined {
  const value = getConfigValue(config, key);
  return typeof value === 'string' ? value : undefined;
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
