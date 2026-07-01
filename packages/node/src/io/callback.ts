import type { UserIOBridge } from './interface.js';

/**
 * Callback-based I/O for programmatic embedding.
 * Allows host applications to provide custom I/O handlers.
 */
export class CallbackUserIO implements UserIOBridge {
  private readonly emitHandler: (message: string) => void | Promise<void>;
  private readonly inputProvider: () => Promise<string>;
  private readonly inputCallbacks: ((input: string) => void)[] = [];

  constructor(opts: {
    onEmit: (message: string) => void | Promise<void>;
    getInput: () => Promise<string>;
  }) {
    this.emitHandler = opts.onEmit;
    this.inputProvider = opts.getInput;
  }

  public async emit(message: string): Promise<void> {
    await this.emitHandler(message);
  }

  public async waitForInput(): Promise<string> {
    const input = await this.inputProvider();
    for (const cb of this.inputCallbacks) cb(input);
    return input;
  }

  public onInput(callback: (input: string) => void): void {
    this.inputCallbacks.push(callback);
  }
}
