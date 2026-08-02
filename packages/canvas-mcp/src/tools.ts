/**
 * The five tools from 07-AGENT-KIT §2, defined independently of the MCP transport so
 * they can be tested directly (and reused by anything else that wants a tool surface).
 *
 * `paint_pixels` is the only one that spends money, and it HARD-REFUSES when the quote
 * exceeds `max_total_units`. That refusal is the point of the tool: an agent must never
 * be able to sign an unbounded payment, and "the model promised to be careful" is not
 * an enforcement mechanism.
 */
import { BULK_MAX_PIXELS, CANVAS_W, CANVAS_H, PALETTE_SIZE, price, type Job, type Pixel } from '@canvas2026/shared';
import { validateJob } from '@canvas2026/converter';
import type { CanvasClient } from '@canvas2026/client';

export interface ToolResult {
  ok: boolean;
  summary: string;
  data?: unknown;
}

function badPixels(pixels: unknown): string | null {
  if (!Array.isArray(pixels) || pixels.length === 0) return 'pixels must be a non-empty array';
  if (pixels.length > BULK_MAX_PIXELS) return `at most ${BULK_MAX_PIXELS} pixels per call (chunk your job)`;
  for (const [i, p] of pixels.entries()) {
    const { x, y, c } = (p ?? {}) as Record<string, unknown>;
    if (typeof x !== 'number' || typeof y !== 'number' || typeof c !== 'number') return `pixel ${i}: x, y, c must be numbers`;
    if (x < 0 || y < 0 || x >= CANVAS_W || y >= CANVAS_H) return `pixel ${i}: (${x},${y}) is outside the canvas`;
    if (c < 0 || c >= PALETTE_SIZE) return `pixel ${i}: colour ${c} is not in the palette`;
  }
  return null;
}

export async function getRegion(
  client: CanvasClient,
  args: { x: number; y: number; w: number; h: number; meta?: boolean },
): Promise<ToolResult> {
  if (args.w <= 0 || args.h <= 0) return { ok: false, summary: 'w and h must be positive' };
  if (args.meta) {
    if (args.w > 250 || args.h > 250) return { ok: false, summary: 'meta mode is capped at 250×250' };
    const pixels = await client.getRegionMeta(args.x, args.y, args.w, args.h);
    return { ok: true, summary: `${pixels.length} pixels with metadata`, data: pixels };
  }
  const grid = await client.getRegion(args.x, args.y, args.w, args.h);
  return {
    ok: true,
    summary: `${args.w}×${args.h} palette indices at (${args.x},${args.y})`,
    // Rows as arrays: an agent reasons about this far better than a base64 blob.
    data: Array.from({ length: args.h }, (_, row) => Array.from(grid.slice(row * args.w, row * args.w + args.w))),
  };
}

export async function quote(client: CanvasClient, args: { pixels?: Pixel[]; job?: unknown }): Promise<ToolResult> {
  const pixels = args.job ? jobPixels(args.job) : args.pixels;
  if (!pixels) return { ok: false, summary: 'pass either pixels[] or a job' };
  const invalid = badPixels(pixels);
  if (invalid) return { ok: false, summary: invalid };

  const result = await client.quote(pixels);
  return {
    ok: true,
    summary: `${pixels.length} pixels cost ${result.total_units} atomic USDC units ($${(result.total_units / 1e6).toFixed(2)})`,
    data: result,
  };
}

export async function diffJob(client: CanvasClient, args: { job: unknown }): Promise<ToolResult> {
  const validated = validateJob(args.job);
  if (!validated.ok) return { ok: false, summary: `invalid job: ${validated.reason}` };

  const { repair, costUnits } = await client.diffJob(validated.job);
  return {
    ok: true,
    summary:
      repair.length === 0
        ? 'the canvas already matches this job'
        : `${repair.length} pixels differ; repairing costs ${costUnits} units ($${(costUnits / 1e6).toFixed(2)})`,
    data: { repair, cost_units: costUnits },
  };
}

export async function paintPixels(
  client: CanvasClient,
  args: { pixels: Pixel[]; max_total_units: number; handle?: string; url?: string },
): Promise<ToolResult> {
  const invalid = badPixels(args.pixels);
  if (invalid) return { ok: false, summary: invalid };

  // The cap is mandatory (07-AGENT-KIT §2): no cap, no painting. An agent that forgets
  // it does not get a default — it gets an error telling it to decide.
  if (typeof args.max_total_units !== 'number' || !Number.isInteger(args.max_total_units) || args.max_total_units <= 0) {
    return { ok: false, summary: 'max_total_units is required and must be a positive integer of atomic USDC units' };
  }

  const estimate = await client.quote(args.pixels);
  if (estimate.total_units > args.max_total_units) {
    return {
      ok: false,
      summary:
        `REFUSED: this costs ${estimate.total_units} units ($${(estimate.total_units / 1e6).toFixed(2)}) but ` +
        `max_total_units is ${args.max_total_units} ($${(args.max_total_units / 1e6).toFixed(2)}). ` +
        'Raise the cap deliberately or paint fewer pixels.',
      data: { quoted_units: estimate.total_units, max_total_units: args.max_total_units },
    };
  }
  if (estimate.total_units > client.remainingUnits) {
    return {
      ok: false,
      summary: `REFUSED: session budget has ${client.remainingUnits} units left, this costs ${estimate.total_units}.`,
      data: { remaining_units: client.remainingUnits, quoted_units: estimate.total_units },
    };
  }

  const outcome = await client.paintPixels(args.pixels, {
    ...(args.handle ? { handle: args.handle } : {}),
    ...(args.url ? { url: args.url } : {}),
  });

  return {
    ok: outcome.painted.length > 0,
    summary:
      `painted ${outcome.painted.length}/${args.pixels.length} pixels for ${outcome.spentUnits} units ` +
      `($${(outcome.spentUnits / 1e6).toFixed(2)})` +
      (outcome.skipped.length > 0 ? `; skipped ${outcome.skipped.length}` : ''),
    data: {
      painted: outcome.painted.length,
      skipped: outcome.skipped,
      spent_units: outcome.spentUnits,
      receipts: outcome.receipts.map((r) => ({ qid: r.qid, tx: r.tx, total_units: r.total_units })),
    },
  };
}

export async function getStats(client: CanvasClient, baseUrl: string, fetchImpl = fetch): Promise<ToolResult> {
  void client;
  const res = await fetchImpl(`${baseUrl}/api/stats`);
  if (!res.ok) return { ok: false, summary: `/api/stats ${res.status}` };
  const stats = await res.json();
  return { ok: true, summary: 'canvas stats', data: stats };
}

function jobPixels(job: unknown): Pixel[] | null {
  const validated = validateJob(job);
  return validated.ok ? (validated.job as Job).pixels : null;
}

/** What a pixel will cost at repaint index n — handy for agents planning a budget. */
export function priceAt(n: number): number {
  return price(n);
}
