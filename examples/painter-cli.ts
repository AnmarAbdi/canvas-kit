#!/usr/bin/env node
/**
 * CLI wrapper around `runPainter`. Kept separate so the painter can be imported (and
 * tested) without a module-level CLI firing.
 *
 *   CANVAS_WALLET_KEY=0x… node painter-cli.js job.json --budget 5.00 --handle me
 */
import { readFileSync } from 'node:fs';
import { CanvasClient } from '@canvas2026/client';
import { validateJob } from '@canvas2026/converter';
import { viemSigner } from '@canvas2026/canvas-mcp/signer';
import { runPainter } from './painter.js';

const [, , jobPath, ...rest] = process.argv;
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? undefined : rest[i + 1];
};

if (!jobPath) {
  console.error('usage: painter.js <job.json> --budget <dollars> [--handle name] [--url https://…]');
  process.exit(1);
}

const parsed = validateJob(JSON.parse(readFileSync(jobPath, 'utf8')));
if (!parsed.ok) {
  console.error(`bad job: ${parsed.reason}`);
  process.exit(1);
}

const dollars = Number(flag('budget'));
if (!(dollars > 0)) {
  console.error('--budget is required, in dollars, e.g. --budget 5.00. Painting without a cap is not supported.');
  process.exit(1);
}

const key = process.env['CANVAS_WALLET_KEY'];
if (!key) {
  console.error('CANVAS_WALLET_KEY is not set');
  process.exit(1);
}

const client = new CanvasClient({
  baseUrl: process.env['CANVAS_API_BASE'] ?? 'https://canvas2026.example',
  budget: {
    maxTotalUnits: Math.round(dollars * 1e6),
    ...(flag('per-pixel-max') ? { perPixelCeilingUnits: Math.round(Number(flag('per-pixel-max')) * 1e6) } : {}),
  },
  signer: viemSigner(key),
});

const result = await runPainter({
  client,
  job: parsed.job,
  ...(flag('handle') ? { handle: flag('handle') as string } : {}),
  ...(flag('url') ? { url: flag('url') as string } : {}),
});
console.log(
  `\ndone: ${result.paintedTotal} pixels over ${result.passes} passes, ` +
    `$${(result.spentUnits / 1e6).toFixed(2)} spent, ${result.remainingDiff} still wrong (${result.stoppedBecause})`,
);
