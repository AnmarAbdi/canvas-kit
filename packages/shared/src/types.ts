/**
 * Shared wire types. Shapes come from canvas-kit/docs/04-API.md (HTTP/WS contract)
 * and 03-PROTOCOL.md (quote, receipt, errors). Money: integer USDC atomic units.
 * Time: epoch ms, UTC.
 */

/** Diff/history `kind` byte (04-API §W2, 02-DATA history.kind). */
export const DiffKind = {
  FREE: 0,
  PAID: 1,
  MODERATED: 2,
  REVERTED: 3,
} as const;
export type DiffKind = (typeof DiffKind)[keyof typeof DiffKind];

export function isDiffKind(k: number): k is DiffKind {
  return k === 0 || k === 1 || k === 2 || k === 3;
}

/** The atom of every job/quote/paint body. */
export interface Pixel {
  x: number;
  y: number;
  /** Palette index. */
  c: number;
}

/** job.json v1 (07-AGENT-KIT §1). */
export interface Job {
  canvas: string;
  version: number;
  name?: string;
  pixels: Pixel[];
  /** Advisory only — prices move; never trust this at paint time. */
  est_cost_units?: number;
  est_cost_at?: string;
}

/** POST /api/paint body (04-API "Writes"). handle/url apply to every pixel in the request. */
export interface PaintRequest {
  canvas: string;
  version: number;
  pixels: Pixel[];
  handle?: string;
  url?: string;
}

/** POST /api/free-paint body. No url field exists here, by design (D6). */
export interface FreePaintRequest {
  x: number;
  y: number;
  c: number;
  handle?: string;
  turnstile_token: string;
}

/** A priced pixel inside a quote: `n` = expected repaint index at commit, `p` = price for THIS repaint. */
export interface QuotePixel extends Pixel {
  n: number;
  p: number;
}

/** The signed 402 quote (03-PROTOCOL §3). Stateless, single-use, bound to the payment by `qid`. */
export interface Quote {
  v: 1;
  qid: string;
  canvas: string;
  pixels: QuotePixel[];
  /** MUST equal accepts[0].amount. */
  total: number;
  iat: number;
  /** iat + QUOTE_TTL_MS. */
  exp: number;
}

/** 200 receipt (03-PROTOCOL §8). `sig` is signed with RECEIPT_SIGNING_KEY. */
export interface Receipt {
  qid: string;
  payer: string;
  pixels: QuotePixel[];
  total_units: number;
  tx?: string;
  committed_at: number;
  sig: string;
}

/** Per-pixel public state from GET /api/region?meta=1 and GET /api/pixel/:x/:y. */
export interface PixelMeta {
  x: number;
  y: number;
  c: number;
  n: number;
  /** Cost to repaint right now = price(n). */
  price_next: number;
  immune_until: number;
  payer: string | null;
  /** Basename/ENS, best-effort. */
  name: string | null;
  handle: string | null;
  url: string | null;
  placed_at: number;
}

export interface RegionMetaResponse {
  seq: number;
  pixels: PixelMeta[];
}

/** A single pixel change on the WS diff stream (04-API §W2). */
export interface DiffPixel {
  x: number;
  y: number;
  c: number;
  kind: DiffKind;
}

/** A decoded W2 frame. */
export interface DiffFrame {
  version: number;
  /** Monotonically increasing, global. */
  seq: number;
  pixels: DiffPixel[];
}

/** First frame on WS /api/live (JSON text). */
export interface HelloFrame {
  hello: true;
  seq: number;
}

/** Protocol error codes (03-PROTOCOL §6, 04-API). */
export const ErrorCode = {
  PAYMENT_REQUIRED: 'PAYMENT_REQUIRED',
  INVALID_JOB: 'INVALID_JOB',
  TOO_MANY_PIXELS: 'TOO_MANY_PIXELS',
  QUOTE_EXPIRED: 'QUOTE_EXPIRED',
  QUOTE_INVALID: 'QUOTE_INVALID',
  QUOTE_CONSUMED: 'QUOTE_CONSUMED',
  IMMUNE: 'IMMUNE',
  CAS_STALE: 'CAS_STALE',
  SETTLING: 'SETTLING',
  FROZEN: 'FROZEN',
  RATE_LIMITED: 'RATE_LIMITED',
  SETTLEMENT_FAILED: 'SETTLEMENT_FAILED',
  TURNSTILE_FAILED: 'TURNSTILE_FAILED',
  COOLDOWN: 'COOLDOWN',
  NOT_BLANK: 'NOT_BLANK',
  /** Free paint into a quarantined region (08-MODERATION). Paid paint is unaffected. */
  QUARANTINED: 'QUARANTINED',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * A pixel named in an error body (03-PROTOCOL §6): the coordinate plus whatever the
 * server can say about why it was refused. No colour — the offender is a position on
 * the canvas, not a placement, and requiring `c` here forced casts at every call site.
 */
export interface ErrorPixel {
  x: number;
  y: number;
  /** Current repaint index, on CAS_STALE. */
  n?: number;
  /** When the pixel becomes paintable, on IMMUNE. */
  immune_until?: number;
}

export interface ApiError {
  error: ErrorCode;
  detail?: string;
  pixels?: ErrorPixel[];
  retry_after_ms?: number;
}
