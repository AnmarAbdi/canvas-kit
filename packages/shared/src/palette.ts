/**
 * Palette loader. The hex list itself lives in palette.json so non-TS consumers
 * (converter, python painter, render tooling) read the same bytes.
 *
 * The palette is a PLACEHOLDER: only index 0 (blank/white) is locked. Every other
 * entry is null until the human resolves the [DECIDE] in 01-CONSTANTS. Code that
 * needs actual colors must check `isPaletteDecided()` and fail loudly — rendering a
 * made-up hex would be inventing a constant.
 */
import paletteJson from './palette.json' with { type: 'json' };
import { PALETTE_SIZE, BLANK_COLOR_INDEX } from './constants.js';

export interface Palette {
  version: number;
  size: number;
  decided: boolean;
  note: string;
  /** Length === PALETTE_SIZE; null means "not decided yet". */
  colors: (string | null)[];
}

export const PALETTE: Palette = paletteJson as Palette;

if (PALETTE.colors.length !== PALETTE_SIZE) {
  throw new Error(`palette.json has ${PALETTE.colors.length} entries, expected ${PALETTE_SIZE}`);
}

/** True once every palette slot has a hex (i.e. the [DECIDE] is resolved). */
export function isPaletteDecided(): boolean {
  return PALETTE.colors.every((c) => typeof c === 'string');
}

/** A color index is valid iff it addresses a palette slot — decided or not. */
export function isValidColorIndex(c: number): boolean {
  return Number.isInteger(c) && c >= 0 && c < PALETTE_SIZE;
}

/** Hex for a palette index, or null if that slot is still [DECIDE]. */
export function colorHex(c: number): string | null {
  if (!isValidColorIndex(c)) throw new RangeError(`color index out of range: ${c}`);
  return PALETTE.colors[c] ?? null;
}

/** Hex for a palette index; throws instead of guessing when the slot is undecided. */
export function requireColorHex(c: number): string {
  const hex = colorHex(c);
  if (hex === null) {
    throw new Error(
      `palette index ${c} is still [DECIDE] in 01-CONSTANTS — resolve palette.json before rendering`,
    );
  }
  return hex;
}

export const BLANK_HEX = requireColorHex(BLANK_COLOR_INDEX);
