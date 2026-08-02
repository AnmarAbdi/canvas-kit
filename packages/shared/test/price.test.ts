/**
 * price(n) table test for n = 0..12 — M0 acceptance criterion.
 * Table is derived by hand from 01-CONSTANTS: $0.01 doubling, plateau $10.24 at n=10.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  price,
  priceTotal,
  PRICE_BASE_UNITS,
  PLATEAU_UNITS,
  PLATEAU_N,
} from '../src/constants.js';

/** n → units. Written out literally on purpose: a loop here would just re-implement the code. */
const TABLE: Record<number, number> = {
  0: 10_000, //      $0.01
  1: 20_000, //      $0.02
  2: 40_000, //      $0.04
  3: 80_000, //      $0.08
  4: 160_000, //     $0.16
  5: 320_000, //     $0.32
  6: 640_000, //     $0.64
  7: 1_280_000, //   $1.28
  8: 2_560_000, //   $2.56
  9: 5_120_000, //   $5.12
  10: 10_240_000, // $10.24 — plateau
  11: 10_240_000, // plateau
  12: 10_240_000, // plateau
};

describe('price(n)', () => {
  for (const [n, units] of Object.entries(TABLE)) {
    it(`price(${n}) === ${units}`, () => {
      expect(price(Number(n))).toBe(units);
    });
  }

  it('matches min(PRICE_BASE_UNITS << n, PLATEAU_UNITS) where the shift is safe (n <= 17)', () => {
    for (let n = 0; n <= 17; n++) {
      expect(price(n)).toBe(Math.min(PRICE_BASE_UNITS << n, PLATEAU_UNITS));
    }
  });

  it('saturates at the plateau instead of wrapping for large n (n is a u16 in storage)', () => {
    fc.assert(
      fc.property(fc.integer({ min: PLATEAU_N, max: 65_535 }), (n) => {
        expect(price(n)).toBe(PLATEAU_UNITS);
      }),
    );
  });

  it('is monotonically non-decreasing and never exceeds the plateau', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000 }), (n) => {
        expect(price(n)).toBeLessThanOrEqual(PLATEAU_UNITS);
        expect(price(n + 1)).toBeGreaterThanOrEqual(price(n));
      }),
    );
  });

  it('returns integers only — no floats anywhere in money math', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 65_535 }), (n) => {
        expect(Number.isSafeInteger(price(n))).toBe(true);
      }),
    );
  });

  it('rejects negative and non-integer n', () => {
    expect(() => price(-1)).toThrow(RangeError);
    expect(() => price(1.5)).toThrow(RangeError);
    expect(() => price(NaN)).toThrow(RangeError);
  });

  it('PLATEAU_N is the first n that reaches the plateau', () => {
    expect(price(PLATEAU_N)).toBe(PLATEAU_UNITS);
    expect(price(PLATEAU_N - 1)).toBeLessThan(PLATEAU_UNITS);
  });

  it('priceTotal sums per-pixel prices exactly', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 20 }), { maxLength: 1_000 }), (ns) => {
        expect(priceTotal(ns)).toBe(ns.reduce((a, n) => a + price(n), 0));
      }),
    );
    expect(priceTotal([0, 1, 10, 12])).toBe(10_000 + 20_000 + 10_240_000 + 10_240_000);
  });
});
