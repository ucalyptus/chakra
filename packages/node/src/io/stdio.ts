import type { Interface as ReadlineInterface } from 'readline';
import { createInterface } from 'readline';
import type { UserIOBridge } from './interface.js';

/**
 * Terminal-based I/O for CLI usage.
 */
export class StdioUserIO implements UserIOBridge {
  private readonly rl: ReadlineInterface;
  private readonly prompt: string;

  constructor(opts?: { prompt?: string }) {
    this.prompt = opts?.prompt ?? '> ';
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  public emit(message: string): Promise<void> {
    process.stdout.write(message + '\n');
    return Promise.resolve();
  }

  public async waitForInput(): Promise<string> {
    return new Promise<string>((resolve) => {
      this.rl.question(this.prompt, (answer) => {
        resolve(answer);
      });
    });
  }

  public onInput(callback: (input: string) => void): void {
    this.rl.on('line', callback);
  }

  public close(): void {
    this.rl.close();
  }
}
