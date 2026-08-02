/**
 * CANVAS 2026 — game rules.
 *
 * GENERATED FROM: canvas-kit/docs/01-CONSTANTS.md (that doc is the single source of
 * truth). Do not change a value here without changing it there first; the doc-sync
 * test (test/constants.doc.test.ts) fails the build if the two drift.
 *
 * Server-internal tunables (tile size, cache TTLs, rate limits) do NOT belong here —
 * they live in canvas-server/docs/05-ARCHITECTURE.md.
 *
 * Money is integer USDC atomic units (6 decimals). No floats. Time is epoch ms, UTC.
 */
// ---------------------------------------------------------------- Canvas
export const CANVAS_W = 500;
export const CANVAS_H = 500;
/** Origin (0,0) is top-left; x→right, y→down. */
export const ORIGIN_X = 0;
export const ORIGIN_Y = 0;
/** 32 colors, one byte per pixel. Hexes live in palette.json. */
export const PALETTE_SIZE = 32;
/** Palette index 0 is blank/white — free-tier eligibility is defined off "never painted", not off this. */
export const BLANK_COLOR_INDEX = 0;
// ---------------------------------------------------------------- Pricing
/** $0.01 in USDC atomic units. Price of painting a blank pixel via the paid API (n=0). */
export const PRICE_BASE_UNITS = 10_000;
/** $10.24 — the price ceiling, reached at n=10 and charged for every repaint at n>=10. */
export const PLATEAU_UNITS = 10_240_000;
/** Repaint index at which price(n) reaches PLATEAU_UNITS (derived, asserted in tests). */
export const PLATEAU_N = 10;
/** Max pixels in one paint request; each pixel is priced individually. */
export const BULK_MAX_PIXELS = 1_000;
/**
 * price(n) = min(PRICE_BASE_UNITS << n, PLATEAU_UNITS)
 *
 * `n` is the repaint index of THIS placement, i.e. the pixel's CURRENT repaint index
 * at commit time (01-CONSTANTS "Pricing"). Integer math only.
 *
 * Implemented as capped doubling rather than `<<` on purpose: `n` is a u16 in storage
 * (02-DATA) and JS `<<` is 32-bit, so shifting would wrap for large n instead of
 * saturating at the plateau.
 */
export function price(n) {
    if (!Number.isInteger(n) || n < 0) {
        throw new RangeError(`price(n): n must be a non-negative integer, got ${n}`);
    }
    let p = PRICE_BASE_UNITS;
    for (let i = 0; i < n; i++) {
        p *= 2;
        if (p >= PLATEAU_UNITS)
            return PLATEAU_UNITS;
    }
    return p;
}
/** Total price for a list of repaint indices. Integer sum; no floats. */
export function priceTotal(ns) {
    let total = 0;
    for (const n of ns)
        total += price(n);
    return total;
}
// ---------------------------------------------------------------- Immunity
/** After ANY placement (free or paid), the pixel is unpaintable by anyone for this long. */
export const IMMUNITY_MS = 60_000;
/** Applies to placements committed at/after DECEMBER_SWITCH_AT. Pre-announced, never stealth. */
export const IMMUNITY_MS_DECEMBER = 30_000;
/** 2026-12-01T00:00:00.000Z */
export const DECEMBER_SWITCH_AT = Date.UTC(2026, 11, 1);
/** Immunity window that applies to a placement committed at `committedAt` (epoch ms). */
export function immunityMsAt(committedAt) {
    return committedAt >= DECEMBER_SWITCH_AT ? IMMUNITY_MS_DECEMBER : IMMUNITY_MS;
}
/** immune_until for a placement committed at `committedAt` (epoch ms). */
export function immuneUntil(committedAt) {
    return committedAt + immunityMsAt(committedAt);
}
// ---------------------------------------------------------------- Free tier
/** One free pixel per session per this interval. */
export const FREE_COOLDOWN_MS = 30_000;
/** Free placements attach no URL, ever. LOCKED (01-CONSTANTS, D6). */
export const FREE_URL_ALLOWED = false;
// ---------------------------------------------------------------- Attribution
/** Self-reported vanity handle, rendered in quotes as unverified. */
export const HANDLE_MAX_CHARS = 24;
// ---------------------------------------------------------------- Payments
export const X402_VERSION = 2;
export const X402_SCHEME = 'exact';
/** Canonical v2 headers; v1 fallbacks are accepted/mirrored by the server (03-PROTOCOL §2). */
export const HEADER_PAYMENT_REQUEST = 'PAYMENT-SIGNATURE';
export const HEADER_PAYMENT_RESPONSE = 'PAYMENT-RESPONSE';
export const HEADER_PAYMENT_REQUEST_V1 = 'X-PAYMENT';
export const HEADER_PAYMENT_RESPONSE_V1 = 'X-PAYMENT-RESPONSE';
/**
 * x402 v2 identifies networks by CAIP-2, not by the v1 short names ('base').
 * Verified against @x402/core 2.20 / @x402/evm 2.x at implementation time.
 */
