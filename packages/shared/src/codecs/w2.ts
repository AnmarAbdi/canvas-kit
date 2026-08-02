/**
 * W2 — diff frame codec (04-API "Wire formats"), the binary WS frame on /api/live.
 *
 *   u8  version = 1
 *   u32 seq                                    // monotonically increasing, global
 *   u16 count
 *   repeat count: { u16 x, u16 y, u8 c, u8 kind }   // kind: 0 free 1 paid 2 moderated 3 reverted
 *
 * Byte order: BIG-ENDIAN (network byte order) for every multi-byte field. Locked in
 * 04-API "Wire formats" — this codec and that doc must not disagree.
 *
 * No metadata (payer, price) rides this stream by design — hover fetches
 * /api/region?meta=1 lazily. Keeps the stream tiny under war load.
 */
import { isValidColorIndex } from '../palette.js';
import { isDiffKind, type DiffFrame, type DiffPixel } from '../types.js';

export const W2_VERSION = 1;
export const W2_HEADER_BYTES = 7; // u8 version + u32 seq + u16 count
export const W2_ENTRY_BYTES = 6; // u16 x + u16 y + u8 c + u8 kind
export const W2_MAX_COUNT = 0xffff;
export const W2_MAX_SEQ = 0xffff_ffff;

export function w2ByteLength(count: number): number {
  return W2_HEADER_BYTES + count * W2_ENTRY_BYTES;
}

function assertU16(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError(`W2: ${what} must be a u16, got ${value}`);
  }
}

export function encodeW2(frame: DiffFrame): Uint8Array {
  const { version, seq, pixels } = frame;
  if (version !== W2_VERSION) {
    throw new RangeError(`W2: unsupported version ${version}, expected ${W2_VERSION}`);
  }
  if (!Number.isInteger(seq) || seq < 0 || seq > W2_MAX_SEQ) {
    throw new RangeError(`W2: seq must be a u32, got ${seq}`);
  }
  if (pixels.length > W2_MAX_COUNT) {
    throw new RangeError(`W2: ${pixels.length} pixels exceeds u16 count (${W2_MAX_COUNT})`);
  }

  const buf = new Uint8Array(w2ByteLength(pixels.length));
  const view = new DataView(buf.buffer);
  buf[0] = W2_VERSION;
  view.setUint32(1, seq, false);
  view.setUint16(5, pixels.length, false);

  let off = W2_HEADER_BYTES;
  for (const p of pixels) {
    assertU16(p.x, 'x');
    assertU16(p.y, 'y');
    if (!isValidColorIndex(p.c)) throw new RangeError(`W2: invalid palette index ${p.c}`);
    if (!isDiffKind(p.kind)) throw new RangeError(`W2: invalid kind ${p.kind}`);
    view.setUint16(off, p.x, false);
    view.setUint16(off + 2, p.y, false);
    buf[off + 4] = p.c;
    buf[off + 5] = p.kind;
    off += W2_ENTRY_BYTES;
  }
  return buf;
}

export function decodeW2(bytes: Uint8Array): DiffFrame {
  if (bytes.length < W2_HEADER_BYTES) {
    throw new RangeError(`W2: frame too short (${bytes.length} bytes)`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(0);
  if (version !== W2_VERSION) {
    throw new RangeError(`W2: unsupported version ${version}, expected ${W2_VERSION}`);
  }
  const seq = view.getUint32(1, false);
  const count = view.getUint16(5, false);
  const expected = w2ByteLength(count);
  if (bytes.length !== expected) {
    throw new RangeError(`W2: frame is ${bytes.length} bytes, header declares ${count} pixels (${expected})`);
  }

  const pixels: DiffPixel[] = new Array(count);
  let off = W2_HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    const c = view.getUint8(off + 4);
    const kind = view.getUint8(off + 5);
    if (!isValidColorIndex(c)) throw new RangeError(`W2: entry ${i} has invalid palette index ${c}`);
    if (!isDiffKind(kind)) throw new RangeError(`W2: entry ${i} has invalid kind ${kind}`);
    pixels[i] = { x: view.getUint16(off, false), y: view.getUint16(off + 2, false), c, kind };
    off += W2_ENTRY_BYTES;
  }
  return { version, seq, pixels };
}

/** Apply a decoded diff frame onto a W1 grid, in place. Returns the same grid. */
export function applyW2ToW1(grid: Uint8Array, w: number, h: number, frame: DiffFrame): Uint8Array {
  for (const p of frame.pixels) {
    if (p.x >= w || p.y >= h) throw new RangeError(`W2: (${p.x},${p.y}) outside ${w}x${h} grid`);
    grid[p.y * w + p.x] = p.c;
  }
  return grid;
}
