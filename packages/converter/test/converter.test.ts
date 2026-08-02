/**
 * Converter: image → job.json. The failure mode that matters is a job that paints
 * something the user did not draw — wrong colours, drifted position, or pixels they
 * thought were transparent — because they only find out after paying for it.
 */
import { describe, it, expect } from 'vitest';
import { PALETTE, PALETTE_SIZE, CANVAS_W, CANVAS_H, requireColorHex } from '@canvas2026/shared';
import { snapToPalette, toJob, validateJob, nearestIndex, type Rgba } from '../src/index.js';

function image(pixels: [number, number, number, number][], width: number): Rgba {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b, a], i) => {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  });
  return { data, width, height: pixels.length / width };
}

function rgbOf(index: number): [number, number, number] {
  const hex = requireColorHex(index);
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

describe('colour matching', () => {
  it('maps every palette colour to its own index exactly', () => {
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const [r, g, b] = rgbOf(i);
      expect(nearestIndex(r, g, b)).toBe(i);
    }
  });

  it('picks the obvious neighbour for near-misses', () => {
    const [r, g, b] = rgbOf(4); // #000000
    expect(nearestIndex(r + 3, g + 2, b + 1)).toBe(4);
    expect(nearestIndex(255, 255, 254)).toBe(0); // near-white → blank
  });

  it('is deterministic', () => {
    const a = snapToPalette(image([[120, 30, 200, 255]], 1));
    const b = snapToPalette(image([[120, 30, 200, 255]], 1));
    expect(a.indices).toEqual(b.indices);
  });
});

describe('transparency', () => {
  it('drops transparent pixels from the job rather than painting them', () => {
    const img = image(
      [
        [0, 0, 0, 255],
        [0, 0, 0, 0],
      ],
      2,
    );
    const job = toJob(img, { x: 10, y: 10 });
    expect(job.pixels).toEqual([{ x: 10, y: 10, c: 4 }]);
  });

  it('honours a custom alpha threshold', () => {
    const img = image([[0, 0, 0, 100]], 1);
    expect(toJob(img, { x: 0, y: 0 }).pixels).toHaveLength(0);
    expect(toJob(img, { x: 0, y: 0, alphaThreshold: 50 }).pixels).toHaveLength(1);
  });
});

describe('blank pixels', () => {
  it('skips blank-index pixels by default — painting white onto white costs real money', () => {
    const white = rgbOf(0);
    const img = image([[...white, 255] as [number, number, number, number]], 1);
    expect(toJob(img, { x: 0, y: 0 }).pixels).toHaveLength(0);
    expect(toJob(img, { x: 0, y: 0, skipBlank: false }).pixels).toHaveLength(1);
  });
});

describe('positioning', () => {
  it('offsets by the placement origin, row-major', () => {
    const black = rgbOf(4);
    const img = image(
      [
        [...black, 255],
        [...black, 255],
        [...black, 255],
        [...black, 255],
      ] as [number, number, number, number][],
      2,
    );
    const job = toJob(img, { x: 100, y: 200 });
    expect(job.pixels).toEqual([
      { x: 100, y: 200, c: 4 },
      { x: 101, y: 200, c: 4 },
      { x: 100, y: 201, c: 4 },
      { x: 101, y: 201, c: 4 },
    ]);
  });

  it('drops overflow instead of clamping it against the edge', () => {
    const black = rgbOf(4);
    const img = image([[...black, 255], [...black, 255]] as [number, number, number, number][], 2);
    const job = toJob(img, { x: CANVAS_W - 1, y: CANVAS_H - 1 });
    // Clamping would stack the second pixel on the first and paint a lie.
    expect(job.pixels).toEqual([{ x: CANVAS_W - 1, y: CANVAS_H - 1, c: 4 }]);
  });
});

describe('dithering', () => {
  it('turns a flat mid-tone into a mix rather than one solid colour', () => {
    const grey: [number, number, number, number] = [128, 128, 128, 255];
    const img = image(Array.from({ length: 64 }, () => grey), 8);

    const flat = snapToPalette(img, { dither: false });
    const dithered = snapToPalette(img, { dither: true });

    expect(new Set(flat.indices).size).toBe(1);
    expect(new Set(dithered.indices).size).toBeGreaterThan(1);
  });

  it('stays inside the palette and stays deterministic', () => {
    const img = image(
      Array.from({ length: 100 }, (_, i) => [i * 2, 255 - i * 2, (i * 7) % 255, 255] as [number, number, number, number]),
      10,
    );
    const a = snapToPalette(img, { dither: true });
    const b = snapToPalette(img, { dither: true });
    expect(a.indices).toEqual(b.indices);
    for (const index of a.indices) expect(index).toBeLessThan(PALETTE_SIZE);
  });

  it('does not bleed error into transparent pixels', () => {
    const img = image(
      [
        [200, 60, 60, 255],
        [0, 0, 0, 0],
      ],
      2,
    );
    const snapped = snapToPalette(img, { dither: true });
    expect(snapped.opaque[1]).toBe(0);
    expect(toJob(img, { x: 0, y: 0, dither: true }).pixels).toHaveLength(1);
  });
});

describe('job.json', () => {
  it('emits format v1 with the canvas id and optional cost snapshot', () => {
    const black = rgbOf(4);
    const img = image([[...black, 255]] as [number, number, number, number][], 1);
    const job = toJob(img, { x: 1, y: 2, name: 'logo', estCostUnits: 4_120_000 });

    expect(job.canvas).toBe('2026');
    expect(job.version).toBe(1);
    expect(job.name).toBe('logo');
    expect(job.est_cost_units).toBe(4_120_000);
    expect(job.est_cost_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('round-trips through the validator', () => {
    const black = rgbOf(4);
    const img = image(Array.from({ length: 9 }, () => [...black, 255] as [number, number, number, number]), 3);
    const job = toJob(img, { x: 50, y: 50 });
    expect(validateJob(JSON.parse(JSON.stringify(job)))).toMatchObject({ ok: true });
  });
});

describe('validateJob', () => {
  const base = { canvas: '2026', version: 1, pixels: [{ x: 1, y: 1, c: 1 }] };

  it('accepts a good job', () => {
    expect(validateJob(base).ok).toBe(true);
  });

  it('rejects everything that would cost money to discover on the server', () => {
    expect(validateJob({ ...base, canvas: '2025' })).toMatchObject({ ok: false });
    expect(validateJob({ ...base, version: 2 })).toMatchObject({ ok: false });
    expect(validateJob({ ...base, pixels: [] })).toMatchObject({ ok: false });
    expect(validateJob({ ...base, pixels: [{ x: -1, y: 0, c: 0 }] })).toMatchObject({ ok: false });
    expect(validateJob({ ...base, pixels: [{ x: 0, y: 0, c: PALETTE_SIZE }] })).toMatchObject({ ok: false });
    expect(validateJob({ ...base, pixels: [{ x: 1.5, y: 0, c: 0 }] })).toMatchObject({ ok: false });
    expect(validateJob({ ...base, pixels: [{ x: 1, y: 1, c: 1 }, { x: 1, y: 1, c: 2 }] })).toMatchObject({
      ok: false,
      reason: expect.stringContaining('duplicate'),
    });
  });
});

describe('palette source of truth', () => {
  it('uses the locked palette, not a copy', () => {
    expect(PALETTE.decided).toBe(true);
    expect(PALETTE.colors[0]).toBe('#FFFFFF');
  });
});
