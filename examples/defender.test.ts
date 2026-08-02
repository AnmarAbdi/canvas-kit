/**
 * Defender behaviour. The M5 gate wants "detects and repairs a scripted attack within
 * one immunity window" — that run happens on staging, but the timing rule it depends on
 * is decided here: a repair is scheduled for exactly when immunity lapses, never later.
 */
import { describe, it, expect, vi } from 'vitest';
import { IMMUNITY_MS, PRICE_BASE_UNITS, DiffKind, type Job } from '@canvas2026/shared';
import { CanvasClient } from '@canvas2026/client';
import { Defender, type DefenderAlert } from './defender.js';

const job: Job = {
  canvas: '2026',
  version: 1,
  pixels: [
    { x: 10, y: 10, c: 4 },
    { x: 11, y: 10, c: 4 },
    { x: 12, y: 10, c: 5 },
  ],
};

function harness(options: { paintFails?: boolean; skipAll?: boolean } = {}) {
  let now = 1_000_000;
  const alerts: DefenderAlert[] = [];
  const painted: { x: number; y: number; c: number }[] = [];

  const client = {
    spentUnits: 0,
    remainingUnits: 1_000_000,
    paintPixels: vi.fn(async (pixels: { x: number; y: number; c: number }[]) => {
      if (options.paintFails) throw new Error('boom');
      if (options.skipAll) {
        return { painted: [], skipped: pixels.map((pixel) => ({ pixel, reason: 'above per-pixel ceiling' })), spentUnits: 0, receipts: [] };
      }
      painted.push(...pixels);
      return { painted: pixels, skipped: [], spentUnits: PRICE_BASE_UNITS * pixels.length, receipts: [] };
    }),
  } as unknown as CanvasClient;

  const defender = new Defender({
    client,
    job,
    subscribe: () => ({ close: () => {} }),
    onAlert: (a) => alerts.push(a),
    now: () => now,
    sleep: async () => {},
  });

  return { defender, client, alerts, painted, advance: (ms: number) => (now += ms), at: () => now };
}

const attack = (x: number, c = 9) => [{ x, y: 10, c, kind: DiffKind.PAID as const }];

describe('detection', () => {
  it('notices a pixel of ours turning the wrong colour', () => {
    const h = harness();
    h.defender.handleDiff(attack(10));
    expect(h.defender.pendingRepairs).toBe(1);
  });

  it('ignores pixels outside the job', () => {
    const h = harness();
    h.defender.handleDiff([{ x: 400, y: 400, c: 9, kind: DiffKind.PAID }]);
    expect(h.defender.pendingRepairs).toBe(0);
  });

  it('ignores a repaint that happens to match what we want', () => {
    const h = harness();
    h.defender.handleDiff([{ x: 10, y: 10, c: 4, kind: DiffKind.PAID }]);
    expect(h.defender.pendingRepairs).toBe(0);
  });

  it('forgets a pixel someone else restored before we got to it', () => {
    const h = harness();
    h.defender.handleDiff(attack(10));
    h.defender.handleDiff([{ x: 10, y: 10, c: 4, kind: DiffKind.FREE }]);
    expect(h.defender.pendingRepairs).toBe(0);
  });
});

describe('timing — the immunity window is the floor, and the target', () => {
  it('does not attempt a repair while the attacker\u2019s pixel is immune', async () => {
    const h = harness();
    h.defender.handleDiff(attack(10));

    expect(h.defender.dueRepairs()).toHaveLength(0);
    h.advance(IMMUNITY_MS - 1);
    expect(h.defender.dueRepairs()).toHaveLength(0);
    expect(await h.defender.repairDue()).toBe(0);
    expect(h.client.paintPixels).not.toHaveBeenCalled();
  });

  it('repairs the instant immunity lapses — one window, not two', async () => {
    const h = harness();
    h.defender.handleDiff(attack(10));

    h.advance(IMMUNITY_MS);
    expect(h.defender.dueRepairs()).toEqual([{ x: 10, y: 10, c: 4 }]);

    const repaired = await h.defender.repairDue();
    expect(repaired).toBe(1);
    expect(h.painted).toEqual([{ x: 10, y: 10, c: 4 }]);
    expect(h.defender.pendingRepairs).toBe(0);
  });

  it('batches everything that came due together, so a wide attack is one request', async () => {
    const h = harness();
    h.defender.handleDiff([...attack(10), ...attack(11), ...attack(12)]);
    h.advance(IMMUNITY_MS);

    await h.defender.repairDue();
    expect(h.client.paintPixels).toHaveBeenCalledOnce();
    expect(h.painted).toHaveLength(3);
    // Each pixel is restored to ITS colour, not a single colour for the batch.
    expect(h.painted.find((p) => p.x === 12)?.c).toBe(5);
  });

  it('re-arms if the attacker comes back', async () => {
    const h = harness();
    h.defender.handleDiff(attack(10));
    h.advance(IMMUNITY_MS);
    await h.defender.repairDue();

    h.defender.handleDiff(attack(10, 7));
    expect(h.defender.pendingRepairs).toBe(1);
    h.advance(IMMUNITY_MS);
    expect(await h.defender.repairDue()).toBe(1);
  });
});

describe('alerting', () => {
  it('raises an attack alert on sustained flipping', () => {
    const h = harness();
    for (let i = 0; i < 25; i++) {
      h.defender.handleDiff([{ x: 10 + (i % 3), y: 10, c: 9 + (i % 2), kind: DiffKind.PAID }]);
    }
    expect(h.alerts.some((a) => a.kind === 'attack')).toBe(true);
  });

  it('does not cry attack over a single flip', () => {
    const h = harness();
    h.defender.handleDiff(attack(10));
    expect(h.alerts.some((a) => a.kind === 'attack')).toBe(false);
  });

  it('reports repairs with what they cost', async () => {
    const h = harness();
    h.defender.handleDiff(attack(10));
    h.advance(IMMUNITY_MS);
    await h.defender.repairDue();

    const repaired = h.alerts.find((a) => a.kind === 'repaired');
    expect(repaired).toMatchObject({ kind: 'repaired', count: 1, spentUnits: PRICE_BASE_UNITS });
  });

  it('gives up on a pixel above the ceiling instead of spinning on it', async () => {
    const h = harness({ skipAll: true });
    h.defender.handleDiff(attack(10));
    h.advance(IMMUNITY_MS);

    await h.defender.repairDue();
    expect(h.alerts.some((a) => a.kind === 'ceiling')).toBe(true);
    expect(h.defender.pendingRepairs).toBe(0); // dropped, not retried forever
  });
});
