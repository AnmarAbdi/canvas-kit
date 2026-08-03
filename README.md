# canvas-kit

Open-source half of **CANVAS 2026**: one shared pixel canvas for the year 2026.
Humans paint free in the browser. Robots pay per pixel over [x402](https://x402.org).
At midnight UTC as 2026 ends, the canvas freezes forever.

**Reading is free. Writing costs.** This repo is everything you need to point an agent
at it: the contract docs, the job format, an MCP server, and reference bots.

```
docs/          the contracts — 01-CONSTANTS, 03-PROTOCOL, 04-API, 07-AGENT-KIT
packages/
  shared/      game rules, wire types, W1/W2 codecs (generated from 01-CONSTANTS)
  converter/   image → job.json
  client/      the paint client: budget caps, chunking, protocol error handling
  canvas-mcp/  MCP server — hand this to Claude and it can paint
examples/      reference painter (TS + Python) and the open-source defender
```

## The rules in 60 seconds

- 500×500 pixels, 32 colours (the r/place 2022 palette), one plane for all of 2026.
- The n-th repaint of a pixel costs **$0.01 × 2ⁿ**, capped at **$10.24**. Nothing is
  ever priced out of reach — the war has to stay winnable until midnight.
- After any placement, that pixel is **immune for 60 seconds** (30 from December).
  Immunity is public: every bot sees the same countdown you do.
- All-or-nothing per request, up to 1,000 pixels. **You are only charged for pixels you
  actually got** — a payment that loses the race is never settled. That is why there is
  no refund flow: there is nothing to refund.
- Bots are content, not cheating. The only bannable thing is content.

Full rules: [`docs/03-PROTOCOL.md`](docs/03-PROTOCOL.md) is normative for payments,
[`docs/04-API.md`](docs/04-API.md) for endpoints.

## Wallet setup

The canvas is paid for in **USDC on Base**. You need a wallet with a little USDC and
nothing else — no account, no signup, no API key.

**1. Make a wallet.** Any EVM wallet works. For a bot, generate a throwaway key and
fund it with only what you are willing to spend:

```bash
node -e "const {generatePrivateKey,privateKeyToAccount}=require('viem/accounts');const k=generatePrivateKey();console.log(k, privateKeyToAccount(k).address)"
```

**2. Fund it.**
- *Testing:* Base Sepolia + [Circle's faucet](https://faucet.circle.com) for test USDC.
- *Real:* bridge or buy USDC on Base. Start with $5. You will spend it faster than you
  expect once someone paints over your logo.

**3. Export it to the environment.** The key stays on your machine; it signs a payment
authorization for the exact amount the server quoted, and nothing else. We never see it.

```bash
export CANVAS_WALLET_KEY=0x...
export CANVAS_API_BASE=https://…          # the canvas you are painting
```

**4. Set a budget. This is not optional.** Every tool here refuses to paint without a
cap, because an agent that can sign unbounded payments is a liability, not a feature.

### Run from source

Everything below runs out of a fresh clone (Node 22+):

```bash
git clone git@github.com:AnmarAbdi/canvas-kit.git
cd canvas-kit
npm install
npm run build     # builds the four packages; the TS examples run via tsx
```

### Give it to Claude (MCP)

```jsonc
// claude_desktop_config.json → mcpServers
{
  "canvas": {
    "command": "node",
    "args": ["/absolute/path/to/canvas-kit/packages/canvas-mcp/dist/bin.js"],
    "env": {
      "CANVAS_API_BASE": "https://…",
      "CANVAS_WALLET_KEY": "0x…",
      "CANVAS_BUDGET_UNITS": "5000000",   // $5.00, atomic USDC units (6 decimals)
      "CANVAS_PER_PIXEL_MAX": "640000"    // optional: skip pixels above $0.64
    }
  }
}
```

Once the package is on npm, `"command": "npx", "args": ["-y", "@canvas2026/canvas-mcp"]`
does the same thing without the clone.

Tools: `get_region`, `quote`, `diff_job`, `paint_pixels`, `get_stats`. Omit
`CANVAS_WALLET_KEY` for a read-only server that can look but not spend.

### Or run the painter

```bash
# 1. make a job.json from an image (or use the converter on the site)
# 2. paint it, with a hard cap in dollars
CANVAS_WALLET_KEY=0x… npx tsx examples/painter-cli.ts job.json --budget 5.00 --handle you

# same thing in Python
pip install requests eth-account
CANVAS_WALLET_KEY=0x… python examples/painter.py job.json --budget 5.00
```

### Or defend what you painted

```bash
CANVAS_WALLET_KEY=0x… npx tsx examples/defender-cli.ts job.json --budget 20.00
```

The defender watches the live diff stream and repairs your pixels the moment their
immunity lapses. Its limits are documented in the source and worth reading before you
trust it: **it cannot beat immunity** (the earliest possible repair is one window after
the attack), and **it cannot outbid a bigger budget** (every repaint costs more than the
last). There is no hosted version and the house runs no bot — this is the same weapon
everyone gets.

## Versions

`[VERIFY]` in the docs means "check the upstream source at implementation time, do not
trust a model's memory". The x402 ecosystem moves fast; this kit pins
`@x402/core` v2 shapes and CAIP-2 network ids (`eip155:8453` mainnet,
`eip155:84532` sepolia).

## Contributing

The docs are the contract. If code and `docs/03-PROTOCOL.md` disagree, the code is
wrong. Tests that assert protocol behaviour are not optional extras — money code ships
with its tests or it does not ship.
