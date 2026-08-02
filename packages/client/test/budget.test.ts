/**
 * M5 gate: "budget caps hard-stop overspend in tests."
 *
 * This is the file that decides whether it is safe to hand an agent a wallet. The cap
 * must be checked BEFORE a signature exists, must survive a price that moves between
 * quote and payment, and must not be bypassable by chunking a big job into small ones.
 */
import { describe, it, expect, vi } from 'vitest';
import { PRICE_BASE_UNITS, price } from '@canvas2026/shared';
import { CanvasClient, BudgetExceededError, chunkByTile, estimateUnits } from '../src/index.js';

const BASE = 'https://canvas.test';

/** A fake server that quotes whatever it is told to and always settles. */
function server(options: { unitsPerPixel?: number | ((call: number) => number); onPaid?: () => void } = {}) {
  let quoteCalls = 0;
  let signedCalls = 0;
  const signatures: string[] = [];

  const unitsFor = (pixels: number) => {
    const per = typeof options.unitsPerPixel === 'function' ? options.unitsPerPixel(quoteCalls) : options.unitsPerPixel ?? PRICE_BASE_UNITS;
    return per * pixels;
  };

  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const href = typeof url === 'string' ? url : url.toString();
    const body = init?.body ? (JSON.parse(init.body as string) as { pixels: { x: number; y: number; c: number }[] }) : { pixels: [] };

    if (href.includes('/api/quote')) {
      quoteCalls++;
      const total = unitsFor(body.pixels.length);
      return new Response(
        JSON.stringify({ pixels: body.pixels.map((p) => ({ x: p.x, y: p.y, n: 0, price_units: total / body.pixels.length })), total_units: total }),
        { status: 200 },
      );
    }

    if (href.includes('/api/paint')) {
      const headers = new Headers(init?.headers);
      if (!headers.has('PAYMENT-SIGNATURE')) {
        quoteCalls++;
        const total = unitsFor(body.pixels.length);
        return new Response(
          JSON.stringify({
            x402Version: 2,
            accepts: [
              {
                scheme: 'exact',
                network: 'eip155:84532',
                asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
                amount: String(total),
                payTo: '0xTREASURY',
                maxTimeoutSeconds: 30,
                extra: { qid: `qid-${quoteCalls}`, quote: `token-${quoteCalls}`, name: 'USDC', version: '2' },
              },
            ],
          }),
          { status: 402 },
        );
      }

      signedCalls++;
      signatures.push(headers.get('PAYMENT-SIGNATURE') as string);
      options.onPaid?.();
      const total = unitsFor(body.pixels.length);
      return new Response(
        JSON.stringify({
          receipt: { qid: `qid-${signedCalls}`, payer: '0xPAYER', pixels: [], total_units: total, committed_at: Date.now(), sig: 'sig' },
          pixels: [],
        }),
        { status: 200 },
      );
    }

    throw new Error(`unexpected fetch ${href}`);
  }) as unknown as typeof globalThis.fetch;

  return { fetchImpl, get quoteCalls() { return quoteCalls; }, get signedCalls() { return signedCalls; }, signatures };
}

const signer = {
  address: '0xPAYER',
  signTransferAuthorization: vi.fn(async () => '0xsignature'),
};

function client(maxTotalUnits: number, s = server(), extra: { perPixelCeilingUnits?: number } = {}) {
  return {
    s,
    client: new CanvasClient({
      baseUrl: BASE,
      budget: { maxTotalUnits, ...extra },
      signer,
      fetch: s.fetchImpl,
      sleep: async () => {},
    }),
  };
}

const pixels = (n: number, y = 0) => Array.from({ length: n }, (_, i) => ({ x: i, y, c: 3 }));

describe('the hard stop', () => {
  it('refuses a job that costs more than the budget, without signing anything', async () => {
    signer.signTransferAuthorization.mockClear();
    const { client: c, s } = client(PRICE_BASE_UNITS * 2);

    await expect(c.paintPixels(pixels(5))).rejects.toBeInstanceOf(BudgetExceededError);

    // The refusal happened before any signature was produced — that is the whole point.
    expect(signer.signTransferAuthorization).not.toHaveBeenCalled();
    expect(s.signedCalls).toBe(0);
    expect(c.spentUnits).toBe(0);
  });

  it('stops mid-job once the budget runs out instead of finishing the job', async () => {
    // Budget covers 3 pixels; the job is 10, chunked 1 per request.
    const s = server();
    const c = new CanvasClient({
      baseUrl: BASE,
      budget: { maxTotalUnits: PRICE_BASE_UNITS * 3 },
      signer,
      fetch: s.fetchImpl,
      sleep: async () => {},
      maxPixelsPerRequest: 1,
    });

    await expect(c.paintPixels(pixels(10))).rejects.toBeInstanceOf(BudgetExceededError);
    expect(c.spentUnits).toBe(PRICE_BASE_UNITS * 3);
    expect(s.signedCalls).toBe(3); // exactly the affordable ones, not one more
  });

  it('cannot be walked past by splitting a job into many small requests', async () => {
    const s = server();
    const c = new CanvasClient({
      baseUrl: BASE,
      budget: { maxTotalUnits: PRICE_BASE_UNITS * 4 },
      signer,
      fetch: s.fetchImpl,
      sleep: async () => {},
      maxPixelsPerRequest: 1,
    });

    // Four separate calls succeed, the fifth is refused: the ceiling is per client,
    // not per call.
    for (let i = 0; i < 4; i++) await c.paintPixels([{ x: i, y: 5, c: 1 }]);
    expect(c.spentUnits).toBe(PRICE_BASE_UNITS * 4);
    expect(c.remainingUnits).toBe(0);

    await expect(c.paintPixels([{ x: 9, y: 5, c: 1 }])).rejects.toBeInstanceOf(BudgetExceededError);
    expect(s.signedCalls).toBe(4);
  });

  it('catches a price that moved between the estimate and the quote', async () => {
    // The server quotes cheap once, then 100× — a contested pixel escalating under us.
    const s = server({ unitsPerPixel: (call) => (call === 0 ? PRICE_BASE_UNITS : PRICE_BASE_UNITS * 100) });
    const c = new CanvasClient({
      baseUrl: BASE,
      budget: { maxTotalUnits: PRICE_BASE_UNITS * 10 },
      signer,
      fetch: s.fetchImpl,
      sleep: async () => {},
    });

    await expect(c.paintPixels(pixels(1))).rejects.toBeInstanceOf(BudgetExceededError);
    expect(s.signedCalls).toBe(0);
  });

  it('rejects a nonsensical budget at construction', () => {
    expect(() => new CanvasClient({ baseUrl: BASE, budget: { maxTotalUnits: -1 } })).toThrow(RangeError);
    expect(() => new CanvasClient({ baseUrl: BASE, budget: { maxTotalUnits: 1.5 } })).toThrow(RangeError);
  });

  it('will not paint at all without a signer, but still reads and quotes', async () => {
    const s = server();
    const c = new CanvasClient({ baseUrl: BASE, budget: { maxTotalUnits: 1_000_000 }, fetch: s.fetchImpl, sleep: async () => {} });

    await expect(c.paintPixels(pixels(1))).rejects.toThrow(/no signer/);
    await expect(c.quote(pixels(1))).resolves.toMatchObject({ total_units: PRICE_BASE_UNITS });
  });
});

