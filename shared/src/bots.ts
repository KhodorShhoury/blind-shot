import type { BotLevel, GameConfig, Rng } from './config';
import { TAU, normAngle } from './geometry';

export interface BotPlan {
  /** Where the bot decides to walk to (hidden from everybody, like any other position). */
  dest: { x: number; y: number };
  /** ms after round start at which it starts walking. */
  moveAt: number;
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
 * Picks a plan for a bot. Bots are as blind as humans: the only thing they know is their OWN position
 * (never opponents' positions, earlier shots or anything else). They wander to a random spot and then
 * aim; the one heuristic available is geometry: aiming through the middle of the arena covers more of
 * the floor than aiming at a wall.
 */
export function planBot(
  self: { x: number; y: number },
  level: BotLevel,
  cfg: GameConfig,
  rng: Rng,
  aimMs: number,
): BotPlan {
  const p = cfg.bots[level];
  const m = cfg.arena.wallMargin;
  const dest = { x: Math.round(m + rng() * (cfg.arena.w - 2 * m)), y: Math.round(m + rng() * (cfg.arena.h - 2 * m)) };
  const toCenter = Math.atan2(cfg.arena.h / 2 - dest.y, cfg.arena.w / 2 - dest.x);
  const spread = (p.spreadDeg * Math.PI) / 180;
  const pick = (): number => {
    if (rng() < p.centerBias) return normAngle(toCenter + gauss(rng) * (spread / 2));
    return normAngle(rng() * TAU);
  };
  void self;
  const aim1 = pick();
  return {
    dest,
    moveAt: aimMs * rng() * 0.2,
    aim1,
    aim2: rng() < p.rethink ? pick() : null,
    switchAt: aimMs * (0.3 + rng() * 0.3),
    lockAt: aimMs * (p.lockMin + rng() * (p.lockMax - p.lockMin)),
  };
}
