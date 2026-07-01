import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import type { ToolExecutor, ToolResult } from './interface.js';

/**
 * File system tools for agent actors.
 */
export class FileReadTool implements ToolExecutor {
  public readonly name = 'read_file';
  public readonly description = 'Read the contents of a file.';
  public readonly parameters = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to read' },
    },
    required: ['path'],
  };

  private readonly basePath: string;

  constructor(opts?: { basePath?: string }) {
    this.basePath = opts?.basePath ?? process.cwd();
  }

  public async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const filePath = resolve(this.basePath, args.path as string);
      const content = await readFile(filePath, 'utf-8');
      return { success: true, output: content };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  }
}

export class FileWriteTool implements ToolExecutor {
  public readonly name = 'write_file';
  public readonly description = 'Write content to a file, creating directories as needed.';
  public readonly parameters = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to write' },
      content: { type: 'string', description: 'Content to write' },
    },
    required: ['path', 'content'],
  };

  private readonly basePath: string;

  constructor(opts?: { basePath?: string }) {
    this.basePath = opts?.basePath ?? process.cwd();
  }

  public async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const filePath = resolve(this.basePath, args.path as string);
      const dir = dirname(filePath);
      await mkdir(dir, { recursive: true });
      await writeFile(filePath, args.content as string, 'utf-8');
      return { success: true, output: `Written to ${filePath}` };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  }
}

export class ListDirectoryTool implements ToolExecutor {
  public readonly name = 'list_directory';
  public readonly description = 'List files and directories at a given path.';
  public readonly parameters = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path to list' },
    },
    required: ['path'],
  };

  private readonly basePath: string;

  constructor(opts?: { basePath?: string }) {
    this.basePath = opts?.basePath ?? process.cwd();
  }

  public async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const dirPath = resolve(this.basePath, args.path as string);
      const entries = await readdir(dirPath);
      const details = await Promise.all(
        entries.map(async (entry) => {
          const entryPath = join(dirPath, entry);
          const info = await stat(entryPath);
          return `${info.isDirectory() ? '[dir]' : '[file]'} ${entry}`;
        })
      );
      return { success: true, output: details.join('\n') };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  }
}
