# 07 — AGENT KIT (the front door)

The kit is the distribution strategy: "the first fun thing you hand your agent a
wallet for." Everything in this repo is open source. The kit MUST work against the
public API with zero private access — it is also the canonical integration test of
that API.

Deliverables (packages in this repo):

## 1. `job.json` (format v1)

Produced by the site's converter, consumed by every tool below.

```jsonc
{
  "yearbook": "2026",
  "version": 1,
  "name": "my-logo",                    // optional label
  "pixels": [ { "x": 120, "y": 88, "c": 7 }, ... ],
  "est_cost_units": 4120000,            // advisory snapshot from /api/quote at export
  "est_cost_at": "2026-09-14T12:00:00Z" // prices move; never trust this at paint time
}
```

## 2. `yearbook-mcp` (MCP server)

Runs on the USER's machine; wraps the public HTTP API; signs payments with the
user's wallet (env: `YEARBOOK_WALLET_KEY`, or a CDP/managed signer — never sent to us).
x402 v2 client headers; tolerate v1 servers if `FACILITATOR`-side quirks demand.

Tools:
| Tool | Args | Behavior |
|---|---|---|
| `get_region` | x,y,w,h,meta? | GET /api/region |
| `quote` | pixels[] \| job | POST /api/quote → per-pixel prices + total |
| `paint_pixels` | pixels[], handle?, url?, max_total_units | Full 402 flow. HARD-refuses if quote total > `max_total_units` (budget cap is client-side and mandatory — an agent must never sign an unbounded payment). Chunks per 03-PROTOCOL §4. |
| `diff_job` | job | Fetch current region(s), return pixels whose color ≠ job (the repair set) + current repair cost |
| `get_stats` | — | GET /api/stats (gives agents taunting material) |

## 3. Reference painter (`examples/painter.ts`, `examples/painter.py`)

Loop: load job → `diff_job` → chunk (per tile; ≤50 px per request in contested
regions) → paint each chunk with budget check → handle `409`s per 03-PROTOCOL §6
→ sleep → repeat until diff empty or budget spent.

**Losing a race looks like `IMMUNE`, not `CAS_STALE`.** When somebody paints the pixel
first, their placement also makes it immune, so that is the rejection you get: sleep
until `immune_until`, re-diff (the pixel may now be the colour you wanted anyway), and
re-quote — the price will have doubled, so check it against your per-pixel ceiling
before paying. `CAS_STALE` is handled by the client for completeness but is not
reachable while `QUOTE_TTL_MS ≤ immunity` (03-PROTOCOL §6); do not build retry logic
that depends on seeing it.
Every error path in 03-PROTOCOL §6 is exercised and commented — the painter doubles
as protocol documentation.

## 4. Reference defender (`examples/defender.ts`) — the open-source Guardian

There is no hosted defense product. This is the same weapon for everyone:

- Input: `job.json` + `budget_units` + optional `per_pixel_ceiling_units`.
- Subscribes to `WS /api/live`; on any diff intersecting the job's bounding boxes,
  computes the repair set, waits out `immune_until` per pixel, repairs at market
  price within budget.
- Alerting hook (webhook/stdout) on: budget 50%/90% consumed, repair failed at
  ceiling, sustained attack (>N flips/min).
- Honest limitations documented inline: races are won by latency and budget, not
  privilege; the house runs no privileged bot.

## 5. x402 wallet setup (README section)

Shortest path for a human reader: create a wallet, fund USDC on Base, export key to
env, run painter. Staging: `base-sepolia` + Circle faucet. Point to upstream x402
client libs rather than vendoring; pin versions. `[VERIFY at implementation]`:
current package names/majors for the x402 v2 client SDK and Coinbase facilitator
config — the ecosystem moves fast; agents must check docs, not training memory.

## 6. Non-goals

No hosted runners, no key custody, no strategy AI (drawing strategy is the user's
agent's job — the kit is hands, not brains). No private endpoints: if the kit needs
a capability, it becomes a public API feature first.
