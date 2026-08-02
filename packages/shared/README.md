# @canvas2026/shared

Game rules, wire types and binary codecs for CANVAS 2026. Consumed by both repos
(kit tooling and the server) so there is exactly one copy of every number.

**`src/constants.ts` is generated from `canvas-kit/docs/01-CONSTANTS.md`.** Change the
doc first, then the file; `test/constants.doc.test.ts` re-reads the doc in CI and fails
on any drift. Never inline a game-rule number anywhere else. Server-internal tunables
(tile size, TTLs, rate limits) belong in `canvas-server/docs/05-ARCHITECTURE.md`, not here.

## Contents

| Module | What |
|---|---|
| `constants.ts` | canvas size, `price(n)`, immunity, freeze, free tier, payment identifiers |
| `palette.json` / `palette.ts` | 32 palette slots + loader. **Placeholder**: only index 0 (blank/white) is decided |
| `types.ts` | `Pixel`, `Job`, `Quote`, `Receipt`, `PixelMeta`, `DiffFrame`, `ErrorCode` (04-API / 03-PROTOCOL shapes) |
| `codecs/w1.ts` | snapshot / region grid: row-major `w*h` bytes, one palette index per pixel, no header |
| `codecs/w2.ts` | WS diff frame: `u8 version, u32 seq, u16 count, count × {u16 x, u16 y, u8 c, u8 kind}` |

## Money and time rules baked in

- Integer USDC atomic units (6 decimals) everywhere; `price(n)` uses capped doubling,
  never `<<` (n is a u16 in storage and a 32-bit shift would wrap instead of saturating).
- Epoch ms, UTC. `isFrozen(t)` is the single freeze test: writes are valid iff `t < FREEZE_AT`.
- `immunityMsAt(t)` switches 60s → 30s at `DECEMBER_SWITCH_AT`.

## Open items (human decisions, not agent-fillable)

- Palette hexes — `palette.json` entries 1..31 are `null`; `requireColorHex()` throws
  rather than guessing. Flip `decided: true` in the same commit that fills them in.
- `LAUNCH_AT`, `CANVAS_DOMAIN` — `null` until decided.
- `USDC_ADDRESS_STAGING` — `null`, `[VERIFY]` from Circle docs at M3.

W2 byte order is **big-endian**, locked in 04-API "Wire formats" — not an open item.

## Commands

```
npm install          # from the canvas-kit root (workspaces)
npm test  -w @canvas2026/shared
npm run build -w @canvas2026/shared
```
