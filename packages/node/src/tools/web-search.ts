import type { ToolExecutor, ToolResult } from './interface.js';

export interface WebSearchConfig {
  apiKey?: string;
  baseUrl?: string;
  maxResults?: number;
}

/**
 * Web search tool adapter.
 * Uses a configurable search API (default: Tavily-style endpoint).
 */
export class WebSearchTool implements ToolExecutor {
  public readonly name = 'web_search';
  public readonly description = 'Search the web for information and return relevant results.';
  public readonly parameters = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query' },
      max_results: { type: 'number', description: 'Maximum number of results to return' },
    },
    required: ['query'],
  };

  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly maxResults: number;

  constructor(config: WebSearchConfig = {}) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://api.tavily.com';
    this.maxResults = config.maxResults ?? 5;
  }

  public async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const query = typeof args.query === 'string' ? args.query : '';
    const maxResults = typeof args.max_results === 'number' ? args.max_results : this.maxResults;

    if (this.apiKey == null || this.apiKey === '') {
      return { success: false, output: '', error: 'Web search API key not configured' };
    }

    try {
      const response = await fetch(`${this.baseUrl}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: this.apiKey,
          query,
          max_results: maxResults,
          include_answer: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, output: '', error: `Search API error: ${errorText}` };
      }

      const data = (await response.json()) as {
        answer?: string;
        results?: { title: string; url: string; content: string }[];
      };

      let output = '';
      if (data.answer != null && data.answer !== '') {
        output += `Answer: ${data.answer}\n\n`;
      }
      if (data.results != null && data.results.length > 0) {
        output += data.results
          .map((r, i) => `${i + 1}. [${r.title}](${r.url})\n   ${r.content}`)
          .join('\n\n');
      }

      return { success: true, output: output || 'No results found.' };
    } catch (err) {
      return { success: false, output: '', error: String(err) };
    }
  }
}
