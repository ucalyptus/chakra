import type { CompiledTemplate, InjectionSlot } from './ir.js';

// Permissive pattern — allows whitespace between braces and around the colon.
// Must match the validate.ts permissive regex character-for-character to avoid
// silent injection failures where a template passes validation but the compiler
// returns zero injection slots. The `channel` keyword here is the DSL template
// syntax itself ({{channel:storeId}}) and is not renamed by the store/channel
// naming cleanup — only the internal identifiers around it are.
const STORE_TEMPLATE_PATTERN = /\{\{\s*channel\s*:\s*(\w+)(?::(\d+))?\s*\}\}/g;

/**
 * Parse a prompt template string into static fragments and injection slots.
 * Template syntax: {{channel:storeId}} or {{channel:storeId:maxTokens}}
 */
export function compilePromptTemplate(template: string): CompiledTemplate {
  const staticFragments: string[] = [];
  const injections: InjectionSlot[] = [];

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const regex = new RegExp(STORE_TEMPLATE_PATTERN.source, STORE_TEMPLATE_PATTERN.flags);

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
 * Validate that all {{channel:X}} references in a template resolve to declared stores.
 */
export function validateTemplateStores(
  template: string,
  declaredStoreIds: Set<string>,
): string[] {
  const errors: string[] = [];
  const regex = new RegExp(STORE_TEMPLATE_PATTERN.source, STORE_TEMPLATE_PATTERN.flags);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(template)) !== null) {
    const storeId = match[1];
    if (!declaredStoreIds.has(storeId)) {
      errors.push(`Template references undeclared store: "${storeId}"`);
    }
  }

  return errors;
}

/**
 * Extract all store IDs referenced in a template.
 */
export function extractTemplateStoreIds(template: string): string[] {
  const stores: string[] = [];
  const regex = new RegExp(STORE_TEMPLATE_PATTERN.source, STORE_TEMPLATE_PATTERN.flags);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(template)) !== null) {
    stores.push(match[1]);
  }

  return stores;
}
