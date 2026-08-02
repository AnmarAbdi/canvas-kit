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
};
export function isDiffKind(k) {
    return k === 0 || k === 1 || k === 2 || k === 3;
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
};
