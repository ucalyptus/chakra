import type { CompiledTemplate, InjectionSlot } from './ir.js';

const CHANNEL_PATTERN = /\{\{channel:(\w+)(?::(\d+))?\}\}/g;

/**
 * Parse a prompt template string into static fragments and injection slots.
 * Template syntax: {{channel:storeId}} or {{channel:storeId:maxTokens}}
 */
export function compilePromptTemplate(template: string): CompiledTemplate {
  const staticFragments: string[] = [];
  const injections: InjectionSlot[] = [];

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const regex = new RegExp(CHANNEL_PATTERN.source, CHANNEL_PATTERN.flags);

  while ((match = regex.exec(template)) !== null) {
    staticFragments.push(template.slice(lastIndex, match.index));
    injections.push({
      storeId: match[1],
      maxTokens: match[2] ? parseInt(match[2], 10) : undefined,
    });
    lastIndex = regex.lastIndex;
  }
  staticFragments.push(template.slice(lastIndex));

  const baseText = staticFragments.join('');
  const estimatedBaseTokens = Math.ceil(baseText.length / 4);

  return { staticFragments, injections, estimatedBaseTokens };
}

/**
 * Validate that all {{channel:X}} references in a template resolve to declared channels.
 */
export function validateTemplateChannels(
  template: string,
  declaredChannels: Set<string>,
): string[] {
  const errors: string[] = [];
  const regex = new RegExp(CHANNEL_PATTERN.source, CHANNEL_PATTERN.flags);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(template)) !== null) {
    const storeId = match[1];
    if (!declaredChannels.has(storeId)) {
      errors.push(`Template references undeclared channel: "${storeId}"`);
    }
  }

  return errors;
}

/**
 * Extract all channel IDs referenced in a template.
 */
export function extractTemplateChannels(template: string): string[] {
  const stores: string[] = [];
  const regex = new RegExp(CHANNEL_PATTERN.source, CHANNEL_PATTERN.flags);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(template)) !== null) {
    stores.push(match[1]);
  }

  return stores;
}
