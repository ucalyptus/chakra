import type { Graph } from '../schema/types.js';
import type { LLMProvider, UserIOBridge, GraphResult } from '../runtime/runner.js';
import { Runner } from '../runtime/runner.js';
import { compile } from '../compiler/index.js';
import type { TraceLog } from '../events/trace.js';
import type { RuntimeEvent } from '../events/types.js';

/**
 * Test harness for running programs with controlled inputs and outputs.
 */

export interface TestConfig {
  /** LLM provider (usually a mock) */
  provider: LLMProvider;
  /** Predefined user inputs for wait_for_user effects */
  userInputs?: string[];
  /** Max concurrency for parallel actors */
  maxConcurrency?: number;
  /** Event listener for debugging */
  onEvent?: (event: RuntimeEvent) => void;
}

export interface TestResult {
  result: GraphResult;
  trace: TraceLog;
  outputs: string[];
  inputs: string[];
}

/**
 * Run a program in test mode with fully controlled I/O.
 */
export async function runGraph(
  source: string | Graph,
  config: TestConfig,
  format?: 'json' | 'yaml',
): Promise<TestResult> {
  const program = typeof source === 'string'
    ? compile(source, format).program
    : compile(source).program;

  const outputs: string[] = [];
  const inputs: string[] = [];
  let inputIndex = 0;

  const io: UserIOBridge = {
    emit(message: string): Promise<void> {
      outputs.push(message);
      return Promise.resolve();
    },
    waitForInput(): Promise<string> {
      const input = config.userInputs?.[inputIndex] ?? '';
      inputIndex++;
      inputs.push(input);
      return Promise.resolve(input);
    },
  };

  const controller = new Runner(program, {
    provider: config.provider,
    io,
    maxConcurrency: config.maxConcurrency,
    onEvent: config.onEvent,
  });

  const result = await controller.run();

  return {
    result,
    trace: result.trace,
    outputs,
    inputs,
  };
}

/**
 * Run a program from a YAML/JSON file path (Node.js only).
 */
export async function runGraphFile(
  filePath: string,
  config: TestConfig,
): Promise<TestResult> {
  const { readFile } = await import('fs/promises');
  const source = await readFile(filePath, 'utf-8');
  const format = filePath.endsWith('.yaml') || filePath.endsWith('.yml') ? 'yaml' : 'json';
  return runGraph(source, config, format);
}
