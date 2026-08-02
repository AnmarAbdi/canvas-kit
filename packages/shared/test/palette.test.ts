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

  it('is decided: every one of the 32 slots is a real colour', () => {
    expect(PALETTE.decided).toBe(true);
    expect(isPaletteDecided()).toBe(true);
    expect(PALETTE.colors.filter((c) => c === null)).toHaveLength(0);
  });

  it('has no duplicate colours — two indices for one colour wastes a slot forever', () => {
    const seen = new Set(PALETTE.colors.map((c) => (c as string).toUpperCase()));
    expect(seen.size).toBe(PALETTE_SIZE);
  });

  it('pins the exact wire order (an index is a byte in every stored snapshot)', () => {
    // If this test fails, every snapshot ever taken has been recoloured. It is a
    // canary, not a formality: the palette may not be reordered after launch.
    expect(PALETTE.colors).toEqual([
      '#FFFFFF', '#D4D7D9', '#898D90', '#515252', '#000000', '#6D001A', '#BE0039', '#FF4500',
      '#FFA800', '#FFD635', '#FFF8B8', '#00A368', '#00CC78', '#7EED56', '#00756F', '#FFB470',
      '#009EAA', '#00CCC0', '#2450A4', '#3690EA', '#51E9F4', '#493AC1', '#6A5CFF', '#94B3FF',
      '#811E9F', '#B44AC0', '#E4ABFF', '#DE107F', '#FF3881', '#FF99AA', '#6D482F', '#9C6926',
    ]);
  });

  it('records where the palette came from', () => {
    expect(PALETTE.note).toContain('r/place 2022');
  });

  it('validates color indices against the palette size, decided or not', () => {
    expect(isValidColorIndex(0)).toBe(true);
    expect(isValidColorIndex(PALETTE_SIZE - 1)).toBe(true);
    expect(isValidColorIndex(PALETTE_SIZE)).toBe(false);
    expect(isValidColorIndex(-1)).toBe(false);
    expect(isValidColorIndex(1.5)).toBe(false);
  });

  it('resolves every index and still refuses one that does not exist', () => {
    for (let i = 0; i < PALETTE_SIZE; i++) expect(requireColorHex(i)).toMatch(/^#[0-9A-F]{6}$/);
    expect(colorHex(0)).toBe('#FFFFFF');
    expect(() => colorHex(PALETTE_SIZE)).toThrow(RangeError);
    expect(() => requireColorHex(-1)).toThrow(RangeError);
  });
});
