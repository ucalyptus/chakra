/**
 * UserIOBridge interface — the contract for user interaction.
 * Implementations are environment-specific (terminal, WebSocket, programmatic).
 */
export interface UserIOBridge {
  /** Send a message to the user */
  emit(message: string): Promise<void>;
  /** Block until the user provides input */
  waitForInput(): Promise<string>;
  /** Event-driven alternative to waitForInput */
  onInput?(callback: (input: string) => void): void;
}
