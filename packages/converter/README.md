# @canvas2026/converter

Image → `job.json` for [CANVAS 2026](https://github.com/AnmarAbdi/canvas-kit): snap RGBA
pixels to the locked 32-colour palette (r/place 2022), optionally dither, and emit the
job format every kit tool consumes (07-AGENT-KIT §1).

```ts
import { toJob, validateJob } from '@canvas2026/converter';

// image: { width, height, data } — RGBA bytes, e.g. from a <canvas> or a PNG decoder
const job = toJob(image, { x: 120, y: 88, name: 'my-logo' });
// → { canvas: "2026", version: 1, pixels: [{ x, y, c }, …] }

const parsed = validateJob(JSON.parse(fs.readFileSync('job.json', 'utf8')));
if (!parsed.ok) throw new Error(parsed.reason);
```

- Transparent pixels are skipped; so are blank-white ones by default (`skipBlank`) —
  painting a pixel the colour it already is still costs money.
- Pixels that would land off-canvas are dropped, not clamped.
- `snapToPalette` / `nearestIndex` are exported separately if you only want the
  colour-mapping step.

Part of [canvas-kit](https://github.com/AnmarAbdi/canvas-kit) — the open-source half of
CANVAS 2026. MIT.
