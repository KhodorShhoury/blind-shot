import type { BotLevel, GameConfig, Rng } from './config';
import { TAU, traceBeam, type BeamTarget } from './geometry';

export interface BotPlan {
  aim1: number;
  aim2: number | null;
  /** ms after round start */
  switchAt: number;
  lockAt: number;
}

interface Run {
  id: string;
  center: number;
  width: number;
  bounces: number;
}

const STEP = (0.5 * Math.PI) / 180;

/** Scan all angles and group contiguous ranges that first-hit a given opponent. */
export function findSolutions(
  self: BeamTarget,
  all: BeamTarget[],
  pillarR: number,
  cfg: GameConfig,
): Run[] {
  const n = Math.round(TAU / STEP);
  const hits: (string | null)[] = [];
  const bnc: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = traceBeam(self.x, self.y, i * STEP, all, self.id, pillarR, cfg);
    hits.push(r.hitId);
    bnc.push(r.bounces);
  }
  const runs: Run[] = [];
  let i = 0;
  // start at an index where the id changes so runs don't wrap
  let start = 0;
  for (let k = 0; k < n; k++) if (hits[k] !== hits[(k + n - 1) % n]) { start = k; break; }
  while (i < n) {
    const idx = (start + i) % n;
    const id = hits[idx];
    let len = 1;
    while (i + len < n && hits[(start + i + len) % n] === id) len++;
    if (id) runs.push({ id, center: (start + i + (len - 1) / 2) * STEP, width: len * STEP, bounces: bnc[idx] });
    i += len;
  }
  return runs;
}

function gauss(rng: Rng): number {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(TAU * rng());
}

/**
 * Picks a firing plan for a bot. `threat` is how dangerous each opponent looked in earlier rounds
 * (their beams came close to us). Easy bots miss a lot, hard bots are accurate but still beatable
 * because everyone fires simultaneously and moves every round.
 */
export function planBot(
  self: BeamTarget,
  all: BeamTarget[],
  pillarR: number,
  level: BotLevel,
  threat: Record<string, number>,
  cfg: GameConfig,
  rng: Rng,
  aimMs: number,
): BotPlan {
  const p = cfg.bots[level];
  const runs = findSolutions(self, all, pillarR, cfg);
  const pickAim = (exclude?: string): number => {
    const pool = runs.filter((r) => r.id !== exclude);
    if (pool.length === 0 || rng() < p.wildChance) return rng() * TAU;
    const weights = pool.map((r) => {
      const w = 0.4 + (threat[r.id] ?? 0) * 0.9 + Math.min(r.width, 0.25) * 6 - r.bounces * (level === 'hard' ? 0.1 : 0.5) + rng() * 0.8;
      return Math.max(0.05, w);
    });
    let idx = 0;
    if (level === 'hard') idx = weights.indexOf(Math.max(...weights));
    else {
      let t = rng() * weights.reduce((a, b) => a + b, 0);
      for (idx = 0; idx < weights.length - 1; idx++) {
        t -= weights[idx];
        if (t <= 0) break;
      }
    }
    const run = pool[idx];
    return run.center + gauss(rng) * ((p.noiseDeg * Math.PI) / 180);
  };
  const aim1 = pickAim();
  const rethink = rng() < p.rethink && runs.length > 1;
  const first = runs.find((r) => Math.abs(Math.atan2(Math.sin(r.center - aim1), Math.cos(r.center - aim1))) < r.width)?.id;
  return {
    aim1,
    aim2: rethink ? pickAim(first) : null,
    switchAt: aimMs * (0.3 + rng() * 0.3),
    lockAt: aimMs * (p.lockMin + rng() * (p.lockMax - p.lockMin)),
  };
}
