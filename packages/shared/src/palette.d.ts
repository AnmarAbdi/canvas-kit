export interface Palette {
    version: number;
    size: number;
    decided: boolean;
    note: string;
    /** Length === PALETTE_SIZE; null means "not decided yet". */
    colors: (string | null)[];
}
export declare const PALETTE: Palette;
/** True once every palette slot has a hex (i.e. the [DECIDE] is resolved). */
export declare function isPaletteDecided(): boolean;
/** A color index is valid iff it addresses a palette slot — decided or not. */
export declare function isValidColorIndex(c: number): boolean;
/** Hex for a palette index, or null if that slot is still [DECIDE]. */
export declare function colorHex(c: number): string | null;
/** Hex for a palette index; throws instead of guessing when the slot is undecided. */
export declare function requireColorHex(c: number): string;
export declare const BLANK_HEX: string;
