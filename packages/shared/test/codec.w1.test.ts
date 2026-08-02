/**
 * W1 codec round-trip property tests — M0 acceptance criterion.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { encodeW1, decodeW1, w1Get, w1SubRect, w1Blank } from '../src/codecs/w1.js';
import { CANVAS_W, CANVAS_H, PALETTE_SIZE } from '../src/constants.js';

const colorByte = fc.integer({ min: 0, max: PALETTE_SIZE - 1 });

/** Random grid + its dimensions, kept small so the property runs thousands of cases fast. */
const gridArb = fc
  .tuple(fc.integer({ min: 1, max: 64 }), fc.integer({ min: 1, max: 64 }))
  .chain(([w, h]) =>
    fc
      .array(colorByte, { minLength: w * h, maxLength: w * h })
      .map((bytes) => ({ w, h, grid: Uint8Array.from(bytes) })),
  );

describe('W1 codec', () => {
  it('round-trips any valid grid byte-for-byte', () => {
    fc.assert(
      fc.property(gridArb, ({ w, h, grid }) => {
        expect(decodeW1(encodeW1(grid, w, h), w, h)).toEqual(grid);
      }),
    );
  });

  it('encodes to exactly w*h bytes with no header', () => {
    fc.assert(
      fc.property(gridArb, ({ w, h, grid }) => {
        expect(encodeW1(grid, w, h).length).toBe(w * h);
      }),
    );
  });

  it('is row-major: byte i is pixel (i % w, floor(i / w))', () => {
    fc.assert(
      fc.property(gridArb, ({ w, h, grid }) => {
        const bytes = encodeW1(grid, w, h);
        for (let i = 0; i < bytes.length; i++) {
          expect(bytes[i]).toBe(w1Get(grid, w, h, i % w, Math.floor(i / w)));
        }
      }),
    );
  });

  it('copies rather than aliasing the caller buffer', () => {
    const grid = Uint8Array.from([1, 2, 3, 4]);
    const encoded = encodeW1(grid, 2, 2);
    grid[0] = 9;
    expect(encoded[0]).toBe(1);
  });

  it('rejects a body whose length disagrees with the dimensions', () => {
    fc.assert(
      fc.property(gridArb, fc.integer({ min: 1, max: 8 }), ({ w, h, grid }, delta) => {
        expect(() => decodeW1(grid.subarray(0, Math.max(0, grid.length - delta)), w, h)).toThrow(
          RangeError,
        );
        expect(() => decodeW1(new Uint8Array(grid.length + delta), w, h)).toThrow(RangeError);
      }),
    );
  });

  it('rejects out-of-palette bytes on both directions', () => {
    fc.assert(
      fc.property(fc.integer({ min: PALETTE_SIZE, max: 255 }), (bad) => {
        const grid = Uint8Array.from([0, 0, 0, bad]);
        expect(() => encodeW1(grid, 2, 2)).toThrow(RangeError);
        expect(() => decodeW1(grid, 2, 2)).toThrow(RangeError);
      }),
    );
  });

  it('rejects dimensions outside the canvas', () => {
    expect(() => encodeW1(new Uint8Array(0), 0, 0)).toThrow(RangeError);
    expect(() => decodeW1(new Uint8Array((CANVAS_W + 1) * 2), CANVAS_W + 1, 2)).toThrow(RangeError);
    expect(() => decodeW1(new Uint8Array(2 * (CANVAS_H + 1)), 2, CANVAS_H + 1)).toThrow(RangeError);
  });

  it('a full canvas snapshot is CANVAS_W * CANVAS_H bytes', () => {
    const blank = w1Blank();
    expect(blank.length).toBe(CANVAS_W * CANVAS_H);
    expect(decodeW1(encodeW1(blank, CANVAS_W, CANVAS_H), CANVAS_W, CANVAS_H)).toEqual(blank);
  });

  it('w1SubRect matches point-wise reads of the parent grid', () => {
    fc.assert(
      fc.property(
        gridArb.chain(({ w, h, grid }) =>
          fc
            .tuple(fc.integer({ min: 0, max: w - 1 }), fc.integer({ min: 0, max: h - 1 }))
            .chain(([x, y]) =>
              fc
                .tuple(
                  fc.integer({ min: 1, max: w - x }),
                  fc.integer({ min: 1, max: h - y }),
                )
                .map(([rw, rh]) => ({ w, h, grid, x, y, rw, rh })),
            ),
        ),
        ({ w, h, grid, x, y, rw, rh }) => {
          const sub = w1SubRect(grid, w, h, x, y, rw, rh);
          expect(sub.length).toBe(rw * rh);
          for (let ry = 0; ry < rh; ry++) {
            for (let rx = 0; rx < rw; rx++) {
              expect(w1Get(sub, rw, rh, rx, ry)).toBe(w1Get(grid, w, h, x + rx, y + ry));
            }
          }
        },
      ),
    );
  });

  it('w1SubRect rejects rects that leave the grid', () => {
    const grid = w1Blank(10, 10);
    expect(() => w1SubRect(grid, 10, 10, 5, 5, 6, 1)).toThrow(RangeError);
    expect(() => w1SubRect(grid, 10, 10, -1, 0, 2, 2)).toThrow(RangeError);
  });
});
