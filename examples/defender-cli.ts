#!/usr/bin/env node
/**
 * CLI wrapper around the reference defender (07-AGENT-KIT §4). Watch a job on the live
 * diff stream and repair it the moment immunity lapses. Node 22+ (global WebSocket).
 *
 *   CANVAS_WALLET_KEY=0x… npx tsx examples/defender-cli.ts job.json --budget 20.00
 *
 * Its limits are the game's, not this code's (see defender.ts): it cannot beat
 * immunity — the earliest repair is one window after the attack — and it cannot outbid
 * a bigger budget, because every repaint costs more than the last.
 */
import { readFileSync } from 'node:fs';
import { DiffKind, PALETTE_SIZE } from '@canvas2026/shared';
import { CanvasClient } from '@canvas2026/client';
import { validateJob } from '@canvas2026/converter';
import { viemSigner } from '@canvas2026/canvas-mcp/signer';
import { Defender, liveSubscription } from './defender.js';

const [, , jobPath, ...rest] = process.argv;
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? undefined : rest[i + 1];
};

if (!jobPath) {
  console.error('usage: defender-cli.ts <job.json> --budget <dollars> [--per-pixel-max dollars] [--handle name]');
  process.exit(1);
}

const parsed = validateJob(JSON.parse(readFileSync(jobPath, 'utf8')));
if (!parsed.ok) {
  console.error(`bad job: ${parsed.reason}`);
  process.exit(1);
}
const job = parsed.job;

const dollars = Number(flag('budget'));
if (!(dollars > 0)) {
  console.error('--budget is required, in dollars, e.g. --budget 20.00. Defending without a cap is not supported.');
  process.exit(1);
}

const key = process.env['CANVAS_WALLET_KEY'];
if (!key) {
  console.error('CANVAS_WALLET_KEY is not set');
  process.exit(1);
}

const baseUrl = process.env['CANVAS_API_BASE'] ?? 'https://canvas2026.example';
const client = new CanvasClient({
  baseUrl,
  budget: {
    maxTotalUnits: Math.round(dollars * 1e6),
    // In a war the price of a contested pixel doubles every round; a per-pixel ceiling
    // is how you concede individual pixels instead of feeding the whole budget to one.
    ...(flag('per-pixel-max') ? { perPixelCeilingUnits: Math.round(Number(flag('per-pixel-max')) * 1e6) } : {}),
  },
  signer: viemSigner(key),
});

const defender = new Defender({
  client,
  job,
  subscribe: liveSubscription(baseUrl, job),
  ...(flag('handle') ? { handle: flag('handle') as string } : {}),
  onAlert: (alert) => console.log(`ALERT ${JSON.stringify(alert)}`),
});

// Damage done before we connected never arrives on the live stream, so seed it from a
// diff. We only know these pixels differ — not their current colour or when they were
// hit — so mark them with any non-wanted colour and accept the worst case: the first
// repair pass may wait out one full immunity window that had already lapsed. Waiting
// is safe; repainting early is impossible anyway (kind is irrelevant to scheduling).
const { repair, costUnits } = await client.diffJob(job);
if (repair.length > 0) {
  console.log(`${repair.length} pixels already wrong — repair quoted at $${(costUnits / 1e6).toFixed(2)}, queueing`);
  defender.handleDiff(repair.map((p) => ({ x: p.x, y: p.y, c: (p.c + 1) % PALETTE_SIZE, kind: DiffKind.PAID })));
}

process.on('SIGINT', () => defender.stop());

console.log(`defending ${job.pixels.length} pixels with $${dollars.toFixed(2)} — ctrl-c to stop`);
await defender.start(); // runs until ctrl-c or the budget alert stops it
console.log(
  `\nstopped: $${(client.spentUnits / 1e6).toFixed(2)} spent, ${defender.pendingRepairs} repairs still pending`,
);
