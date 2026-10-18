import type { BotLevel, GameConfig, Rng } from './config';
import { TAU, normAngle } from './geometry';

export interface BotPlan {
  aim1: number;
  aim2: number | null;
  /** ms after round start */
  switchAt: number;
  lockAt: number;
}

function gauss(rng: Rng): number {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(TAU * rng());
}

/**
 * Picks a firing plan for a bot. Bots are as blind as humans: the only thing they know is their OWN
 * position (never opponents' positions, earlier shots or anything else). The one heuristic available
 * is geometry: aiming through the middle of the arena covers more of the floor than aiming at a wall.
 */
export function planBot(
  self: { x: number; y: number },
  level: BotLevel,
  cfg: GameConfig,
  rng: Rng,
  aimMs: number,
): BotPlan {
  const p = cfg.bots[level];
  const toCenter = Math.atan2(cfg.arena.h / 2 - self.y, cfg.arena.w / 2 - self.x);
  const spread = (p.spreadDeg * Math.PI) / 180;
  const pick = (): number => {
    if (rng() < p.centerBias) return normAngle(toCenter + gauss(rng) * (spread / 2));
    return normAngle(rng() * TAU);
  };
  const aim1 = pick();
  return {
    aim1,
    aim2: rng() < p.rethink ? pick() : null,
    switchAt: aimMs * (0.3 + rng() * 0.3),
    lockAt: aimMs * (p.lockMin + rng() * (p.lockMax - p.lockMin)),
  };
}
