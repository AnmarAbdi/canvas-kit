/**
 * `@canvas2026/client` — the paint client every kit tool is built on.
 *
 * Two things here are non-negotiable, both from 07-AGENT-KIT §2:
 *
 *  1. **Budget caps are mandatory and enforced client-side.** An agent must never sign
 *     an unbounded payment. The cap is checked against the server's quote *before* any
 *     signature is produced, and the running total is checked again after every
 *     settlement, so a moving price cannot walk past the ceiling.
 *  2. **Chunking.** 03-PROTOCOL §4 is all-or-nothing per request, so a large job in a
 *     contested region livelocks if sent whole. Requests are split by tile and capped
 *     in size, and the caller re-diffs between attempts.
 *
 * The signer is injected: this package never touches a private key beyond handing bytes
 * to something that signs them.
 */
import {
  BULK_MAX_PIXELS,
  CANVAS_ID,
  API_VERSION,
  price,
  type Job,
  type Pixel,
  type PixelMeta,
  type Receipt,
} from '@canvas2026/shared';

export const TILE_SIZE = 100; // matches the server's sharding; only affects batching

export interface PaymentRequirements {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
}

/** Signs the EIP-3009 authorization the `exact` scheme settles with. */
export interface Signer {
  address: string;
  signTransferAuthorization(input: {
    chainId: number;
    verifyingContract: string;
    /** EIP-712 domain from the server's requirements — never hardcode this. */
    domainName: string;
    domainVersion: string;
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  }): Promise<string>;
}

export class BudgetExceededError extends Error {
  constructor(
    readonly requestedUnits: number,
    readonly remainingUnits: number,
  ) {
    super(`quote costs ${requestedUnits} units, budget has ${remainingUnits} left`);
    this.name = 'BudgetExceededError';
  }
}

export class PixelTooExpensiveError extends Error {
  constructor(
    readonly pixel: Pixel,
    readonly priceUnits: number,
    readonly ceilingUnits: number,
  ) {
    super(`(${pixel.x},${pixel.y}) costs ${priceUnits}, ceiling is ${ceilingUnits}`);
    this.name = 'PixelTooExpensiveError';
  }
}

export interface Budget {
  /** Hard ceiling on everything this client will ever spend. */
  maxTotalUnits: number;
  /** Optional per-pixel ceiling: skip pixels that have escalated past it. */
  perPixelCeilingUnits?: number;
}

export interface ClientOptions {
  baseUrl: string;
  budget: Budget;
  signer?: Signer;
  fetch?: typeof globalThis.fetch;
  /** Injected for tests; real clients sleep. */
  sleep?(ms: number): Promise<void>;
  now?(): number;
  onSpend?(units: number, receipt: Receipt): void;
  maxPixelsPerRequest?: number;
}

export interface PaintOutcome {
  painted: Pixel[];
  skipped: { pixel: Pixel; reason: string }[];
  spentUnits: number;
  receipts: Receipt[];
}

interface QuoteOffer {
  token: string;
  qid: string;
  requirements: PaymentRequirements;
  total: number;
}

export class CanvasClient {
  private spent = 0;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly maxPerRequest: number;

  constructor(private readonly opts: ClientOptions) {
    if (!Number.isInteger(opts.budget.maxTotalUnits) || opts.budget.maxTotalUnits < 0) {
      throw new RangeError('budget.maxTotalUnits must be a non-negative integer of atomic USDC units');
    }
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? (() => Date.now());
    this.maxPerRequest = Math.min(opts.maxPixelsPerRequest ?? 50, BULK_MAX_PIXELS);
  }

  get spentUnits(): number {
    return this.spent;
  }

  get remainingUnits(): number {
    return Math.max(0, this.opts.budget.maxTotalUnits - this.spent);
  }

  // ---------------------------------------------------------------- reads

