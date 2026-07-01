import type { CompiledNode } from '../compiler/ir.js';
import type { Actor, Router, Join, Tool, LoopEnd } from '../schema/types.js';
import { ActorExecutor } from './actor-executor.js';
import { RouterExecutor } from './router-executor.js';
import { AwaitExecutor } from './join-executor.js';
import { EffectExecutor } from './tool-executor.js';
import type { ConcurrencyScheduler } from './scheduler.js';
import type { StoreManager } from '../memory/store-manager.js';
import type { EventBus } from '../events/bus.js';
import type { LLMProvider, UserIOBridge } from './runner.js';

export interface ExecutorContext {
  provider: LLMProvider;
  io: UserIOBridge;
  memory: StoreManager;
  eventBus: EventBus;
  scheduler: ConcurrencyScheduler;
  round: number;
  defaults: { model?: string; temperature?: number };
  activate: (nodeId: string, input: unknown) => Promise<unknown>;
}

export class NodeExecutor {
  private actorExecutor: ActorExecutor;
  private routerExecutor: RouterExecutor;
  private awaitExecutor: AwaitExecutor;
  private effectExecutor: EffectExecutor;

  constructor() {
    this.actorExecutor = new ActorExecutor();
    this.routerExecutor = new RouterExecutor();
    this.awaitExecutor = new AwaitExecutor();
    this.effectExecutor = new EffectExecutor();
  }

  public async execute(node: CompiledNode, input: unknown, ctx: ExecutorContext): Promise<unknown> {
    switch (node.type) {
      case 'loop_start':
        return undefined;

      case 'loop_end':
        return this.executeLoopEnd(node.config as LoopEnd, ctx);

      case 'actor':
        return this.actorExecutor.execute(node.config as Actor, input, ctx);

      case 'router':
        return this.routerExecutor.execute(node.config as Router, input, ctx);

      case 'join':
        return this.awaitExecutor.execute(node.config as Join, input, ctx);

      case 'tool':
        return this.effectExecutor.execute(node.config as Tool, input, ctx);

      default:
        return assertNever(node.type);
    }
  }

  private executeLoopEnd(roundEnd: LoopEnd, ctx: ExecutorContext): { halt: boolean; reason?: string } {
    if (roundEnd.halt_condition !== undefined && roundEnd.halt_condition !== '') {
      const cond = roundEnd.halt_condition.trim().toLowerCase();
      if (cond === 'true' || cond === 'always') {
        return { halt: true, reason: `Halt condition met at round ${ctx.round}` };
      }
    }
    if (roundEnd.max_iterations !== undefined && ctx.round >= roundEnd.max_iterations) {
      return { halt: true, reason: `Max rounds (${roundEnd.max_iterations}) reached` };
    }
    return { halt: false };
  }
}

function assertNever(_value: never): never {
  throw new Error('Unhandled node type');
}
