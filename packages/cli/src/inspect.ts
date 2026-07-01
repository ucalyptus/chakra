import { readFile } from 'fs/promises';
import { TraceLog } from '@chakra-dsl/core';

export async function inspect(args: string[]): Promise<void> {
  const filePath = args[0];
  if (!filePath) {
    console.error('Usage: chakra inspect <trace.jsonl>');
    process.exit(1);
  }

  const source = await readFile(filePath, 'utf-8');
  const trace = TraceLog.fromJSONLines(source);
  const events = trace.getEvents();

  console.log(`Trace: ${filePath}`);
  console.log(`Total events: ${events.length}`);
  console.log('');

  // Summary statistics
  const rounds = trace.getEventsByType('round.start').length;
  const actorCompletions = trace.getEventsByType('actor.complete') as {
    type: 'actor.complete'; nodeId: string; latencyMs: number;
    tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
  }[];
  const routers = trace.getEventsByType('router.evaluated');
  const errors = trace.getEventsByType('error');

  console.log(`Rounds: ${rounds}`);
  console.log(`Actor completions: ${actorCompletions.length}`);
  console.log(`Routers made: ${routers.length}`);
  console.log(`Errors: ${errors.length}`);

  if (actorCompletions.length > 0) {
    const totalTokens = actorCompletions.reduce((s, e) => s + e.tokenUsage.totalTokens, 0);
    const avgLatency = actorCompletions.reduce((s, e) => s + e.latencyMs, 0) / actorCompletions.length;
    console.log(`\nToken usage: ${totalTokens} total`);
    console.log(`Avg latency: ${Math.round(avgLatency)}ms`);
  }

  // Detailed timeline (last 20 events)
  const filter = args.includes('--all') ? events : events.slice(-20);
  if (!args.includes('--all') && events.length > 20) {
    console.log(`\nShowing last 20 of ${events.length} events (use --all for full trace):`);
  }
  console.log('');

  for (const event of filter) {
    const ts = 'timestamp' in event ? new Date(event.timestamp).toISOString().slice(11, 23) : '';
    console.log(`  [${ts}] ${formatEvent(event)}`);
  }
}

function formatEvent(event: Record<string, unknown>): string {
  switch (event.type) {
    case 'round.start': return `━━ Round ${String(event.round)} ━━`;
    case 'round.end': return `── End Round ${String(event.round)} ──`;
    case 'node.activated': return `→ ${String(event.nodeId)}`;
    case 'actor.start': return `⚡ ${String(event.nodeId)}[${String(event.instanceIndex)}] executing...`;
    case 'actor.complete': return `✓ ${String(event.nodeId)}[${String(event.instanceIndex)}] (${String(event.latencyMs)}ms)`;
    case 'router.evaluated': return `⑂ ${String(event.nodeId)} → "${String(event.selectedBranch)}"`;
    case 'await.satisfied': return `⊕ ${String(event.awaitId)} satisfied`;
    case 'store.write': return `✎ ${String(event.storeId)} (${String(event.mode)})`;
    case 'user.output': return `◁ emit: ${String(event.message).slice(0, 60)}...`;
    case 'user.input': return `▷ input: ${String(event.message).slice(0, 60)}...`;
    case 'error': return `✗ ${String(event.nodeId)}: ${String(event.error)}`;
    default: return JSON.stringify(event);
  }
}
