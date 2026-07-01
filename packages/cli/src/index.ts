#!/usr/bin/env node
import { run } from './run.js';
import { validate } from './validate.js';
import { inspect } from './inspect.js';
import { init } from './init.js';

const args = process.argv.slice(2);
const command = args[0];

async function main(): Promise<void> {
  switch (command) {
    case 'run':
      await run(args.slice(1));
      break;
    case 'validate':
      await validate(args.slice(1));
      break;
    case 'inspect':
      await inspect(args.slice(1));
      break;
    case 'init':
      await init(args.slice(1));
      break;
    default:
      printHelp();
      process.exit(command ? 1 : 0);
  }
}

function printHelp(): void {
  console.log(`
chakra — Round-Based Cognitive Workflow Engine

Usage:
  chakra run <program.yaml|json>     Run a program
  chakra validate <program.yaml|json> Validate a program without running
  chakra inspect <trace.jsonl>       Inspect a trace log
  chakra init [name]                 Scaffold a new program

Options:
  --help    Show this help message
`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('Error:', message);
  process.exit(1);
});
