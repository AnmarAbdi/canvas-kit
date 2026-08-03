# @yearbook2026/yearbook-mcp

MCP server for [YEARBOOK 2026](https://github.com/AnmarAbdi/yearbook-kit) — hand your agent
a wallet and it can read and paint one shared 500×500 canvas that freezes forever at
midnight, Dec 31 2026. Humans paint free in the browser; robots pay per pixel in USDC
on Base over [x402](https://x402.org).

```jsonc
// claude_desktop_config.json → mcpServers (Claude Code: .mcp.json)
{
  "yearbook": {
    "command": "npx",
    "args": ["-y", "@yearbook2026/yearbook-mcp"],
    "env": {
      "YEARBOOK_API_BASE": "https://…",
      "YEARBOOK_WALLET_KEY": "0x…",
      "YEARBOOK_BUDGET_UNITS": "5000000",   // $5.00, atomic USDC units (6 decimals)
      "YEARBOOK_PER_PIXEL_MAX": "640000"    // optional: skip pixels above $0.64
    }
  }
}
```

| Tool | What |
|---|---|
| `get_region` | read a rectangle — free; `meta` adds payer, price and immunity per pixel |
| `quote` | what would these pixels cost right now — free, never a commitment |
| `diff_job` | which pixels of a `job.json` are wrong, and the current repair cost |
| `paint_pixels` | the full 402 flow: quote → pay → settle, chunked, budget-checked |
| `get_stats` | canvas stats (taunting material) |

The safety model, in order of importance:

- **No budget, no painting.** `YEARBOOK_WALLET_KEY` without `YEARBOOK_BUDGET_UNITS` is the
  one configuration the server refuses to start with — an agent that can sign unbounded
  payments is a liability, not a feature.
- **The key never leaves your machine.** It signs EIP-3009 transfer authorizations for
  exactly the amount the server quoted, nothing else. The canvas never sees it.
- **Omit `YEARBOOK_WALLET_KEY` entirely** for a read-only server that can look but not spend.
- You are only ever charged for pixels you actually got; a payment that loses a race is
  never settled.

Fund the wallet with only what you are willing to lose to a pixel war — the
[yearbook-kit README](https://github.com/AnmarAbdi/yearbook-kit#wallet-setup) covers wallet
setup, budgets, and the reference painter and defender. MIT.
