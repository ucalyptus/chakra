import type { LLMProvider, UserIOBridge, RuntimeConfig, GraphResult } from '../runtime/runner.js';
import { Runner } from '../runtime/runner.js';
import { compile } from '../compiler/index.js';
import type { Graph } from '../schema/types.js';

/**
 * A nested program node — allows an entire sub-program to be executed
 * as a single node in a parent program. Enables fractal composition.
 */

export interface NestedGraphConfig {
  /** The sub-program definition */
  program: Graph;
  /** Memory channels to pass from parent → child */
  inputChannels?: Record<string, string>; // parentChannelId → childChannelId
  /** Memory channels to pass from child → parent after completion */
  outputChannels?: Record<string, string>; // childChannelId → parentChannelId
  /** Max rounds for the sub-program (overrides child defaults) */
  maxIterations?: number;
}

export interface NestedGraphResult {
  output: string;
  innerResult: GraphResult;
}

export class NestedGraphExecutor {
  private provider: LLMProvider;
  private io: UserIOBridge;

  constructor(provider: LLMProvider, io: UserIOBridge) {
    this.provider = provider;
    this.io = io;
  }

  /**
   * Execute a sub-program with injected parent memory.
   */
  public async execute(
    config: NestedGraphConfig,
    parentMemory: Map<string, string>,
  ): Promise<NestedGraphResult> {
    // Compile the sub-program
    const { program: compiled } = compile(config.program);

    // Override max rounds if specified
    if (config.maxIterations !== undefined) {
      compiled.defaults.maxIterations = config.maxIterations;
    }

    // Create runtime config
    const runtimeConfig: RuntimeConfig = {
      provider: this.provider,
      io: this.io,
    };

    const controller = new Runner(compiled, runtimeConfig);

    // Inject parent memory into child channels before running
    if (config.inputChannels !== undefined) {
      for (const [parentCh, childCh] of Object.entries(config.inputChannels)) {
        const content = parentMemory.get(parentCh);
        if (content !== undefined && content !== '') {
          // Write to the child's memory channel via the compiled program's initial values
          const channel = compiled.stores.get(childCh);
          if (channel !== undefined) {
            channel.initialValue = content;
          }
        }
      }
    }

    // Run the sub-program
    const innerResult = await controller.run();

    // Extract output channels
    let output: string;
    if (config.outputChannels !== undefined) {
      const parts: string[] = [];
      for (const [childCh] of Object.entries(config.outputChannels)) {
        const content = innerResult.finalMemory.get(childCh);
        if (content !== undefined) {
          parts.push(content);
        }
      }
      output = parts.join('\n');
    } else {
      // Default: return all final memory concatenated
      output = Array.from(innerResult.finalMemory.values()).join('\n');
    }

    return { output, innerResult };
  }

  /**
   * Get the output channels mapping to write back to parent memory.
   */
  public getOutputMapping(
    config: NestedGraphConfig,
    innerResult: GraphResult,
  ): Map<string, string> {
    const mapping = new Map<string, string>();

    if (config.outputChannels !== undefined) {
      for (const [childCh, parentCh] of Object.entries(config.outputChannels)) {
        const content = innerResult.finalMemory.get(childCh);
        if (content !== undefined) {
          mapping.set(parentCh, content);
        }
      }
    }

    return mapping;
  }
}
