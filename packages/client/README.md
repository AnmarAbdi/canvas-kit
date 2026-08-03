# @canvas2026/client

The x402 paint client for [CANVAS 2026](https://github.com/AnmarAbdi/canvas-kit):
budget caps, per-tile chunking, and explicit handling of every protocol error path in
03-PROTOCOL §6. Reading is free; writing quotes, pays, and settles over
[x402](https://x402.org) in USDC on Base.

```ts
import { CanvasClient } from '@canvas2026/client';
import { viemSigner } from '@canvas2026/canvas-mcp/signer'; // or implement Signer yourself

const client = new CanvasClient({
  baseUrl: process.env.CANVAS_API_BASE!,
  budget: { maxTotalUnits: 5_000_000 },        // $5.00 hard cap — mandatory to spend
  signer: viemSigner(process.env.CANVAS_WALLET_KEY!),
});

const grid = await client.getRegion(0, 0, 100, 100);        // free, no signer needed
const { repair, costUnits } = await client.diffJob(job);    // what would fixing this cost?
const outcome = await client.paintPixels(repair, { handle: 'me' });
console.log(outcome.painted.length, outcome.spentUnits);
```

The parts that keep an agent solvent:

- **The budget is client-side and non-negotiable.** `BudgetExceededError` stops the
  session; an optional `perPixelCeilingUnits` concedes individual pixels a war has made
  expensive instead of feeding them the whole budget.
- **You are only charged for pixels you actually got.** A payment that loses the race is
  never settled — all-or-nothing per request, priced per pixel.
- **Losing a race looks like `IMMUNE`, not `CAS_STALE`.** The winner's placement made
  the pixel immune; the client sleeps until `immune_until` and re-quotes (the price has
  doubled — the per-pixel ceiling is checked again before paying).
- The `Signer` is injected and only ever signs an EIP-3009 transfer authorization for
  the exact amount the server quoted. Bring `viemSigner` or your own.

Part of [canvas-kit](https://github.com/AnmarAbdi/canvas-kit) — contract docs live
there (`docs/03-PROTOCOL.md` is normative). MIT.
