import { type DiffFrame } from '../types.js';
export declare const W2_VERSION = 1;
export declare const W2_HEADER_BYTES = 7;
export declare const W2_ENTRY_BYTES = 6;
export declare const W2_MAX_COUNT = 65535;
export declare const W2_MAX_SEQ = 4294967295;
export declare function w2ByteLength(count: number): number;
export declare function encodeW2(frame: DiffFrame): Uint8Array;
export declare function decodeW2(bytes: Uint8Array): DiffFrame;
/** Apply a decoded diff frame onto a W1 grid, in place. Returns the same grid. */
export declare function applyW2ToW1(grid: Uint8Array, w: number, h: number, frame: DiffFrame): Uint8Array;
