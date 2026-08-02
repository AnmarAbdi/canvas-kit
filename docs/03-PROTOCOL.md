# 03 — PROTOCOL (paint, pay, race, freeze)

This is the money document. Every rule here is normative. If code and this doc
disagree, the code is wrong. Agents implementing this MUST also implement the test
matrix in §7 — the interleavings are the spec.

Design invariants inherited from 00-SPEC:
- Overwriting is never free; price escalates per pixel to a plateau (01-CONSTANTS).
- Payment is verify-then-settle: **a payment is settled if and only if its write
  committed.** No refund flows exist because losing payments are never settled.
- The freeze is absolute: no write commits and no payment settles at/after `FREEZE_AT`.

## 1. Roles

- **Client**: any x402-capable caller (agent loop, MCP server, script, browser wallet).
- **Server**: Cloudflare Worker + per-tile Durable Objects (see canvas-server docs).
- **Facilitator**: verifies payment payloads (`POST /verify`) and submits settlement
  (`POST /settle`). Holds no funds. URL is config (`FACILITATOR_URL`).

## 2. Canonical paid flow (single round trip of standard x402 v2)

The 402 response IS the quote. `GET /api/quote` exists only as a free convenience
for cost estimation (04-API); it is not part of the payment path.

```
Client                        Server                          Facilitator
  | POST /api/paint {job}       |                                 |
  |---------------------------->|                                 |
  |                             | compute per-pixel n + price     |
  |                             | build signed Quote (§3)         |
  | 402 + paymentRequirements   |                                 |
  |<----------------------------|                                 |
  | sign payment (wallet)       |                                 |
  | POST /api/paint {job}       |                                 |
  |   PAYMENT-SIGNATURE: <...>  |                                 |
  |---------------------------->|                                 |
  |                             | validate Quote sig + TTL        |
  |                             | POST /verify ------------------>|
  |                             |<----------- valid ------------- |
  |                             | per-tile DO: CAS write (§4)     |
  |                             | POST /settle ------------------>|
  |                             |<----------- settled ----------- |
  | 200 + PAYMENT-RESPONSE      |                                 |
  |   + receipt + new state     |                                 |
  |<----------------------------|                                 |
```

Header compatibility: v2 `PAYMENT-SIGNATURE` (request) / `PAYMENT-RESPONSE` (response)
is canonical. Servers MUST also accept v1 `X-PAYMENT` and mirror `X-PAYMENT-RESPONSE`
for legacy clients. The kit's reference clients emit v2.

## 3. The Quote (stateless, signed, single-use)

The 402 body's `accepts[0].extra.quote` is an HMAC-signed blob (key: `QUOTE_HMAC_KEY`,
server secret, rotatable):

```jsonc
{
  "v": 1,
  "qid": "ulid",                 // unique quote id
  "canvas": "2026",
  "pixels": [{ "x": 0, "y": 0, "c": 7, "n": 3, "p": 80000 }, ...],
  // n = expected repaint index at commit time; p = price units for THIS repaint
  "total": 1234000,              // MUST equal accepts[0].amount (v2) — atomic USDC units
  "iat": 1757000000000,
  "exp": 1757000030000           // iat + QUOTE_TTL_MS
}
```

Rules:
- Stateless verification: signature + `exp` check. No storage on issue.
- **Single-use**: on successful settle, `qid` enters a consumed-set (per-tile DO,
  entries evicted after `exp`). A replayed `qid` → `422 QUOTE_CONSUMED`.
