import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export async function init(args: string[]): Promise<void> {
  const name = args[0] ?? 'my-program';
  const dir = join(process.cwd(), name);

  await mkdir(dir, { recursive: true });

  const programYaml = `program:
  name: "${name}"
  version: "1.0"
  defaults:
    model: "minimax/minimax-m1-m3"
    temperature: 0.7
    max_iterations: 10

  stores:
    - id: transcript
      name: "Conversation Transcript"
      write_mode: append
      builtin: true

    - id: working_notes
      name: "Working Notes"
      write_mode: append

  nodes:
    - type: loop_start
      id: rs1

    - type: actor
      id: thinker
      name: "Thinker"
      actor_type: llm
      subscribe: [transcript, working_notes]
      publish: working_notes
      prompt_template: |
        You are a thoughtful reasoning agent.

        Previous notes:
        {{channel:working_notes}}

        Conversation so far:
        {{channel:transcript}}

        Think carefully about the user's request and provide your reasoning.

    - type: tool
      id: emit_response
      name: "Emit Response"
      tool_type: emit_to_user
      config: {}

    - type: loop_end
      id: re1
      max_iterations: 10

  edges:
    - from: rs1
      to: thinker
      type: control
    - from: thinker
      to: emit_response
      type: data
    - from: emit_response
      to: re1
      type: control
`;

  await writeFile(join(dir, 'program.yaml'), programYaml);
  await writeFile(join(dir, '.env'), 'OPENROUTER_API_KEY=your-key-here\n');

  console.log(`Initialized "${name}" at ${dir}/`);
  console.log('');
  console.log('Files created:');
  console.log('  program.yaml  — your program definition');
  console.log('  .env          — environment variables');
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Set your API key in ${name}/.env`);
  console.log(`  2. chakra validate ${name}/program.yaml`);
  console.log(`  3. chakra run ${name}/program.yaml`);
}
