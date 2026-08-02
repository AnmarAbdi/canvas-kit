# 01 — CONSTANTS (public game rules)

Single source of truth for every game-rule value. **No agent may invent, assume, or
inline a number that belongs here.** Code imports these from `packages/shared/constants.ts`,
which is generated from this file and reviewed by a human on every change. Changing a
value is a one-line PR here + regeneration; "patch notes" are published content.

Server-internal tunables (tile size, cache TTLs, rate limits) live in
`canvas-server/docs/05-ARCHITECTURE.md` — they are not game rules.

## Canvas

| Key | Value | Notes |
|---|---|---|
| `CANVAS_W` × `CANVAS_H` | 500 × 500 | Launch size. Expansions are post-launch (see spec §2). |
| `ORIGIN` | (0,0) top-left | x→right, y→down |
| `PALETTE` | 32 colors, 1 byte/pixel | **LOCKED**: the r/place 2022 palette — full hex list in `packages/shared/src/palette.json` (source: lospec.com/palette-list/r-place-2022-32-colors, cross-checked against place-wiki.stefanocoding.me). Index 0 = `#FFFFFF` = blank/white. Order is wire order and is frozen: an index is a byte in every snapshot, so entries may never be reordered or removed — only a new canvas gets a new palette. |

## Pricing (paid API)

| Key | Value | Notes |
|---|---|---|
| `PRICE_BASE_UNITS` | 10_000 | USDC atomic units (6 decimals) = $0.01. First paint of a blank pixel via API, n=0. |
| `price(n)` | `min(PRICE_BASE_UNITS << n, PLATEAU_UNITS)` | n = repaint index of THIS placement (pixel's current `n`). Integer math only, no floats anywhere in money code. |
| `PLATEAU_UNITS` | 10_240_000 | = $10.24, reached at n=10. Every repaint at n≥10 costs exactly this. |
| `BULK_MAX_PIXELS` | 1_000 | Per paint request, priced per pixel individually. |

Moderation repaints do NOT increment `n` (see canvas-server/docs/08-MODERATION.md).

## Immunity

| Key | Value | Notes |
|---|---|---|
| `IMMUNITY_MS` | 60_000 | After ANY placement (free or paid), pixel is unpaintable by anyone. |
| `IMMUNITY_MS_DECEMBER` | 30_000 | Applies to placements committed at/after `DECEMBER_SWITCH_AT`. Pre-announced, never stealth. |
| `DECEMBER_SWITCH_AT` | `2026-12-01T00:00:00.000Z` | |

Immunity is per-pixel state (`immune_until` timestamp), checked lazily at write time.
No timers, no alarms. `immune_until` is public in region metadata so every bot can
time the race off identical information.

## Free tier (browser humans)

| Key | Value | Notes |
|---|---|---|
| `FREE_COOLDOWN_MS` | 30_000 | 1 pixel / 30s per session. |
| Free eligibility | blank pixels only (`n_total == 0` and never painted) | |
| Free URL attachment | **none** | LOCKED (spec §11 resolved): URLs are a paid privilege. |
| Session | Turnstile token + signed cookie, no accounts | |

## Attribution

| Key | Value | Notes |
|---|---|---|
| `HANDLE_MAX_CHARS` | 24 | Self-reported vanity layer, rendered in quotes as unverified. |
| Payer identity | wallet address from the x402 payment, always recorded for paid placements | Truth layer. Displayed truncated (`0x1a2b…3c4d`), reverse-resolved to Basename/ENS when available (cached, best-effort). |
| URLs | paid placements only; `rel=nofollow`; interstitial for off-site | |

## Payments

| Key | Value | Notes |
|---|---|---|
| Protocol | x402 **v2** (`PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE` headers) | Accept legacy v1 `X-PAYMENT` header as fallback. See 03-PROTOCOL. |
| Scheme | `exact` | |
| Network (prod) | `eip155:8453` | x402 v2 identifies networks by CAIP-2, not by the v1 names (`base`). Verified against `@x402/core` 2.20 / `@x402/evm` 2.x. |
| Network (staging) | `eip155:84532` (Base Sepolia, Circle faucet test USDC) | |
| Asset (prod) | USDC on Base: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | EIP-712 domain **`name: "USD Coin"`, `version: "2"`**, 6 decimals |
| Asset (staging) | USDC on Base Sepolia: `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `[VERIFIED 2026-08]` against `@x402/evm` + a live facilitator call. EIP-712 domain **`name: "USDC"`, `version: "2"`**, 6 decimals. **The domain name differs from prod** — it is part of the signature, so the wrong one is rejected. The server publishes it in `accepts[0].extra`; clients MUST sign with what the server sent, never a hardcoded name. |
| Facilitator | Coinbase CDP (fee-free USDC/Base) | `[VERIFIED 2026-08]` `https://api.cdp.coinbase.com` + route `/platform/v2/x402` → `/verify`, `/settle`. Auth: per-request `Bearer` JWT from a CDP API key id/secret. URL is config-swappable (`FACILITATOR_URL` secret/env), never hardcoded. |
| `QUOTE_TTL_MS` | 30_000 | Quote nonce lifetime. |

## The freeze

| Key | Value | Notes |
|---|---|---|
| `FREEZE_AT` | `2027-01-01T00:00:00.000Z` | Writes valid iff Durable Object commit timestamp `< FREEZE_AT`. Strict. One global moment (spec §2: UTC, no midnight wave). |
| Post-freeze | reads forever, zero writes, **zero settlements** | A payment that has not settled before `FREEZE_AT` is never settled. |
| Endgame rule (public, on rules page) | immunity carries through the freeze; the last committed write wins | The final 30 seconds are a snipe war, on purpose. |

## Launch

| Key | Value | Notes |
|---|---|---|
| `LAUNCH_AT` | `[DECIDE]` | Needed ~1 wk pre-launch for Turnstile/CORS/domain config. |
| Domain / name | `[DECIDE]` | Standalone vs 2026.uhqi.club — parked. |
