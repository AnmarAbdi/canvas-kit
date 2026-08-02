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
import { type Job } from '@canvas2026/shared';
export interface Rgba {
    data: Uint8ClampedArray | Uint8Array;
    width: number;
    height: number;
}
export interface ConvertOptions {
    /** Floyd–Steinberg error diffusion. Better gradients, noisier flat art. */
    dither?: boolean;
    /** Pixels at/below this alpha become "not part of the job" and are dropped. */
    alphaThreshold?: number;
    /**
     * Drop pixels that snap to the blank index. On by default: a job full of white
     * pixels costs real money to paint onto an already-white canvas.
     */
    skipBlank?: boolean;
}
/** Nearest palette index to an sRGB byte triple. */
export declare function nearestIndex(r: number, g: number, b: number): number;
export interface SnapResult {
    /** width*height palette indices, row-major (W1 layout). */
    indices: Uint8Array;
    /** width*height flags: false where the source was transparent. */
    opaque: Uint8Array;
    width: number;
    height: number;
}
/** Snap an RGBA image to palette indices, optionally with error diffusion. */
export declare function snapToPalette(image: Rgba, options?: ConvertOptions): SnapResult;
export interface JobOptions extends ConvertOptions {
    /** Top-left placement on the canvas. */
    x: number;
    y: number;
    name?: string;
    /** Advisory cost snapshot from POST /api/quote at export time. */
    estCostUnits?: number;
}
/**
 * Snap + position + emit `job.json` v1. Pixels landing outside the canvas are dropped
 * rather than clamped: silently stacking an overflowing image against the edge would
 * paint something the user never drew.
 */
export declare function toJob(image: Rgba, options: JobOptions): Job;
/** Validate a job.json from disk before spending money on it. */
export declare function validateJob(job: unknown): {
    ok: true;
    job: Job;
} | {
    ok: false;
    reason: string;
};
