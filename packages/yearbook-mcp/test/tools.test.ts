/**
 * MCP tool surface. The agent-facing half of the budget rule lives here: `paint_pixels`
 * must refuse rather than trust the caller, and the refusal must say what it would have
 * cost so the model can decide instead of guess.
 */
import { describe, it, expect, vi } from 'vitest';
import { PRICE_BASE_UNITS, BULK_MAX_PIXELS, CANVAS_W } from '@yearbook2026/shared';
import type { YearbookClient } from '@yearbook2026/client';
import { getRegion, quote, diffJob, paintPixels, getStats } from '../src/tools.js';
import { configFromEnv } from '../src/index.js';

function fakeClient(overrides: Partial<Record<keyof YearbookClient, unknown>> = {}): YearbookClient {
  const base = {
    getRegion: vi.fn(async (_x: number, _y: number, w: number, h: number) => new Uint8Array(w * h).fill(7)),
    getRegionMeta: vi.fn(async () => [{ x: 1, y: 1, c: 2, n: 1, price_next: PRICE_BASE_UNITS * 2 }]),
    quote: vi.fn(async (pixels: { x: number; y: number }[]) => ({
      pixels: pixels.map((p) => ({ x: p.x, y: p.y, n: 0, price_units: PRICE_BASE_UNITS })),
      total_units: PRICE_BASE_UNITS * pixels.length,
    })),
    diffJob: vi.fn(async () => ({ repair: [{ x: 1, y: 1, c: 3 }], costUnits: PRICE_BASE_UNITS })),
    paintPixels: vi.fn(async (pixels: { x: number; y: number; c: number }[]) => ({
      painted: pixels,
      skipped: [],
      spentUnits: PRICE_BASE_UNITS * pixels.length,
      receipts: [{ qid: 'q1', tx: '0xtx', total_units: PRICE_BASE_UNITS * pixels.length }],
    })),
    remainingUnits: 10_000_000,
    spentUnits: 0,
  };
  return { ...base, ...overrides } as unknown as YearbookClient;
}

const job = { yearbook: '2026', version: 1, pixels: [{ x: 1, y: 1, c: 3 }] };

describe('paint_pixels budget refusal', () => {
  it('REFUSES when the quote exceeds max_total_units, and never paints', async () => {
    const client = fakeClient();
    const result = await paintPixels(client, { pixels: [{ x: 1, y: 1, c: 3 }], max_total_units: PRICE_BASE_UNITS - 1 });

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('REFUSED');
    expect(result.summary).toContain('Raise the cap deliberately');
    expect(client.paintPixels).not.toHaveBeenCalled();
    // The agent is told both numbers so it can make an informed decision.
    expect(result.data).toMatchObject({ quoted_units: PRICE_BASE_UNITS, max_total_units: PRICE_BASE_UNITS - 1 });
  });

  it('requires the cap at all — a missing one is an error, never a default', async () => {
    const client = fakeClient();
    for (const bad of [undefined, 0, -5, 1.5, '100']) {
      const result = await paintPixels(client, { pixels: [{ x: 1, y: 1, c: 3 }], max_total_units: bad as number });
      expect(result.ok).toBe(false);
      expect(result.summary).toContain('max_total_units is required');
    }
    expect(client.paintPixels).not.toHaveBeenCalled();
  });

  it('refuses when the session budget is exhausted even if the per-call cap is generous', async () => {
    const client = fakeClient({ remainingUnits: 5 } as never);
    const result = await paintPixels(client, { pixels: [{ x: 1, y: 1, c: 3 }], max_total_units: 10_000_000 });

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('session budget');
    expect(client.paintPixels).not.toHaveBeenCalled();
  });

  it('paints when the quote fits, and reports what it spent', async () => {
    const client = fakeClient();
    const result = await paintPixels(client, { pixels: [{ x: 1, y: 1, c: 3 }], max_total_units: PRICE_BASE_UNITS });

    expect(result.ok).toBe(true);
    expect(client.paintPixels).toHaveBeenCalledOnce();
    expect(result.data).toMatchObject({ painted: 1, spent_units: PRICE_BASE_UNITS });
  });
});

describe('input validation happens before any network call', () => {
  it('rejects out-of-bounds and out-of-palette pixels', async () => {
    const client = fakeClient();
    expect((await paintPixels(client, { pixels: [{ x: CANVAS_W, y: 0, c: 1 }], max_total_units: 1000 })).ok).toBe(false);
    expect((await paintPixels(client, { pixels: [{ x: 0, y: 0, c: 99 }], max_total_units: 1000 })).ok).toBe(false);
    expect(client.quote).not.toHaveBeenCalled();
  });

  it('tells the agent to chunk instead of silently truncating', async () => {
    const client = fakeClient();
    const tooMany = Array.from({ length: BULK_MAX_PIXELS + 1 }, (_, i) => ({ x: i % 500, y: Math.floor(i / 500), c: 1 }));
    const result = await paintPixels(client, { pixels: tooMany, max_total_units: 10_000_000 });
    expect(result.summary).toContain('chunk your job');
  });
});

describe('read tools', () => {
  it('returns a region as rows an agent can reason about', async () => {
    const result = await getRegion(fakeClient(), { x: 0, y: 0, w: 3, h: 2 });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([
      [7, 7, 7],
      [7, 7, 7],
    ]);
  });

  it('enforces the meta cap from 04-API', async () => {
    const result = await getRegion(fakeClient(), { x: 0, y: 0, w: 251, h: 10, meta: true });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('250');
  });

  it('quotes from a job as well as raw pixels, and never commits anything', async () => {
    const fromJob = await quote(fakeClient(), { job });
    const fromPixels = await quote(fakeClient(), { pixels: [{ x: 1, y: 1, c: 3 }] });
    expect(fromJob.data).toEqual(fromPixels.data);
    expect(fromJob.summary).toContain('$0.01');
  });

  it('diff_job explains the repair set in money terms', async () => {
    const result = await diffJob(fakeClient(), { job });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('1 pixels differ');
    expect(result.data).toMatchObject({ cost_units: PRICE_BASE_UNITS });
  });

  it('diff_job rejects a malformed job instead of quoting nonsense', async () => {
    const result = await diffJob(fakeClient(), { job: { canvas: 'nope' } });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('invalid job');
  });

  it('get_stats passes the API through', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ total_settled_units: 42 }), { status: 200 }));
    const result = await getStats(fakeClient(), 'https://canvas.test', fetchImpl as unknown as typeof fetch);
    expect(result.data).toMatchObject({ total_settled_units: 42 });
  });
});

describe('server configuration', () => {
  it('refuses to start with a wallet but no budget', () => {
    expect(() => configFromEnv({ YEARBOOK_WALLET_KEY: '0xabc' } as NodeJS.ProcessEnv)).toThrow(/uncapped/);
  });

  it('allows a read-only server with no wallet', () => {
    const config = configFromEnv({ YEARBOOK_API_BASE: 'https://canvas.test' } as NodeJS.ProcessEnv);
    expect(config.walletKey).toBeUndefined();
    expect(config.baseUrl).toBe('https://canvas.test');
  });

  it('carries the budget and per-pixel ceiling through', () => {
    const config = configFromEnv({
      YEARBOOK_WALLET_KEY: '0xabc',
      YEARBOOK_BUDGET_UNITS: '5000000',
      YEARBOOK_PER_PIXEL_MAX: '640000',
    } as NodeJS.ProcessEnv);
    expect(config.budgetUnits).toBe(5_000_000);
    expect(config.perPixelCeilingUnits).toBe(640_000);
  });
});
