import { readFile } from 'fs/promises';
import { compile } from '@chakra-dsl/core';

export async function validate(args: string[]): Promise<void> {
  const filePath = args[0];
  if (!filePath) {
    console.error('Usage: chakra validate <program.yaml|json>');
    process.exit(1);
  }

  const source = await readFile(filePath, 'utf-8');
  const format = filePath.endsWith('.yaml') || filePath.endsWith('.yml') ? 'yaml' : 'json';

  try {
    const { program, warnings } = compile(source, format);

    console.log(`✓ Graph "${program.name}" is valid`);
    console.log(`  Nodes: ${program.nodes.size}`);
    console.log(`  Memory stores: ${program.stores.size}`);
    console.log(`  Round starts: ${program.loopStarts.length}`);
    console.log(`  Round ends: ${program.loopEnds.length}`);

    if (warnings.length > 0) {
      console.log(`\nWarnings (${warnings.length}):`);
      for (const w of warnings) console.warn(`  ⚠ ${w}`);
    }
  } catch (err: unknown) {
    const error = err as { errors?: { rule: string; message: string }[] };
    console.error(`✗ Validation failed`);
    if (error.errors) {
      for (const e of error.errors) {
        console.error(`  [${e.rule}] ${e.message}`);
      }
    } else {
      console.error(`  ${(err as Error).message}`);
    }
    process.exit(1);
  }
}