- **Idempotency is separate from the consumed-set and lives at the Worker layer**,
  keyed by `qid`, holding the composed `200` response (receipt + new pixel state) for
  10 min. A request spans one or more tiles but has exactly one `qid` and exactly one
  receipt, so no single tile can own the canonical response. Order on a retry:
  Worker checks the idempotency cache BEFORE any tile work — a cache hit replays the
  stored `200` verbatim (interleaving #10) and never re-enters the commit path; a miss
  proceeds, and the tiles' consumed-set is what makes a *late* replay `422`
  (interleaving #4) once the cache entry has expired.
- **Binding.** The `exact` scheme's signature is an EIP-3009 authorization covering
  exactly `(from, to, value, validAfter, validBefore, nonce)` — there is nowhere in it
  to sign over a server blob. So the quote is bound to the payment on the server side,
  not inside the signature:
  - the client echoes the quote token back in the `X-Canvas-Quote` header (04-API);
  - the server rebuilds `PaymentRequirements` **from its own signed quote** and sends
    those to `/verify` and `/settle` — never the client's copy;
  - the server MUST reject, before calling the facilitator, any payload whose
    `accepted` block disagrees with those requirements on `extra.qid`, `amount`,
    `asset`, `payTo`, `network` or `scheme`.
  The signature is therefore verified against terms the server chose, and `qid`
  (carried in `extra`, which is part of the verified requirements) is what ties one
  payment to one quote.
- A quote does NOT reserve anything. Reservation is decoration; CAS is the truth.

## 4. Commit rules (per-tile Durable Object, serialized)

Pixels in a request are grouped by tile. Each tile DO applies its group atomically
under its single-threaded execution. Per pixel, ALL must hold at commit time `t`:

1. `t < FREEZE_AT`
2. pixel not `SETTLING` (§5)
3. `t >= immune_until`
4. pixel's current repaint index `== n` from the quote (the CAS)

**All-or-nothing per request.** If any pixel in the request fails any check, the
entire request fails, nothing is written, and the payment is NOT settled — the
client receives a fresh 402 with a recomputed quote (or a terminal error, §6).
Rationale: the `exact` scheme settles the full amount or nothing; partial delivery
would require refunds, which do not exist.

Consequence (document loudly in 07-AGENT-KIT): large jobs in contested regions
livelock if submitted as one request. Reference clients MUST chunk — by tile, and
in hot zones down to small batches — and re-diff between attempts.

## 5. Settlement ordering and the SETTLING lock

Order: verify → commit → settle. Each step's failure handling:

- **Verify fails** → no write, no settle → `402` fresh quote.
- **Commit fails** (any §4 rule) → no settle → `402` fresh quote / terminal error.
- **Commit succeeds** → affected pixels are flagged `SETTLING` (immunity already
  covers them for 60s, but `SETTLING` additionally blocks moderation repaints and
  survives if settlement outlasts immunity), **and the diff is broadcast immediately**.
  The pixel is visible from the moment it commits — that is what makes the revert below
  observable rather than silent. Server calls `/settle`.
  - **Settle succeeds** → clear `SETTLING`, append history, return `200` + receipt.
    No second diff: viewers already have this pixel.
  - **Settle fails after bounded retries** (N=3, backoff, hard deadline 20s) →
    **compensating revert**: the tile DO restores the prior pixel state, decrements
    the repaint index back, **broadcasts a second diff with `kind=reverted`**, logs
    `kind=reverted` in history (public — reverts are provenance too), returns
    `502 SETTLEMENT_FAILED` to the payer. The payer was never charged (authorization
    unexecuted, expires on its own).

**Diffs follow the commit; history follows the money.** A committed-then-reverted write
produces two diff frames (the write, then the revert) and exactly one history row
(`kind=reverted`) — never a `kind=paid` row, because nobody paid. That is what keeps
the ledger equal to the settled receipts while the diff stream still tells the truth
about what viewers saw.
- Any paint attempt hitting a `SETTLING` pixel → `409 SETTLING`, `Retry-After: 1`.
- The `/settle` call happens OUTSIDE the DO's request path (queued from the DO,
  awaited by the Worker) — a facilitator stall must never block the tile.

The write-then-settle gap means a briefly-visible pixel can revert on settlement
failure. This is acceptable (rare, logged, sub-minute) and strictly better than the
alternative (settle-then-write can charge for writes that never happen — forbidden).

### 5.1 Orphaned settlements (normative)

A settlement is **orphaned** when the chain shows a transfer to `PAY_TO` for which no
`receipts` row exists. It happens when the Worker dies between `/settle` returning and
the receipt being written — client disconnect, eviction, deploy. The money moved, the
pixel committed, the record did not.

**The chain is authoritative. Orphans are reconciled by backfilling a receipt, never by
refunding.** The payer paid and got their pixel; the only thing missing is our record of
it, and the fix for a missing record is to write it. Refunds do not exist anywhere in
this protocol (§0, D4) and an orphan is not the place to introduce them.

A backfilled receipt is **not** a settled receipt and must never be mistaken for one:

- `source = 'backfill'` (settled rows are `'settled'`). This column is the only
  thing standing between a reconstructed row and a forged one.
- `qid = 'backfill:<tx>'`. Deterministic, so re-running reconciliation is idempotent,
  and prefixed so it can never collide with a real quote id.
- `payer`, `total_units`, `tx`, `ts` come from the transfer log. These are the only
  fields the chain proves.
- `sig` is the literal string `'backfill:unsigned'`. A backfilled row is **never**
  signed with `RECEIPT_SIGNING_KEY`: that key attests "the server issued this receipt
  for these pixels", and for an orphan the server does not know which pixels those
  were. Signing reconstructed data would make the signature meaningless everywhere.
- `pixel_count = 0`, meaning *unknown*. The transfer proves an amount, and because
  price doubles per repaint (§4) an amount does not decompose into a unique set of
  pixels. It is not zero pixels; it is a count we cannot honestly state.

Consequences that follow from the above, and are required:

- The ledger (`/api/ledger`) sums `total_units` over all receipts including backfills —
  the money is real, so it counts. Any per-pixel statistic must exclude
  `source = 'backfill'` rows or it will silently read the unknown count as zero.
- Backfilling adds **no history row**. History is per-pixel provenance and we do not
  know the pixels; an invented row would corrupt the public log to tidy a total. The
  pixel keeps whatever the tile DO committed, which is the truth about the canvas.
- After a backfill, reconciliation reports `RECONCILED` on money and separately reports
  how many rows are backfilled. A rising backfill count is an availability bug in the
  settle path, not a bookkeeping style — it is alarmed on in 09-OPS.

## 6. Errors

| Status | Code | Meaning / client action |
|---|---|---|
| 402 | `PAYMENT_REQUIRED` | Body carries fresh quote. Re-sign and retry. |
| 400 | `INVALID_JOB` | Malformed pixels, out of bounds, bad color index. Fix job. |
| 413 | `TOO_MANY_PIXELS` | > `BULK_MAX_PIXELS`. Chunk. |
| 422 | `QUOTE_EXPIRED` / `QUOTE_INVALID` / `QUOTE_CONSUMED` | Re-request (bare POST) for a fresh 402. |
| 409 | `IMMUNE` | A target pixel is inside its immunity window. Body lists offending pixels + `immune_until`s. Wait, re-diff, retry. |
| 409 | `CAS_STALE` | Repaint index moved (someone painted first). Fresh 402 has the new price. **In practice a client will not see this** — see the note below. |
| 409 | `SETTLING` | Transient. Retry after `Retry-After`. |
| 409 | `QUARANTINED` | Free path only: the region is paid-only (08-MODERATION). Terminal for a free client; paid paint is unaffected and priced as normal. |
| 410 | `FROZEN` | `now >= FREEZE_AT`. Terminal forever. |
| 429 | `RATE_LIMITED` | Per-IP limits on unpaid requests (quotes are free — protected). |
| 502 | `SETTLEMENT_FAILED` | Write reverted, payer not charged. Safe to retry from scratch. |

Error bodies: `{ error: CODE, detail, pixels?: [...], retry_after_ms? }`.

**`CAS_STALE` is a safety mechanism, not a client-visible outcome.** A quote lives
`QUOTE_TTL_MS` (30s), and any placement that moves a pixel's repaint index also makes
that pixel immune for `immunityMsAt()` (60s, or 30s in December). So a racer whose index
went stale is still inside the winner's immunity window when it pays: it is rejected as
`IMMUNE`, and its quote expires before immunity lifts. The CAS check stays exactly where
it is — it is what makes lost updates impossible, and it must not depend on immunity
being configured a particular way — but clients should be written against `IMMUNE`.

## 7. Race interleavings — the test matrix (normative)

Two payers A, B; pixel P at repaint index n. Each row is a required integration test.

| # | Interleaving | Required outcome |
|---|---|---|
| 1 | A and B both hold valid quotes for P@n; A commits first | A: committed+settled. B is refused and never settled. B sees `409 IMMUNE` with A's `immune_until`: A's placement made P immune, and rule 3 is checked before the CAS at rule 4. B waits out the window, re-diffs, and re-quotes at n+1. (The CAS at §4.4 is what *guarantees* B cannot overwrite A; it is simply not the rule B trips first, and with `QUOTE_TTL_MS ≤ immunity` it never can be — see §6.) |
| 2 | A paints P; B attempts within immunity window | B → `409 IMMUNE`, not settled. |
| 3 | A's quote expires before retry | `422 QUOTE_EXPIRED`, nothing written/settled. |
| 4 | A replays a settled quote (`qid` reuse) | `422 QUOTE_CONSUMED`. |
| 5 | A commits; facilitator `/settle` fails all retries | Revert: P restored to prior state and index, history logs exactly one `reverted` row and no `paid` row, A gets `502`, A never charged. Diff stream carries both frames — the commit-time write, then the revert (§5). |
| 6 | B attempts P while A's settle in flight | `409 SETTLING`, retry succeeds/fails on real state afterward. |
| 7 | A's request spans two tiles; tile 2 has one immune pixel | Whole request fails, no pixel in tile 1 written, nothing settled. |
| 8 | A's verify passes; commit time `>= FREEZE_AT` | `410 FROZEN`, never settled. Applies even if the 402 was issued pre-freeze. |
| 9 | Freeze-boundary storm: many valid payments in flight at `FREEZE_AT` | Every commit with DO timestamp `< FREEZE_AT` settles; every other one returns `410` and never settles. Zero settlements timestamped post-freeze — audited invariant. |
| 10 | Duplicate identical request (network retry, same payment header) | Idempotent on `qid`: if already settled, return the original `200` + receipt byte-for-byte from the Worker-level idempotency cache (TTL 10 min, §3), not a double write. After that TTL, the tile consumed-set answers `422 QUOTE_CONSUMED` — never a second write. |

## 8. Receipts

`200` responses include `receipt`: `{ qid, payer, pixels: [{x,y,c,n,p}], total_units,
tx?, committed_at, sig }` where `sig` is a server signature (`RECEIPT_SIGNING_KEY`,
public key published on the rules page). Receipts + on-chain settlement + the public
history log make the canvas its own audit trail.

## 9. Free path (summary — full contract in 04-API)

`POST /api/free-paint` with Turnstile token + session cookie. Server checks: session
cooldown (`FREE_COOLDOWN_MS`), pixel is blank-forever, `< FREEZE_AT`, not immune
(blank pixels can be immune only via moderation repaint-to-blank). Commit path is the
same tile-DO CAS minus payment. Owner recorded as `anon-session` + optional handle.

## 10. Out of scope here

Wire formats and endpoint shapes → 04-API. Storage schema → canvas-server/02-DATA.
Moderation state machine → canvas-server/08-MODERATION.
