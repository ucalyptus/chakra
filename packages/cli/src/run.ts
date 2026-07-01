import { readFile } from 'fs/promises';
import { compile } from '@chakra-dsl/core';
import { Runner } from '@chakra-dsl/core';
import { OpenRouterProvider } from '@chakra-dsl/providers';
import { StdioUserIO } from '@chakra-dsl/node';

export async function run(args: string[]): Promise<void> {
  const filePath = args[0];
  if (!filePath) {
    console.error('Usage: chakra run <program.yaml|json>');
    process.exit(1);
  }

  const source = await readFile(filePath, 'utf-8');
  const format = filePath.endsWith('.yaml') || filePath.endsWith('.yml') ? 'yaml' : 'json';

  console.log(`Compiling ${filePath}...`);
  const { program, warnings } = compile(source, format);

  if (warnings.length > 0) {
    console.warn('Warnings:');
    for (const w of warnings) console.warn(`  ${w}`);
  }

  console.log(`Running "${program.name}" (${program.nodes.size} nodes, ${program.stores.size} stores)`);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (apiKey == null || apiKey === '') {
    console.error('Error: OPENROUTER_API_KEY environment variable is required');
    process.exit(1);
  }

  const provider = new OpenRouterProvider({ apiKey });
  const io = new StdioUserIO();

  const controller = new Runner(program, {
    provider,
    io,
    maxConcurrency: parseInt(process.env.MAX_CONCURRENCY ?? '5'),
  });

  let result;
  try {
    // Graceful shutdown on Ctrl+C — cleanup readline before exit
    const onSignal = () => {
      io.close();
      process.exit(130);
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);

    const start = process.hrtime.bigint();
    result = await controller.run();
    const elapsed = Number(process.hrtime.bigint() - start) / 1e9;

    console.log(`\nCompleted in ${result.rounds} rounds (${elapsed.toFixed(1)}s).`);
    if (result.halted) {
      console.log(`Halt reason: ${result.haltReason}`);
    }

    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  } finally {
    io.close();
  }
}
