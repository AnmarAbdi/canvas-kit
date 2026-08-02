/**
 * palette.json is a PLACEHOLDER until the human resolves the [DECIDE] in
 * 01-CONSTANTS. These tests pin the shape and make sure nothing invents a hex.
 */
import { describe, it, expect } from 'vitest';
import {
  PALETTE,
  isPaletteDecided,
  colorHex,
  requireColorHex,
  isValidColorIndex,
  BLANK_HEX,
} from '../src/palette.js';
import { PALETTE_SIZE, BLANK_COLOR_INDEX } from '../src/constants.js';

describe('palette', () => {
  it('has exactly PALETTE_SIZE slots', () => {
    expect(PALETTE.colors.length).toBe(PALETTE_SIZE);
    expect(PALETTE.size).toBe(PALETTE_SIZE);
  });

  it('index 0 is blank/white (the only locked entry)', () => {
    expect(BLANK_COLOR_INDEX).toBe(0);
    expect(BLANK_HEX).toBe('#FFFFFF');
  });

  it('every decided entry is a #RRGGBB hex; the rest are null, never guessed', () => {
    for (const c of PALETTE.colors) {
      if (c !== null) expect(c).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('is still marked undecided and says so', () => {
    // Flip both of these in the same commit that fills in the hexes.
    expect(PALETTE.decided).toBe(false);
    expect(isPaletteDecided()).toBe(false);
    expect(PALETTE.note).toContain('[DECIDE]');
  });

  it('validates color indices against the palette size, decided or not', () => {
    expect(isValidColorIndex(0)).toBe(true);
    expect(isValidColorIndex(PALETTE_SIZE - 1)).toBe(true);
    expect(isValidColorIndex(PALETTE_SIZE)).toBe(false);
    expect(isValidColorIndex(-1)).toBe(false);
    expect(isValidColorIndex(1.5)).toBe(false);
  });

  it('requireColorHex throws for undecided slots instead of returning a guess', () => {
    const undecided = PALETTE.colors.findIndex((c) => c === null);
    expect(undecided).toBeGreaterThan(0);
    expect(colorHex(undecided)).toBeNull();
    expect(() => requireColorHex(undecided)).toThrow(/DECIDE/);
    expect(() => colorHex(PALETTE_SIZE)).toThrow(RangeError);
  });
});
