/**
 * image → job.json (07-AGENT-KIT §1).
 *
 * Runs anywhere with an RGBA buffer: the site's converter feeds it `ImageData`, a
 * script feeds it a decoded PNG. No DOM, no canvas API — that keeps it testable and
 * lets the same code back both the browser tool and CI.
 *
 * Colour matching is Euclidean distance in **linear** RGB rather than sRGB bytes.
 * sRGB is perceptually non-uniform, so byte-space distance systematically prefers dark
 * swatches and muddies midtones; linearising first is one cheap step that visibly helps
 * on photographic input. Full CIELAB would be better still and is not worth the size
 * here — the palette is 32 colours, not 32,000.
 */
import { PALETTE_SIZE, CANVAS_W, CANVAS_H, requireColorHex, BLANK_COLOR_INDEX } from '@canvas2026/shared';
const DEFAULTS = { dither: false, alphaThreshold: 128, skipBlank: true };
/** sRGB byte → linear light. */
function linearize(channel) {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function paletteLinear() {
    return Array.from({ length: PALETTE_SIZE }, (_, i) => {
        const hex = requireColorHex(i);
        return {
            r: linearize(parseInt(hex.slice(1, 3), 16)),
            g: linearize(parseInt(hex.slice(3, 5), 16)),
            b: linearize(parseInt(hex.slice(5, 7), 16)),
        };
    });
}
const PALETTE_LINEAR = paletteLinear();
/** Nearest palette index to an sRGB byte triple. */
export function nearestIndex(r, g, b) {
    const lr = linearize(r);
    const lg = linearize(g);
    const lb = linearize(b);
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < PALETTE_LINEAR.length; i++) {
        const p = PALETTE_LINEAR[i];
        const d = (p.r - lr) ** 2 + (p.g - lg) ** 2 + (p.b - lb) ** 2;
        if (d < bestDistance) {
            bestDistance = d;
            best = i;
        }
    }
    return best;
}
/** Snap an RGBA image to palette indices, optionally with error diffusion. */
export function snapToPalette(image, options = {}) {
    const opts = { ...DEFAULTS, ...options };
    const { width, height, data } = image;
    if (data.length < width * height * 4)
        throw new RangeError('rgba buffer is too small for its dimensions');
    const indices = new Uint8Array(width * height);
    const opaque = new Uint8Array(width * height);
    // Working copy in float so dithering error does not clip at byte boundaries.
    const work = new Float32Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
        work[i * 3] = data[i * 4];
        work[i * 3 + 1] = data[i * 4 + 1];
        work[i * 3 + 2] = data[i * 4 + 2];
        opaque[i] = data[i * 4 + 3] >= opts.alphaThreshold ? 1 : 0;
    }
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            if (!opaque[i])
                continue;
            const r = work[i * 3];
            const g = work[i * 3 + 1];
            const b = work[i * 3 + 2];
            const index = nearestIndex(clamp255(r), clamp255(g), clamp255(b));
            indices[i] = index;
            if (!opts.dither)
                continue;
            const hex = requireColorHex(index);
            const errR = r - parseInt(hex.slice(1, 3), 16);
            const errG = g - parseInt(hex.slice(3, 5), 16);
            const errB = b - parseInt(hex.slice(5, 7), 16);
            // Floyd–Steinberg: 7/16 right, 3/16 below-left, 5/16 below, 1/16 below-right.
            diffuse(work, opaque, width, height, x + 1, y, errR, errG, errB, 7 / 16);
            diffuse(work, opaque, width, height, x - 1, y + 1, errR, errG, errB, 3 / 16);
            diffuse(work, opaque, width, height, x, y + 1, errR, errG, errB, 5 / 16);
            diffuse(work, opaque, width, height, x + 1, y + 1, errR, errG, errB, 1 / 16);
        }
    }
    return { indices, opaque, width, height };
}
function clamp255(v) {
    return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}
function diffuse(work, opaque, width, height, x, y, errR, errG, errB, weight) {
    if (x < 0 || y < 0 || x >= width || y >= height)
        return;
    const i = y * width + x;
    if (!opaque[i])
        return;
    work[i * 3] = work[i * 3] + errR * weight;
    work[i * 3 + 1] = work[i * 3 + 1] + errG * weight;
    work[i * 3 + 2] = work[i * 3 + 2] + errB * weight;
}
/**
 * Snap + position + emit `job.json` v1. Pixels landing outside the canvas are dropped
 * rather than clamped: silently stacking an overflowing image against the edge would
 * paint something the user never drew.
 */
export function toJob(image, options) {
    const snapped = snapToPalette(image, options);
    const opts = { ...DEFAULTS, ...options };
    const pixels = [];
    for (let y = 0; y < snapped.height; y++) {
        for (let x = 0; x < snapped.width; x++) {
            const i = y * snapped.width + x;
            if (!snapped.opaque[i])
                continue;
            const c = snapped.indices[i];
            if (opts.skipBlank && c === BLANK_COLOR_INDEX)
                continue;
            const cx = options.x + x;
            const cy = options.y + y;
            if (cx < 0 || cy < 0 || cx >= CANVAS_W || cy >= CANVAS_H)
                continue;
            pixels.push({ x: cx, y: cy, c });
        }
    }
    return {
        canvas: '2026',
        version: 1,
        ...(options.name ? { name: options.name } : {}),
        pixels,
        ...(options.estCostUnits === undefined
            ? {}
            : { est_cost_units: options.estCostUnits, est_cost_at: new Date().toISOString() }),
    };
}
/** Validate a job.json from disk before spending money on it. */
export function validateJob(job) {
    if (typeof job !== 'object' || job === null)
        return { ok: false, reason: 'not an object' };
    const j = job;
    if (j['canvas'] !== '2026')
        return { ok: false, reason: 'canvas must be "2026"' };
    if (j['version'] !== 1)
        return { ok: false, reason: 'version must be 1' };
    if (!Array.isArray(j['pixels']) || j['pixels'].length === 0)
        return { ok: false, reason: 'pixels must be a non-empty array' };
    const seen = new Set();
    for (const [i, pixel] of j['pixels'].entries()) {
        if (typeof pixel !== 'object' || pixel === null)
            return { ok: false, reason: `pixel ${i} is not an object` };
        const { x, y, c } = pixel;
        if (typeof x !== 'number' || typeof y !== 'number' || typeof c !== 'number') {
            return { ok: false, reason: `pixel ${i}: x, y, c must be numbers` };
        }
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= CANVAS_W || y >= CANVAS_H) {
            return { ok: false, reason: `pixel ${i}: (${x},${y}) is outside the canvas` };
        }
        if (!Number.isInteger(c) || c < 0 || c >= PALETTE_SIZE)
            return { ok: false, reason: `pixel ${i}: bad colour ${c}` };
        const key = y * CANVAS_W + x;
        if (seen.has(key))
            return { ok: false, reason: `duplicate pixel (${x},${y})` };
        seen.add(key);
    }
    return { ok: true, job: job };
}
