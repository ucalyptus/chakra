import type { Graph } from '../schema/types.js';
import { validateGraph } from '../schema/validate.js';
import { parseGraph } from './parser.js';
import { buildGraph } from './graph.js';
import type { CompiledGraph } from './ir.js';

export interface CompileResult {
  program: CompiledGraph;
  warnings: string[];
}

export interface CompileError {
  errors: { rule: string; message: string; nodeId?: string }[];
}

class CompilationError extends Error implements CompileError {
  public readonly errors: { rule: string; message: string; nodeId?: string }[];

  constructor(errors: { rule: string; message: string; nodeId?: string }[]) {
    super(`Compilation failed with ${errors.length} error(s):\n${errors.map(e => `  [${e.rule}] ${e.message}`).join('\n')}`);
    this.name = 'CompilationError';
    this.errors = errors;
  }
}

export function compile(source: string | Graph, format?: 'json' | 'yaml'): CompileResult {
  // Parse if string
  const program: Graph = typeof source === 'string'
    ? parseGraph(source, format)
    : source;

  // Validate
  const validationResults = validateGraph(program);
  const errors = validationResults.filter(v => v.severity === 'error');
  const warnings = validationResults.filter(v => v.severity === 'warning');

  if (errors.length > 0) {
    throw new CompilationError(errors);
  }

  // Build graph / IR
  const compiled = buildGraph(program);

  return {
    program: compiled,
    warnings: warnings.map(w => `[${w.rule}] ${w.message}`),
  };
}

export { parseGraph } from './parser.js';
export { buildGraph } from './graph.js';
export type * from './ir.js';
export { compilePromptTemplate, validateTemplateChannels, extractTemplateChannels } from './prompt-compiler.js';
