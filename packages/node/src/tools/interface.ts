/**
 * Tool definition and execution interface for agent actors.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface ToolExecutor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

export interface ToolRegistry {
  register(tool: ToolExecutor): void;
  get(name: string): ToolExecutor | undefined;
  list(): ToolDefinition[];
  execute(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}

export class DefaultToolRegistry implements ToolRegistry {
  private readonly tools = new Map<string, ToolExecutor>();

  public register(tool: ToolExecutor): void {
    this.tools.set(tool.name, tool);
  }

  public get(name: string): ToolExecutor | undefined {
    return this.tools.get(name);
  }

  public list(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  public async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, output: '', error: `Unknown tool: ${name}` };
    }
    try {
      return await tool.execute(args);
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  }
}
