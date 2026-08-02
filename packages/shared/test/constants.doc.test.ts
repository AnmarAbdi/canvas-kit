/**
 * constants.ts is GENERATED from docs/01-CONSTANTS.md. This test is the generator's
 * guard rail: it re-reads the doc and fails if any exported value drifts from the
 * table it came from. "Never invent a constant" enforced in CI.
 *
 * It also enforces the M0 gate: no [DECIDE] markers remain in the kit contract docs
 * except name/domain, LAUNCH_AT and the palette hexes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as C from '../src/constants.js';

const DOCS_DIR = join(import.meta.dirname, '../../../docs');
const CONSTANTS_DOC = readFileSync(join(DOCS_DIR, '01-CONSTANTS.md'), 'utf8');

/** Value cell of the markdown row whose first cell mentions `key`. */
function docCell(key: string): string {
  const row = CONSTANTS_DOC.split('\n').find(
    (line) => line.startsWith('|') && line.split('|')[1]?.includes(key),
  );
  if (!row) throw new Error(`01-CONSTANTS.md has no row for ${key}`);
  return (row.split('|')[2] ?? '').trim();
}

/** Notes cell (3rd column) of the markdown row whose first cell mentions `key`. */
function docNotes(key: string): string {
  const row = CONSTANTS_DOC.split('\n').find(
    (line) => line.startsWith('|') && line.split('|')[1]?.includes(key),
  );
  if (!row) throw new Error(`01-CONSTANTS.md has no row for ${key}`);
  return (row.split('|')[3] ?? '').trim();
}

function docNumber(key: string): number {
  const cell = docCell(key).replace(/`/g, '');
  const match = cell.match(/^-?[\d_]+/);
  if (!match) throw new Error(`01-CONSTANTS.md row for ${key} has no leading number: "${cell}"`);
  return Number(match[0].replace(/_/g, ''));
}

function docTimestamp(key: string): number {
  const cell = docCell(key);
  const match = cell.match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/);
  if (!match) throw new Error(`01-CONSTANTS.md row for ${key} has no ISO timestamp: "${cell}"`);
  return Date.parse(match[0]);
}

describe('constants.ts matches 01-CONSTANTS.md', () => {
  it('canvas size', () => {
    const [w, h] = docCell('CANVAS_W').split('×').map((s) => Number(s.trim()));
    expect(C.CANVAS_W).toBe(w);
    expect(C.CANVAS_H).toBe(h);
  });

  it('palette size', () => {
    expect(C.PALETTE_SIZE).toBe(docNumber('PALETTE'));
    expect(docCell('PALETTE')).toContain('1 byte/pixel');
    expect(docNotes('PALETTE')).toContain('Index 0 = `#FFFFFF` = blank/white');
  });

  it.each([
    ['PRICE_BASE_UNITS', () => C.PRICE_BASE_UNITS],
    ['PLATEAU_UNITS', () => C.PLATEAU_UNITS],
    ['BULK_MAX_PIXELS', () => C.BULK_MAX_PIXELS],
    ['IMMUNITY_MS_DECEMBER', () => C.IMMUNITY_MS_DECEMBER],
    ['IMMUNITY_MS`', () => C.IMMUNITY_MS], // trailing backtick pins the exact key, not the December row
    ['FREE_COOLDOWN_MS', () => C.FREE_COOLDOWN_MS],
    ['HANDLE_MAX_CHARS', () => C.HANDLE_MAX_CHARS],
    ['QUOTE_TTL_MS', () => C.QUOTE_TTL_MS],
  ])('%s', (key, actual) => {
    expect(actual()).toBe(docNumber(key));
  });

  it.each([
    ['DECEMBER_SWITCH_AT', () => C.DECEMBER_SWITCH_AT],
    ['FREEZE_AT', () => C.FREEZE_AT],
  ])('%s', (key, actual) => {
    expect(actual()).toBe(docTimestamp(key));
  });

  it('plateau is reached at the n the doc states', () => {
    expect(docNotes('PLATEAU_UNITS')).toContain(`n=${C.PLATEAU_N}`);
    expect(C.price(C.PLATEAU_N)).toBe(C.PLATEAU_UNITS);
  });

  it('prod USDC address', () => {
    expect(CONSTANTS_DOC).toContain(C.USDC_ADDRESS_PROD);
  });

  it('networks and scheme', () => {
    expect(docCell('Network (prod)')).toContain(`\`${C.NETWORK_PROD}\``);
    expect(docCell('Network (staging)')).toContain(`\`${C.NETWORK_STAGING}\``);
    expect(docCell('Scheme')).toContain(`\`${C.X402_SCHEME}\``);
  });

  it('free tier attaches no URL (locked)', () => {
    expect(docCell('Free URL attachment')).toContain('none');
    expect(docNotes('Free URL attachment')).toContain('LOCKED');
    expect(C.FREE_URL_ALLOWED).toBe(false);
  });

  it('undecided values stay null rather than being invented', () => {
    expect(docCell('LAUNCH_AT')).toContain('[DECIDE]');
    expect(C.LAUNCH_AT).toBeNull();
    expect(C.CANVAS_DOMAIN).toBeNull();
  });

  it('staging USDC address matches the doc (resolved at M3 from @x402/evm)', () => {
    expect(CONSTANTS_DOC).toContain(C.USDC_ADDRESS_STAGING);
    expect(C.paymentTarget(true)).toEqual({
      network: C.NETWORK_STAGING,
      asset: C.USDC_ADDRESS_STAGING,
      eip712: { name: 'USDC', version: '2' },
    });
    expect(C.paymentTarget(false)).toEqual({
      network: C.NETWORK_PROD,
      asset: C.USDC_ADDRESS_PROD,
      eip712: { name: 'USD Coin', version: '2' },
    });
    // The domain name is network-specific and part of the signature: mixing them up
    // yields a signature the facilitator rejects, which is a launch-day outage.
    expect(C.USDC_EIP712_NAME_PROD).not.toBe(C.USDC_EIP712_NAME_STAGING);
    expect(CONSTANTS_DOC).toContain('USD Coin');
  });
});

describe('M0 gate: remaining [DECIDE] markers', () => {
  // Palette resolved 2026-08; only launch timing and naming remain.
  const ALLOWED = /LAUNCH_AT|domain|name/i;

  it('kit contract docs only defer palette hexes, LAUNCH_AT and name/domain', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(DOCS_DIR).filter((f) => f.endsWith('.md'))) {
      readFileSync(join(DOCS_DIR, file), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (line.includes('[DECIDE]') || line.includes('[DECIDE:')) {
            if (!ALLOWED.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});
