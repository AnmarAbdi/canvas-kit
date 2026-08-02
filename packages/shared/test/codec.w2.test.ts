/**
 * W2 diff-frame codec round-trip property tests — M0 acceptance criterion.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  encodeW2,
  decodeW2,
  applyW2ToW1,
  w2ByteLength,
  W2_VERSION,
  W2_HEADER_BYTES,
  W2_ENTRY_BYTES,
  W2_MAX_SEQ,
} from '../src/codecs/w2.js';
import { w1Blank, w1Get } from '../src/codecs/w1.js';
import { CANVAS_W, CANVAS_H, PALETTE_SIZE } from '../src/constants.js';
import { DiffKind, type DiffFrame } from '../src/types.js';

const diffPixelArb = fc.record({
  x: fc.integer({ min: 0, max: CANVAS_W - 1 }),
  y: fc.integer({ min: 0, max: CANVAS_H - 1 }),
  c: fc.integer({ min: 0, max: PALETTE_SIZE - 1 }),
  kind: fc.constantFrom(DiffKind.FREE, DiffKind.PAID, DiffKind.MODERATED, DiffKind.REVERTED),
});

const frameArb: fc.Arbitrary<DiffFrame> = fc.record({
  version: fc.constant(W2_VERSION),
  seq: fc.integer({ min: 0, max: W2_MAX_SEQ }),
  pixels: fc.array(diffPixelArb, { maxLength: 300 }),
});

describe('W2 codec', () => {
  it('round-trips any valid frame', () => {
    fc.assert(
      fc.property(frameArb, (frame) => {
        expect(decodeW2(encodeW2(frame))).toEqual(frame);
      }),
    );
  });

  it('encode(decode(bytes)) is byte-identical (no canonicalisation drift)', () => {
    fc.assert(
      fc.property(frameArb, (frame) => {
        const bytes = encodeW2(frame);
        expect(encodeW2(decodeW2(bytes))).toEqual(bytes);
      }),
    );
  });

  it('frame size is 7 + 6*count bytes', () => {
    fc.assert(
      fc.property(frameArb, (frame) => {
        expect(encodeW2(frame).length).toBe(W2_HEADER_BYTES + frame.pixels.length * W2_ENTRY_BYTES);
        expect(encodeW2(frame).length).toBe(w2ByteLength(frame.pixels.length));
      }),
    );
  });

  it('lays out the header big-endian: u8 version, u32 seq, u16 count', () => {
    const frame: DiffFrame = { version: 1, seq: 0x01020304, pixels: [] };
    expect(Array.from(encodeW2(frame))).toEqual([1, 0x01, 0x02, 0x03, 0x04, 0x00, 0x00]);
    const one: DiffFrame = { version: 1, seq: 1, pixels: [{ x: 0x0102, y: 0x0304, c: 5, kind: 1 }] };
    expect(Array.from(encodeW2(one).slice(W2_HEADER_BYTES))).toEqual([0x01, 0x02, 0x03, 0x04, 5, 1]);
  });

  it('decodes correctly from a non-zero byteOffset view (WS buffers are often sliced)', () => {
    fc.assert(
      fc.property(frameArb, (frame) => {
        const bytes = encodeW2(frame);
        const padded = new Uint8Array(bytes.length + 3);
        padded.set(bytes, 3);
        expect(decodeW2(padded.subarray(3))).toEqual(frame);
      }),
    );
  });

  it('rejects truncated frames', () => {
    fc.assert(
      fc.property(
        frameArb.filter((f) => f.pixels.length > 0),
        (frame) => {
          const bytes = encodeW2(frame);
          expect(() => decodeW2(bytes.subarray(0, bytes.length - 1))).toThrow(RangeError);
          expect(() => decodeW2(bytes.subarray(0, W2_HEADER_BYTES - 1))).toThrow(RangeError);
        },
      ),
    );
  });

  it('rejects frames longer than the declared count', () => {
    const bytes = encodeW2({ version: 1, seq: 7, pixels: [{ x: 1, y: 1, c: 1, kind: 0 }] });
    const longer = new Uint8Array(bytes.length + 1);
    longer.set(bytes);
    expect(() => decodeW2(longer)).toThrow(RangeError);
  });

  it('rejects unknown versions on both directions', () => {
    const bytes = encodeW2({ version: 1, seq: 1, pixels: [] });
    bytes[0] = 2;
    expect(() => decodeW2(bytes)).toThrow(RangeError);
    expect(() => encodeW2({ version: 2, seq: 1, pixels: [] } as unknown as DiffFrame)).toThrow(
      RangeError,
    );
  });

  it('rejects invalid palette indices and unknown kinds', () => {
    expect(() => encodeW2({ version: 1, seq: 1, pixels: [{ x: 0, y: 0, c: PALETTE_SIZE, kind: 0 }] })).toThrow(RangeError);
    expect(() =>
      encodeW2({ version: 1, seq: 1, pixels: [{ x: 0, y: 0, c: 0, kind: 4 as unknown as DiffKind }] }),
    ).toThrow(RangeError);

    const bad = encodeW2({ version: 1, seq: 1, pixels: [{ x: 0, y: 0, c: 0, kind: 0 }] });
    bad[W2_HEADER_BYTES + 4] = PALETTE_SIZE; // color byte
    expect(() => decodeW2(bad)).toThrow(RangeError);
    const badKind = encodeW2({ version: 1, seq: 1, pixels: [{ x: 0, y: 0, c: 0, kind: 0 }] });
    badKind[W2_HEADER_BYTES + 5] = 9;
    expect(() => decodeW2(badKind)).toThrow(RangeError);
  });

  it('rejects out-of-u32 seq and out-of-u16 coordinates', () => {
    expect(() => encodeW2({ version: 1, seq: W2_MAX_SEQ + 1, pixels: [] })).toThrow(RangeError);
    expect(() => encodeW2({ version: 1, seq: -1, pixels: [] })).toThrow(RangeError);
    expect(() => encodeW2({ version: 1, seq: 0, pixels: [{ x: 65_536, y: 0, c: 0, kind: 0 }] })).toThrow(RangeError);
  });

  it('applying a decoded frame to a W1 grid reproduces last-write-wins state', () => {
    fc.assert(
      fc.property(frameArb, (frame) => {
        const grid = w1Blank(CANVAS_W, CANVAS_H);
        applyW2ToW1(grid, CANVAS_W, CANVAS_H, decodeW2(encodeW2(frame)));
        const expected = new Map<string, number>();
        for (const p of frame.pixels) expected.set(`${p.x},${p.y}`, p.c);
        for (const [key, c] of expected) {
          const [x, y] = key.split(',').map(Number) as [number, number];
          expect(w1Get(grid, CANVAS_W, CANVAS_H, x, y)).toBe(c);
        }
      }),
      { numRuns: 50 },
    );
  });
});
