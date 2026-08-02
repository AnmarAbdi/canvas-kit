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
import { type Job, type Pixel, type PixelMeta, type Receipt } from '@canvas2026/shared';
export declare const TILE_SIZE = 100;
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
export declare class BudgetExceededError extends Error {
    readonly requestedUnits: number;
    readonly remainingUnits: number;
    constructor(requestedUnits: number, remainingUnits: number);
}
export declare class PixelTooExpensiveError extends Error {
    readonly pixel: Pixel;
    readonly priceUnits: number;
    readonly ceilingUnits: number;
    constructor(pixel: Pixel, priceUnits: number, ceilingUnits: number);
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
    skipped: {
        pixel: Pixel;
        reason: string;
    }[];
    spentUnits: number;
    receipts: Receipt[];
}
export declare class CanvasClient {
    private readonly opts;
    private spent;
    private readonly fetchImpl;
    private readonly sleep;
    private readonly now;
    private readonly maxPerRequest;
    constructor(opts: ClientOptions);
    get spentUnits(): number;
    get remainingUnits(): number;
    getRegion(x: number, y: number, w: number, h: number): Promise<Uint8Array>;
    getRegionMeta(x: number, y: number, w: number, h: number): Promise<PixelMeta[]>;
    quote(pixels: Pixel[]): Promise<{
        pixels: {
            x: number;
            y: number;
            n: number;
            price_units: number;
        }[];
        total_units: number;
    }>;
    /** Pixels of `job` that differ from the canvas right now, plus what repairing costs. */
    diffJob(job: Job): Promise<{
        repair: Pixel[];
        costUnits: number;
    }>;
    /**
     * Paint pixels, chunked, with every 03-PROTOCOL §6 error handled. Returns what
     * landed and what was skipped; throws only on a budget violation or a terminal
     * server state (frozen), because those are decisions the caller must not miss.
     */
    paintPixels(pixels: Pixel[], options?: {
        handle?: string;
        url?: string;
        maxAttemptsPerChunk?: number;
    }): Promise<PaintOutcome>;
    private paintChunk;
    /** 03-PROTOCOL §6, one branch per row of the table. */
    private handleFailure;
    private buildPayment;
}
export declare function boundingBox(pixels: Pixel[]): {
    x: number;
    y: number;
    w: number;
    h: number;
} | null;
/**
 * Split into requests that never straddle a tile and never exceed `maxPerRequest`.
 * Same-tile batching is what keeps a request from failing because an unrelated pixel
 * in another tile lost its race (03-PROTOCOL §4's all-or-nothing rule).
 */
export declare function chunkByTile(pixels: Pixel[], maxPerRequest: number): Pixel[][];
/** Cost of painting these pixels at their current repaint indices. */
export declare function estimateUnits(metas: {
    n: number;
}[]): number;
