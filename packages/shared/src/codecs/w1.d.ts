export interface W1Rect {
    w: number;
    h: number;
}
/**
 * Encode a grid to a W1 body. The grid is already the wire layout, so this is a
 * validating copy — it exists so that no caller ships a buffer with the wrong
 * length or an out-of-palette byte.
 */
export declare function encodeW1(grid: Uint8Array, w: number, h: number): Uint8Array;
/** Decode a W1 body of known dimensions. Rejects wrong length and out-of-palette bytes. */
export declare function decodeW1(bytes: Uint8Array, w: number, h: number): Uint8Array;
/** Index of (x,y) within a w-wide W1 grid. */
export declare function w1Index(x: number, y: number, w: number): number;
/** Color index at (x,y) of a W1 grid, relative to the grid's own origin. */
export declare function w1Get(grid: Uint8Array, w: number, h: number, x: number, y: number): number;
/** Cut a sub-rect out of a W1 grid (used by region reads and by the defender's diffing). */
export declare function w1SubRect(grid: Uint8Array, w: number, h: number, x: number, y: number, rw: number, rh: number): Uint8Array;
/** A blank canvas-sized W1 grid (every pixel palette index 0). */
export declare function w1Blank(w?: number, h?: number): Uint8Array;
