# 04 — API (public HTTP + WS contract)

Base URL: `[DECIDE: domain]`. All reads are free, cacheable, and CDN-served — reading
is free, writing costs; agents need cheap eyes. All writes are gated (Turnstile for
free, x402 for paid). CORS: reads `*`; writes restricted to the site origin for the
free path, unrestricted for the paid path (agents call from anywhere).

## Reads

### `GET /api/canvas`
Full binary snapshot. Body: wire format §W1. Headers: `X-Canvas-Seq` (global diff
sequence at snapshot time), `Cache-Control: public, max-age=2`. ~250 KB at launch size.

### `GET /api/region?x=&y=&w=&h=`
Binary color grid for a sub-rect (§W1 layout, w×h bytes) — `?meta=1` switches to JSON:

```jsonc
{ "seq": 123456, "pixels": [
  { "x":1,"y":2,"c":7,"n":4,"price_next":160000,"immune_until":1757000060000,
    "payer":"0x1a2b…3c4d","name":"basename.base.eth|null","handle":"…|null",
    "url":"…|null","placed_at":1757000000000 } ] }
```
`price_next` = cost to repaint now. `immune_until` public by design (fair races).
Max region 250×250 per request for meta mode; binary mode unlimited within canvas.

### `GET /api/pixel/:x/:y`
Full state + last 20 history entries (`?full=1` pages the complete history).

### `POST /api/quote`
Free estimation. Body `{ pixels: [{x,y,c}] }` (≤ `BULK_MAX_PIXELS`) → per-pixel
`{n, price_units}` + `total_units`. **Not part of the payment path** — the 402 on
`/api/paint` is the binding quote (03-PROTOCOL §2). Per-IP rate-limited.

### `GET /api/ledger?limit=`
Top patrons by cumulative settled spend, keyed by payer address (name-resolved),
never by handle. Screenshot bait; cache 30s.

### `GET /api/stats`
Aggregates for the stat-bot: total settled volume, most expensive pixel, repaint
depth histogram, pixels-touched %, largest single settlement. Cache 60s.

### Snapshots
`GET /snapshots/index.json`, `GET /snapshots/{ISO-hour}.png` — hourly, R2-backed, free.

## Writes

### `POST /api/paint`  (x402 v2 — see 03-PROTOCOL, normative)
Body: `{ canvas:"2026", version:1, pixels:[{x,y,c}], handle?, url? }` — `handle`/`url`
apply to every pixel in the request (a "block" is just a bulk placement with shared
metadata). Unpaid → 402 quote. Paid + valid → 200 `{ receipt, pixels: [new state] }`.

### `POST /api/free-paint`
Body `{ x, y, c, handle?, turnstile_token }` + session cookie. One pixel per call.
Errors: `403 TURNSTILE_FAILED`, `429 COOLDOWN` (`retry_after_ms`), `409 NOT_BLANK`
(pixel was painted at any point — free tier is blank-only, no exceptions), `409 IMMUNE`,
`410 FROZEN`. No URL field exists on this endpoint (01-CONSTANTS: locked).

## Realtime

### `WS /api/live`
Subscribe to diff broadcast. Server → client frames, binary (§W2), in `seq` order.
On connect: `{ hello, seq }` JSON text frame; client then fetches `/api/canvas`
and applies buffered diffs with `seq >` snapshot's. Client → server: nothing
(read-only socket; writes only via HTTP). Heartbeat ping 30s. Reconnect with
`?since=seq` replays from the ring buffer when possible, else instructs re-snapshot.

## Wire formats

### W1 — snapshot / region grid
Row-major `w×h` bytes, one palette index per pixel, no header (dimensions come from
the request/canvas constants). Palette index → hex via `palette.json` (kit package).

### W2 — diff frame (binary WS frame)
```
u8  version = 1
u32 seq            // monotonically increasing, global
u16 count
repeat count: { u16 x, u16 y, u8 c, u8 kind }   // kind: 0 free, 1 paid, 2 moderated, 3 reverted
```
Byte order: **big-endian** (network byte order) for every multi-byte field (`seq`,
`x`, `y`). Frame length is exactly `7 + 6*count` bytes; a decoder MUST reject any
frame whose length disagrees with the declared `count`, whose `version` it does not
know, whose color byte is outside the palette, or whose `kind` is not 0–3.
Metadata (payer, price) is NOT in the hot diff stream — hover fetches
`/api/region?meta=1` lazily. Keeps the stream tiny under war load.

## Rate limits (unpaid surfaces only)
Per-IP: `/api/quote` 60/min; `/api/free-paint` governed by session cooldown + Turnstile;
meta reads 120/min; binary reads effectively uncapped (CDN). Paid writes are
money-gated by design — no additional caps.

## Versioning
`X-Canvas-Api: 1` on every response. Breaking changes bump the header and the
`version` field in job/paint bodies; the kit pins compatible versions.
