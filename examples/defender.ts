/**
 * Reference defender — the open-source Guardian (07-AGENT-KIT §4, D2).
 *
 * There is no hosted defence product and the house runs no privileged bot. This is the
 * same weapon everyone gets, and its limits are documented rather than hidden:
 *
 *   - It cannot beat immunity. A repaint is impossible until `immune_until` passes, so
 *     the fastest possible repair is one immunity window after the attack. That is the
 *     game's rhythm, not a flaw in this code.
 *   - It cannot outbid an attacker with a bigger budget. Every repaint costs more than
 *     the last (price doubles to a $10.24 plateau), so a determined attacker with more
 *     money wins eventually. Set `budgetUnits` at the number you are willing to lose.
 *   - Races are won by latency and budget, never by privilege.
 *
 * Strategy: watch the live diff stream, and when something inside the job's bounding
 * box changes, queue that pixel for repair the moment its immunity lapses.
 */
import { decodeW2, IMMUNITY_MS, type DiffPixel, type Job } from '@canvas2026/shared';
import { CanvasClient, BudgetExceededError, boundingBox } from '@canvas2026/client';

export interface DefenderOptions {
  client: CanvasClient;
  job: Job;
  /** Fires the callback for every incoming diff frame; injected so tests can drive it. */
  subscribe(onDiff: (pixels: DiffPixel[]) => void): { close(): void };
  handle?: string;
  /** Alerting hook: budget thresholds, ceiling hits, sustained attack. */
  onAlert?(alert: DefenderAlert): void;
  log?(message: string): void;
  now?(): number;
  sleep?(ms: number): Promise<void>;
  /** How long a repair may wait to batch neighbours. Small: speed is the product. */
  batchWindowMs?: number;
  /** Attack detection: more than this many hostile flips per minute raises an alert. */
  attackFlipsPerMin?: number;
}

export type DefenderAlert =
  | { kind: 'budget'; consumedFraction: number; spentUnits: number }
  | { kind: 'ceiling'; pixel: { x: number; y: number }; reason: string }
  | { kind: 'attack'; flipsPerMin: number }
  | { kind: 'repaired'; count: number; spentUnits: number };

export class Defender {
  private readonly wanted = new Map<string, number>(); // "x,y" → wanted colour
  private readonly damaged = new Map<string, { x: number; y: number; c: number; repairableAt: number }>();
  private readonly flipTimes: number[] = [];
  private readonly alerted = new Set<string>();
  private subscription: { close(): void } | null = null;
  private running = false;

  constructor(private readonly opts: DefenderOptions) {
    for (const p of opts.job.pixels) this.wanted.set(`${p.x},${p.y}`, p.c);
  }

  get pendingRepairs(): number {
    return this.damaged.size;
  }

  /** Diff frames land here. Cheap on purpose: this runs on every canvas write. */
  handleDiff(pixels: DiffPixel[], now = this.now()): void {
    for (const pixel of pixels) {
      const key = `${pixel.x},${pixel.y}`;
      const wantedColor = this.wanted.get(key);
      if (wantedColor === undefined) continue; // not ours

      if (pixel.c === wantedColor) {
        // Someone (maybe us) restored it.
        this.damaged.delete(key);
        continue;
      }

      // Ours, and now wrong. It cannot be repainted until immunity lapses — that is
      // the earliest honest repair time, so schedule for exactly then.
      this.damaged.set(key, { x: pixel.x, y: pixel.y, c: wantedColor, repairableAt: now + IMMUNITY_MS });
      this.flipTimes.push(now);
    }

    const cutoff = now - 60_000;
    while (this.flipTimes.length > 0 && (this.flipTimes[0] as number) < cutoff) this.flipTimes.shift();
    const rate = this.flipTimes.length;
    if (rate > (this.opts.attackFlipsPerMin ?? 20)) this.alert({ kind: 'attack', flipsPerMin: rate });
  }

  /** Pixels whose immunity has lapsed and which are still wrong. */
  dueRepairs(now = this.now()): { x: number; y: number; c: number }[] {
    return [...this.damaged.values()]
      .filter((d) => d.repairableAt <= now)
      .map(({ x, y, c }) => ({ x, y, c }));
  }

  async repairDue(): Promise<number> {
    const due = this.dueRepairs();
    if (due.length === 0) return 0;

    try {
      const outcome = await this.opts.client.paintPixels(due, this.opts.handle ? { handle: this.opts.handle } : {});
      for (const p of outcome.painted) this.damaged.delete(`${p.x},${p.y}`);
      for (const s of outcome.skipped) {
        this.alert({ kind: 'ceiling', pixel: s.pixel, reason: s.reason });
        // Above the per-pixel ceiling: stop retrying it, or the loop spins forever.
        this.damaged.delete(`${s.pixel.x},${s.pixel.y}`);
      }
      if (outcome.painted.length > 0) {
        this.alert({ kind: 'repaired', count: outcome.painted.length, spentUnits: outcome.spentUnits });
      }
      this.checkBudget();
      return outcome.painted.length;
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        this.alert({ kind: 'budget', consumedFraction: 1, spentUnits: this.opts.client.spentUnits });
        this.stop();
        return 0;
      }
      throw err;
    }
  }

  async start(): Promise<void> {
    this.running = true;
    this.subscription = this.opts.subscribe((pixels) => this.handleDiff(pixels));
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

    while (this.running) {
      await this.repairDue();
      await sleep(this.opts.batchWindowMs ?? 1_000);
    }
  }

  stop(): void {
    this.running = false;
    this.subscription?.close();
    this.subscription = null;
  }

  private checkBudget(): void {
    const total = this.opts.client.spentUnits + this.opts.client.remainingUnits;
    if (total === 0) return;
    const fraction = this.opts.client.spentUnits / total;
    for (const threshold of [0.5, 0.9]) {
      if (fraction >= threshold && !this.alerted.has(`budget-${threshold}`)) {
        this.alerted.add(`budget-${threshold}`);
        this.alert({ kind: 'budget', consumedFraction: threshold, spentUnits: this.opts.client.spentUnits });
      }
    }
  }

  private alert(alert: DefenderAlert): void {
    this.opts.onAlert?.(alert);
    this.opts.log?.(JSON.stringify(alert));
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }
}

/** WebSocket subscription to /api/live, decoding W2 frames. */
export function liveSubscription(baseUrl: string, job: Job) {
  const box = boundingBox(job.pixels);
  return (onDiff: (pixels: DiffPixel[]) => void) => {
    const url = new URL('/api/live', baseUrl);
    url.protocol = url.protocol.replace('http', 'ws');
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('message', (event) => {
      if (typeof event.data === 'string') return; // hello / resnapshot notices
      const frame = decodeW2(new Uint8Array(event.data as ArrayBuffer));
      if (!box) return;
      const relevant = frame.pixels.filter(
        (p) => p.x >= box.x && p.y >= box.y && p.x < box.x + box.w && p.y < box.y + box.h,
      );
      if (relevant.length > 0) onDiff(relevant);
    });
    return { close: () => ws.close() };
  };
}