export const NETWORK_PROD = 'eip155:8453';
export const NETWORK_STAGING = 'eip155:84532';
/** USDC on Base (mainnet). EIP-3009 domain version '2'. */
export const USDC_ADDRESS_PROD = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
/** USDC on Base Sepolia. [VERIFIED 2026-08] against @x402/evm's stablecoin registry. */
export const USDC_ADDRESS_STAGING = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
/** USDC atomic units: 6 decimals. */
export const USDC_DECIMALS = 6;
/** EIP-712 domain version of both USDC deployments (needed to verify EIP-3009 sigs). */
export const USDC_EIP712_VERSION = '2';
/**
 * EIP-712 domain NAME of the USDC contract — and it is NOT the same on both networks.
 * Base mainnet is "USD Coin"; Base Sepolia is "USDC". The name is part of the signed
 * domain separator, so getting it wrong produces a signature the facilitator rejects.
 * Verified against @x402/evm's stablecoin registry and confirmed by a live 400 from the
 * CDP facilitator ("missing EIP-712 domain name/version in requirements.extra").
 */
export const USDC_EIP712_NAME_PROD = 'USD Coin';
export const USDC_EIP712_NAME_STAGING = 'USDC';
/** Asset + network + signing domain for an environment. Keeps callers from pairing a
 *  testnet id with a mainnet asset, or either with the wrong domain name. */
export function paymentTarget(staging) {
    return staging
        ? {
            network: NETWORK_STAGING,
            asset: USDC_ADDRESS_STAGING,
            eip712: { name: USDC_EIP712_NAME_STAGING, version: USDC_EIP712_VERSION },
        }
        : {
            network: NETWORK_PROD,
            asset: USDC_ADDRESS_PROD,
            eip712: { name: USDC_EIP712_NAME_PROD, version: USDC_EIP712_VERSION },
        };
}
/** CDP facilitator route prefix. Base URL is config (FACILITATOR_URL), never hardcoded. */
export const FACILITATOR_ROUTE_PREFIX = '/platform/v2/x402';
/** Quote nonce lifetime. */
export const QUOTE_TTL_MS = 30_000;
// Facilitator URL is deliberately NOT here: it is config (FACILITATOR_URL), never
// hardcoded (01-CONSTANTS "Payments", 03-PROTOCOL §1).
// ---------------------------------------------------------------- The freeze
/** 2027-01-01T00:00:00.000Z. Writes are valid iff the DO commit timestamp is strictly before this. */
export const FREEZE_AT = Date.UTC(2027, 0, 1);
/** The freeze test, in one place. Strict `<` for writes means `>=` is frozen. */
export function isFrozen(committedAt) {
    return committedAt >= FREEZE_AT;
}
// ---------------------------------------------------------------- Launch
/** [DECIDE] — needed ~1 wk pre-launch for Turnstile/CORS/domain config. */
export const LAUNCH_AT = null;
/** [DECIDE] — standalone vs 2026.uhqi.club. Base URL is config until then. */
export const CANVAS_DOMAIN = null;
/** Canvas identifier carried in job/quote/paint bodies. */
export const CANVAS_ID = '2026';
/** X-Canvas-Api header value / `version` field in job bodies (04-API "Versioning"). */
export const API_VERSION = 1;