  async getRegion(x: number, y: number, w: number, h: number): Promise<Uint8Array> {
    const res = await this.fetchImpl(`${this.opts.baseUrl}/api/region?x=${x}&y=${y}&w=${w}&h=${h}`);
    if (!res.ok) throw new Error(`/api/region ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async getRegionMeta(x: number, y: number, w: number, h: number): Promise<PixelMeta[]> {
    const res = await this.fetchImpl(`${this.opts.baseUrl}/api/region?x=${x}&y=${y}&w=${w}&h=${h}&meta=1`);
    if (!res.ok) throw new Error(`/api/region?meta ${res.status}`);
    return ((await res.json()) as { pixels: PixelMeta[] }).pixels;
  }

  async quote(pixels: Pixel[]): Promise<{ pixels: { x: number; y: number; n: number; price_units: number }[]; total_units: number }> {
    const res = await this.fetchImpl(`${this.opts.baseUrl}/api/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pixels }),
    });
    if (!res.ok) throw new Error(`/api/quote ${res.status}`);
    return (await res.json()) as { pixels: { x: number; y: number; n: number; price_units: number }[]; total_units: number };
  }

  /** Pixels of `job` that differ from the canvas right now, plus what repairing costs. */
  async diffJob(job: Job): Promise<{ repair: Pixel[]; costUnits: number }> {
    const box = boundingBox(job.pixels);
    if (!box) return { repair: [], costUnits: 0 };

    const grid = await this.getRegion(box.x, box.y, box.w, box.h);
    const repair = job.pixels.filter((p) => grid[(p.y - box.y) * box.w + (p.x - box.x)] !== p.c);
    if (repair.length === 0) return { repair: [], costUnits: 0 };

    const quoted = await this.quote(repair.slice(0, BULK_MAX_PIXELS));
    return { repair, costUnits: quoted.total_units };
  }

  // ---------------------------------------------------------------- writes

  /**
   * Paint pixels, chunked, with every 03-PROTOCOL §6 error handled. Returns what
   * landed and what was skipped; throws only on a budget violation or a terminal
   * server state (frozen), because those are decisions the caller must not miss.
   */
  async paintPixels(
    pixels: Pixel[],
    options: { handle?: string; url?: string; maxAttemptsPerChunk?: number } = {},
  ): Promise<PaintOutcome> {
    const outcome: PaintOutcome = { painted: [], skipped: [], spentUnits: 0, receipts: [] };
    const attemptsPerChunk = options.maxAttemptsPerChunk ?? 3;

    for (const chunk of chunkByTile(pixels, this.maxPerRequest)) {
      let remaining = chunk;

      for (let attempt = 0; attempt < attemptsPerChunk && remaining.length > 0; attempt++) {
        const result = await this.paintChunk(remaining, options);

        outcome.painted.push(...result.painted);
        outcome.skipped.push(...result.skipped);
        outcome.spentUnits += result.spentUnits;
        if (result.receipt) outcome.receipts.push(result.receipt);

        if (result.retry.length === 0) break;
        remaining = result.retry;
        if (result.waitMs > 0) await this.sleep(result.waitMs);
      }
    }
    return outcome;
  }

  private async paintChunk(
    pixels: Pixel[],
    options: { handle?: string; url?: string },
  ): Promise<{ painted: Pixel[]; skipped: { pixel: Pixel; reason: string }[]; retry: Pixel[]; waitMs: number; spentUnits: number; receipt?: Receipt }> {
    const body = {
      canvas: CANVAS_ID,
      version: API_VERSION,
      pixels,
      ...(options.handle ? { handle: options.handle } : {}),
      ...(options.url ? { url: options.url } : {}),
    };

    // 1. bare POST → the 402 IS the quote (03-PROTOCOL §2)
    const quoteRes = await this.fetchImpl(`${this.opts.baseUrl}/api/paint`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (quoteRes.status === 410) throw new Error('FROZEN: the canvas is frozen, nothing more will ever be painted');
    if (quoteRes.status !== 402) {
      throw new Error(`expected 402 quote, got ${quoteRes.status}: ${(await quoteRes.text()).slice(0, 200)}`);
    }

    const offer = await readOffer(quoteRes);

    // 2. budget gates — BEFORE any signature exists
    const ceiling = this.opts.budget.perPixelCeilingUnits;
    if (ceiling !== undefined) {
      const quoted = await this.quote(pixels);
      const tooDear = quoted.pixels.filter((p) => p.price_units > ceiling);
      if (tooDear.length > 0) {
        const affordable = pixels.filter((p) => !tooDear.some((t) => t.x === p.x && t.y === p.y));
        const skipped = tooDear.map((t) => ({
          pixel: pixels.find((p) => p.x === t.x && p.y === t.y) as Pixel,
          reason: `above per-pixel ceiling (${t.price_units} > ${ceiling})`,
        }));
        if (affordable.length === 0) return { painted: [], skipped, retry: [], waitMs: 0, spentUnits: 0 };
        const rest = await this.paintChunk(affordable, options);
        return { ...rest, skipped: [...skipped, ...rest.skipped] };
      }
    }

    if (offer.total > this.remainingUnits) {
      // Hard stop. Not a warning, not a partial attempt: the agent stops spending.
      throw new BudgetExceededError(offer.total, this.remainingUnits);
    }

    // 3. sign and resubmit
    if (!this.opts.signer) throw new Error('no signer configured: this client can read and quote, not paint');
    const payment = await this.buildPayment(offer);

    const paidRes = await this.fetchImpl(`${this.opts.baseUrl}/api/paint`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Canvas-Quote': offer.token,
        'PAYMENT-SIGNATURE': payment,
      },
      body: JSON.stringify(body),
    });

    if (paidRes.status === 200) {
      const { receipt } = (await paidRes.json()) as { receipt: Receipt };
      this.spent += receipt.total_units;
      this.opts.onSpend?.(receipt.total_units, receipt);
      return { painted: pixels, skipped: [], retry: [], waitMs: 0, spentUnits: receipt.total_units, receipt };
    }

    return this.handleFailure(paidRes, pixels);
  }

  /** 03-PROTOCOL §6, one branch per row of the table. */
  private async handleFailure(
    res: Response,
    pixels: Pixel[],
  ): Promise<{ painted: Pixel[]; skipped: { pixel: Pixel; reason: string }[]; retry: Pixel[]; waitMs: number; spentUnits: number }> {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      detail?: string;
      pixels?: { x: number; y: number; immune_until?: number }[];
      retry_after_ms?: number;
    };
    const nothing = { painted: [], skipped: [], spentUnits: 0 };

    switch (body.error) {
      case 'IMMUNE': {
        // Wait exactly as long as the pixel says, then try again. The immunity window
        // is public precisely so every bot can time this identically.
        const until = Math.max(...(body.pixels ?? []).map((p) => p.immune_until ?? 0), 0);
        const waitMs = until > 0 ? Math.max(0, until - this.now()) + 250 : 1_000;
        return { ...nothing, retry: pixels, waitMs };
      }
      case 'CAS_STALE':
        // Someone painted first; the price moved. Re-quote from scratch.
        return { ...nothing, retry: pixels, waitMs: 0 };
      case 'SETTLING':
        return { ...nothing, retry: pixels, waitMs: body.retry_after_ms ?? 1_000 };
      case 'QUOTE_EXPIRED':
      case 'QUOTE_INVALID':
      case 'QUOTE_CONSUMED':
        return { ...nothing, retry: pixels, waitMs: 0 };
      case 'SETTLEMENT_FAILED':
        // The write was reverted and nobody was charged: safe to retry from scratch.
        return { ...nothing, retry: pixels, waitMs: 1_000 };
      case 'RATE_LIMITED':
        return { ...nothing, retry: pixels, waitMs: body.retry_after_ms ?? 5_000 };
      case 'FROZEN':
        throw new Error('FROZEN: the canvas is frozen, nothing more will ever be painted');
      default:
        return {
          ...nothing,
          retry: [],
          waitMs: 0,
          skipped: pixels.map((pixel) => ({ pixel, reason: body.error ?? `HTTP ${res.status}` })),
        };
    }
  }

  private async buildPayment(offer: QuoteOffer): Promise<string> {
    const signer = this.opts.signer as Signer;
    const chainId = Number(offer.requirements.network.split(':')[1]);
    if (!Number.isInteger(chainId)) throw new Error(`cannot read chain id from network "${offer.requirements.network}"`);

    const validBefore = String(Math.floor(this.now() / 1000) + offer.requirements.maxTimeoutSeconds);
    const nonce = randomNonce();

    // The domain travels in `extra` because it is network-specific ("USD Coin" on
    // mainnet, "USDC" on sepolia) and is part of what gets signed.
    const extra = offer.requirements.extra as { name?: string; version?: string };
    if (!extra.name || !extra.version) {
      throw new Error('402 requirements are missing the EIP-712 domain (extra.name / extra.version)');
    }

    const signature = await signer.signTransferAuthorization({
      chainId,
      verifyingContract: offer.requirements.asset,
      domainName: extra.name,
      domainVersion: extra.version,
      from: signer.address,
      to: offer.requirements.payTo,
      value: offer.requirements.amount,
      validAfter: '0',
      validBefore,
      nonce,
    });

    const { quote: _token, ...boundExtra } = offer.requirements.extra;
    return b64urlJson({
      x402Version: 2,
      accepted: { ...offer.requirements, extra: boundExtra },
      payload: {
        signature,
        authorization: {
          from: signer.address,
          to: offer.requirements.payTo,
          value: offer.requirements.amount,
          validAfter: '0',
          validBefore,
          nonce,
        },
      },
    });
  }
}

