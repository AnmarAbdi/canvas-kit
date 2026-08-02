/**
 * The two rules every money path reads out of this package: the freeze boundary
 * (strict `<` to commit) and the immunity window (60s, 30s from December).
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  FREEZE_AT,
  isFrozen,
  IMMUNITY_MS,
  IMMUNITY_MS_DECEMBER,
  DECEMBER_SWITCH_AT,
  immunityMsAt,
  immuneUntil,
} from '../src/constants.js';

describe('freeze', () => {
  it('FREEZE_AT is 2027-01-01T00:00:00.000Z', () => {
    expect(new Date(FREEZE_AT).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('is strict: t < FREEZE_AT commits, t >= FREEZE_AT is frozen', () => {
    expect(isFrozen(FREEZE_AT - 1)).toBe(false);
    expect(isFrozen(FREEZE_AT)).toBe(true);
    expect(isFrozen(FREEZE_AT + 1)).toBe(true);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: FREEZE_AT + 10_000_000 }), (t) => {
        expect(isFrozen(t)).toBe(t >= FREEZE_AT);
      }),
    );
  });
});

describe('immunity', () => {
  it('DECEMBER_SWITCH_AT is 2026-12-01T00:00:00.000Z and precedes the freeze', () => {
    expect(new Date(DECEMBER_SWITCH_AT).toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(DECEMBER_SWITCH_AT).toBeLessThan(FREEZE_AT);
  });

  it('switches at/after DECEMBER_SWITCH_AT, not before', () => {
    expect(immunityMsAt(DECEMBER_SWITCH_AT - 1)).toBe(IMMUNITY_MS);
    expect(immunityMsAt(DECEMBER_SWITCH_AT)).toBe(IMMUNITY_MS_DECEMBER);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: FREEZE_AT }), (t) => {
        expect(immunityMsAt(t)).toBe(t >= DECEMBER_SWITCH_AT ? IMMUNITY_MS_DECEMBER : IMMUNITY_MS);
        expect(immuneUntil(t)).toBe(t + immunityMsAt(t));
      }),
    );
  });

  it('immunity carries through the freeze (D5): a late write stays immune past FREEZE_AT', () => {
    expect(immuneUntil(FREEZE_AT - 1_000)).toBeGreaterThan(FREEZE_AT);
  });
});