describe('per-pixel ceiling', () => {
  it('skips pixels that escalated past the ceiling and paints the rest', async () => {
    // Two pixels: the fake server prices them equally, so set the ceiling below that
    // and everything is skipped; above it, everything paints.
    const cheap = client(1_000_000, server({ unitsPerPixel: PRICE_BASE_UNITS }), { perPixelCeilingUnits: PRICE_BASE_UNITS - 1 });
    const outcome = await cheap.client.paintPixels(pixels(2, 1));

    expect(outcome.painted).toHaveLength(0);
    expect(outcome.skipped).toHaveLength(2);
    expect(outcome.skipped[0]?.reason).toMatch(/ceiling/);
    expect(cheap.s.signedCalls).toBe(0);

    const affordable = client(1_000_000, server({ unitsPerPixel: PRICE_BASE_UNITS }), { perPixelCeilingUnits: PRICE_BASE_UNITS });
    const ok = await affordable.client.paintPixels(pixels(2, 2));
    expect(ok.painted).toHaveLength(2);
  });
});

describe('chunking', () => {
  it('never lets one request straddle two tiles', () => {
    const chunks = chunkByTile(
      [
        { x: 5, y: 5, c: 1 },
        { x: 105, y: 5, c: 1 },
        { x: 5, y: 105, c: 1 },
      ],
      50,
    );
    expect(chunks).toHaveLength(3);
  });

  it('caps request size so a contested region cannot livelock a huge request', () => {
    const chunks = chunkByTile(Array.from({ length: 120 }, (_, i) => ({ x: i % 100, y: Math.floor(i / 100), c: 1 })), 50);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(50);
    expect(chunks.flat()).toHaveLength(120);
  });
});

describe('estimates', () => {
  it('sums the real pricing curve', () => {
    expect(estimateUnits([{ n: 0 }, { n: 1 }, { n: 12 }])).toBe(price(0) + price(1) + price(12));
  });
});

describe('EIP-712 domain', () => {
  it('signs with the domain the SERVER sent, never a hardcoded one', async () => {
    const captured: { domainName?: string; domainVersion?: string }[] = [];
    const s = server();
    const c = new CanvasClient({
      baseUrl: BASE,
      budget: { maxTotalUnits: 1_000_000 },
      signer: {
        address: '0xPAYER',
        signTransferAuthorization: async (input) => {
          captured.push(input);
          return '0xsignature';
        },
      },
      fetch: s.fetchImpl,
      sleep: async () => {},
    });

    await c.paintPixels([{ x: 1, y: 1, c: 1 }]);
    // The mainnet domain name is "USD Coin" and sepolia's is "USDC"; hardcoding either
    // makes half of the deployments produce signatures the facilitator rejects.
    expect(captured[0]?.domainName).toBe('USDC');
    expect(captured[0]?.domainVersion).toBe('2');
  });

  it('refuses to sign when the server did not publish a domain', async () => {
    const naked = (async () =>
      new Response(
        JSON.stringify({
          x402Version: 2,
          accepts: [
            {
              scheme: 'exact',
              network: 'eip155:84532',
              asset: '0xasset',
              amount: '10000',
              payTo: '0xTREASURY',
              maxTimeoutSeconds: 30,
              extra: { qid: 'q', quote: 't' }, // no name/version
            },
          ],
        }),
        { status: 402 },
      )) as unknown as typeof globalThis.fetch;

    const c = new CanvasClient({ baseUrl: BASE, budget: { maxTotalUnits: 1_000_000 }, signer, fetch: naked, sleep: async () => {} });
    await expect(c.paintPixels([{ x: 1, y: 1, c: 1 }])).rejects.toThrow(/EIP-712 domain/);
  });
});
