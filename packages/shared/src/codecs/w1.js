/**
 * W1 — snapshot / region grid codec (04-API "Wire formats").
 *
 * Row-major `w*h` bytes, one palette index per pixel, NO header: dimensions come
 * from the request (`/api/region?x=&y=&w=&h=`) or from the canvas constants
 * (`/api/canvas`). Byte i of the body is pixel (i % w, floor(i / w)) of the rect.
 */
import { CANVAS_W, CANVAS_H } from '../constants.js';
import { isValidColorIndex } from '../palette.js';
function assertDims(w, h) {
    if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
        throw new RangeError(`W1: dimensions must be positive integers, got ${w}x${h}`);
    }
    if (w > CANVAS_W || h > CANVAS_H) {
        throw new RangeError(`W1: ${w}x${h} exceeds canvas ${CANVAS_W}x${CANVAS_H}`);
    }
}
/**
 * Encode a grid to a W1 body. The grid is already the wire layout, so this is a
 * validating copy — it exists so that no caller ships a buffer with the wrong
 * length or an out-of-palette byte.
 */
export function encodeW1(grid, w, h) {
    assertDims(w, h);
    if (grid.length !== w * h) {
        throw new RangeError(`W1: grid has ${grid.length} bytes, expected ${w * h} for ${w}x${h}`);
    }
    for (let i = 0; i < grid.length; i++) {
        const c = grid[i];
        if (!isValidColorIndex(c)) {
            throw new RangeError(`W1: byte ${i} = ${c} is not a valid palette index`);
        }
    }
    return Uint8Array.from(grid);
}
/** Decode a W1 body of known dimensions. Rejects wrong length and out-of-palette bytes. */
export function decodeW1(bytes, w, h) {
    assertDims(w, h);
    if (bytes.length !== w * h) {
        throw new RangeError(`W1: body has ${bytes.length} bytes, expected ${w * h} for ${w}x${h}`);
    }
    for (let i = 0; i < bytes.length; i++) {
        const c = bytes[i];
        if (!isValidColorIndex(c)) {
            throw new RangeError(`W1: byte ${i} = ${c} is not a valid palette index`);
        }
    }
    return Uint8Array.from(bytes);
}
/** Index of (x,y) within a w-wide W1 grid. */
export function w1Index(x, y, w) {
    return y * w + x;
}
/** Color index at (x,y) of a W1 grid, relative to the grid's own origin. */
export function w1Get(grid, w, h, x, y) {
    if (x < 0 || y < 0 || x >= w || y >= h) {
        throw new RangeError(`W1: (${x},${y}) outside ${w}x${h} grid`);
    }
    return grid[w1Index(x, y, w)];
}
/** Cut a sub-rect out of a W1 grid (used by region reads and by the defender's diffing). */
export function w1SubRect(grid, w, h, x, y, rw, rh) {
    assertDims(rw, rh);
    if (x < 0 || y < 0 || x + rw > w || y + rh > h) {
        throw new RangeError(`W1: rect ${rw}x${rh} at (${x},${y}) outside ${w}x${h} grid`);
    }
    const out = new Uint8Array(rw * rh);
    for (let row = 0; row < rh; row++) {
        out.set(grid.subarray((y + row) * w + x, (y + row) * w + x + rw), row * rw);
    }
    return out;
}
/** A blank canvas-sized W1 grid (every pixel palette index 0). */
export function w1Blank(w = CANVAS_W, h = CANVAS_H) {
    assertDims(w, h);
    return new Uint8Array(w * h);
}
