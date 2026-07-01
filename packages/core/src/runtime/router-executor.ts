import type { Router } from '../schema/types.js';
import type { ExecutorContext } from './node-executor.js';

export class RouterExecutor {
  public async execute(router: Router, input: unknown, ctx: ExecutorContext): Promise<unknown> {
    const inputStr = stringifyUnknown(input);
    let selectedBranch: string | undefined;

    if (router.mode === 'llm_driven') {
      // Strategy A: Parse structured <decision> tag
      const match = /<decision>(.*?)<\/decision>/i.exec(inputStr);
      if (match !== null) {
        const decision = match[1].trim().toLowerCase();
        const branch = router.branches.find(b =>
          b.label.toLowerCase() === decision ||
          b.label.toLowerCase().includes(decision)
        );
        if (branch !== undefined) selectedBranch = branch.label;
      }

      // Fallback: keyword matching
      if (selectedBranch === undefined) {
        for (const branch of router.branches) {
          if (inputStr.toLowerCase().includes(branch.label.toLowerCase())) {
            selectedBranch = branch.label;
            break;
          }
        }
      }

      // Default to first branch
      if (selectedBranch === undefined && router.branches.length > 0) {
        const firstBranch = router.branches.at(0);
        if (firstBranch !== undefined) {
          selectedBranch = firstBranch.label;
        }
      }
    } else {
      // Expression mode — safe string comparison
      for (const branch of router.branches) {
        if (branch.condition !== undefined && branch.condition !== '') {
          const condition = branch.condition.trim();
          const eqMatch = /^input\s*===?\s*['"](.+?)['"]$/.exec(condition);
          if (eqMatch !== null) {
            if (inputStr.trim() === eqMatch[1]) {
              selectedBranch = branch.label;
              break;
            }
          } else if (inputStr.toLowerCase().includes(condition.toLowerCase())) {
            selectedBranch = branch.label;
            break;
          }
        }
      }
      if (selectedBranch === undefined && router.branches.length > 0) {
        const lastBranch = router.branches.at(-1);
        if (lastBranch !== undefined) {
          selectedBranch = lastBranch.label;
        }
      }
    }

    ctx.eventBus.emit({
      type: 'router.evaluated',
      nodeId: router.id,
      selectedBranch: selectedBranch ?? 'none',
      timestamp: Date.now(),
    });

    // Activate the target of the selected branch
    const branch = router.branches.find(b => b.label === selectedBranch);
    if (branch !== undefined) {
      return ctx.activate(branch.target, input);
    }

    return undefined;
  }
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  if (value === null || value === undefined) {
    return '';
  }

  return JSON.stringify(value);
}
