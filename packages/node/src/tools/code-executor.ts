import { spawn } from 'child_process';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import type { ToolExecutor, ToolResult } from './interface.js';

/**
 * Sandboxed code execution tool for agent actors.
 * Runs code in a subprocess with timeout.
 */
export class CodeExecutorTool implements ToolExecutor {
  public readonly name = 'execute_code';
  public readonly description = 'Execute code in a sandboxed environment and return the output.';
  public readonly parameters = {
    type: 'object',
    properties: {
      language: { type: 'string', enum: ['javascript', 'typescript', 'python', 'bash'] },
      code: { type: 'string', description: 'The code to execute' },
    },
    required: ['language', 'code'],
  };

  private readonly timeoutMs: number;

  constructor(opts?: { timeoutMs?: number }) {
    this.timeoutMs = opts?.timeoutMs ?? 30000;
  }

  public async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const language = args.language as string;
    const code = args.code as string;

    let cmd: string;
    let cmdArgs: string[];

    switch (language) {
      case 'javascript':
        cmd = 'node';
        cmdArgs = ['-e', code];
        break;
      case 'typescript':
        cmd = 'npx';
        cmdArgs = ['tsx', '-e', code];
        break;
      case 'python':
        cmd = 'python3';
        cmdArgs = ['-c', code];
        break;
      case 'bash':
        cmd = 'bash';
        cmdArgs = ['-c', code];
        break;
      default:
        return { success: false, output: '', error: `Unsupported language: ${language}` };
    }

    return new Promise<ToolResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      const proc: ChildProcessWithoutNullStreams = spawn(cmd, cmdArgs, {
        timeout: this.timeoutMs,
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
      });
      const timeoutId = setTimeout(() => {
        killed = true;
        proc.kill('SIGTERM');
      }, this.timeoutMs);

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('error', (err: Error) => {
        clearTimeout(timeoutId);
        resolve({ success: false, output: stdout, error: err.message });
      });

      proc.on('close', (exitCode: number | null) => {
        clearTimeout(timeoutId);
        if (killed) {
          resolve({ success: false, output: stdout, error: 'Execution timed out' });
        } else if (exitCode === 0) {
          resolve({ success: true, output: stdout });
        } else {
          resolve({ success: false, output: stdout, error: stderr || `Exit code: ${exitCode}` });
        }
      });
    });
  }
}
