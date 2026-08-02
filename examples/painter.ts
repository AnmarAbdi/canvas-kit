/**
 * Reference painter (07-AGENT-KIT §3).
 *
 * Loop: load job → diff → chunk → paint within budget → handle every 03-PROTOCOL §6
 * error → sleep → repeat until the diff is empty or the budget is spent.
 *
 * This file doubles as protocol documentation: every branch that costs money or waits
 * is commented with *why*, not what.
 *
 * Library half — `painter-cli.ts` is the runnable one:
 *   CANVAS_WALLET_KEY=0x… node painter-cli.js job.json --budget 5.00 --handle me
 */
import { CanvasClient, BudgetExceededError } from '@canvas2026/client';

export interface PainterOptions {
  client: CanvasClient;
  job: { pixels: { x: number; y: number; c: number }[] };
  handle?: string;
  url?: string;
  /** Stop after this many passes; a canvas under attack never converges on its own. */
  maxPasses?: number;
  /** Between passes. The immunity window is 60s, so faster than that is wasted work. */
  passIntervalMs?: number;
  log?: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

export interface PainterResult {
  passes: number;
  paintedTotal: number;
  spentUnits: number;
  remainingDiff: number;
  stoppedBecause: 'complete' | 'budget' | 'passes' | 'frozen';
}

export async function runPainter(options: PainterOptions): Promise<PainterResult> {
  const log = options.log ?? ((m) => console.log(m));
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxPasses = options.maxPasses ?? 50;
  const interval = options.passIntervalMs ?? 60_000;

  let paintedTotal = 0;
  let passes = 0;

  for (; passes < maxPasses; passes++) {
    // Re-diff every pass: between passes anything could have been repainted, and
    // paying to repaint a pixel that already matches is pure waste.
    const { repair, costUnits } = await options.client.diffJob(options.job as never);

    if (repair.length === 0) {
      log(`pass ${passes + 1}: canvas matches the job — nothing to do`);
      return { passes, paintedTotal, spentUnits: options.client.spentUnits, remainingDiff: 0, stoppedBecause: 'complete' };
    }

    log(
      `pass ${passes + 1}: ${repair.length} pixels differ, ~${costUnits} units ` +
        `($${(costUnits / 1e6).toFixed(2)}); budget left $${(options.client.remainingUnits / 1e6).toFixed(2)}`,
    );

    try {
      const outcome = await options.client.paintPixels(repair, {
        ...(options.handle ? { handle: options.handle } : {}),
        ...(options.url ? { url: options.url } : {}),
      });
      paintedTotal += outcome.painted.length;
      log(`  painted ${outcome.painted.length}, skipped ${outcome.skipped.length}, spent ${outcome.spentUnits} units`);

      for (const skip of outcome.skipped.slice(0, 5)) {
        log(`  skipped (${skip.pixel.x},${skip.pixel.y}): ${skip.reason}`);
      }
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        // The cap is the whole safety story: stop, do not "just finish this bit".
        log(`budget exhausted: needed ${err.requestedUnits}, had ${err.remainingUnits}. Stopping.`);
        const left = await options.client.diffJob(options.job as never);
        return {
          passes: passes + 1,
          paintedTotal,
          spentUnits: options.client.spentUnits,
          remainingDiff: left.repair.length,
          stoppedBecause: 'budget',
        };
      }
      if ((err as Error).message.startsWith('FROZEN')) {
        log('the canvas is frozen. 2026 is over.');
        return { passes: passes + 1, paintedTotal, spentUnits: options.client.spentUnits, remainingDiff: 0, stoppedBecause: 'frozen' };
      }
      throw err;
    }

    // Wait out the immunity window before the next pass: anything we just painted is
    // untouchable for 60s anyway, and so is anything an opponent just painted.
    await sleep(interval);
  }

  const left = await options.client.diffJob(options.job as never);
  return { passes, paintedTotal, spentUnits: options.client.spentUnits, remainingDiff: left.repair.length, stoppedBecause: 'passes' };
}