// ---------------------------------------------------------------- helpers

async function readOffer(res: Response): Promise<QuoteOffer> {
  const body = (await res.json()) as { accepts: PaymentRequirements[] };
  const requirements = body.accepts[0];
  if (!requirements) throw new Error('402 response carried no payment requirements');
  const extra = requirements.extra as { qid?: string; quote?: string };
  if (!extra.qid || !extra.quote) throw new Error('402 response is missing extra.qid / extra.quote');
  return { requirements, qid: extra.qid, token: extra.quote, total: Number(requirements.amount) };
}

export function boundingBox(pixels: Pixel[]): { x: number; y: number; w: number; h: number } | null {
  if (pixels.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pixels) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Split into requests that never straddle a tile and never exceed `maxPerRequest`.
 * Same-tile batching is what keeps a request from failing because an unrelated pixel
 * in another tile lost its race (03-PROTOCOL §4's all-or-nothing rule).
 */
export function chunkByTile(pixels: Pixel[], maxPerRequest: number): Pixel[][] {
  const tiles = new Map<string, Pixel[]>();
  for (const p of pixels) {
    const key = `${Math.floor(p.x / TILE_SIZE)},${Math.floor(p.y / TILE_SIZE)}`;
    const group = tiles.get(key);
    if (group) group.push(p);
    else tiles.set(key, [p]);
  }

  const chunks: Pixel[][] = [];
  for (const group of tiles.values()) {
    for (let i = 0; i < group.length; i += maxPerRequest) chunks.push(group.slice(i, i + maxPerRequest));
  }
  return chunks;
}

/** Cost of painting these pixels at their current repaint indices. */
export function estimateUnits(metas: { n: number }[]): number {
  return metas.reduce((sum, m) => sum + price(m.n), 0);
}

function b64urlJson(value: unknown): string {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
