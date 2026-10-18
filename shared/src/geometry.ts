import type { GameConfig, Rng } from './config';

export interface BeamTarget {
  id: string;
  x: number;
  y: number;
}

export interface BeamResult {
  /** Flat polyline [x0,y0,x1,y1,...] including wall bounce points and the end point. */
  points: number[];
  hitId: string | null;
  end: 'player' | 'range';
  bounces: number;
  length: number;
}

export const TAU = Math.PI * 2;

export function normAngle(a: number): number {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

/** Distance along a unit-direction ray to a circle, or Infinity. */
function rayCircle(px: number, py: number, dx: number, dy: number, cx: number, cy: number, r: number): number {
  const ox = px - cx;
  const oy = py - cy;
  const b = dx * ox + dy * oy;
  const c = ox * ox + oy * oy - r * r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  if (t > 1e-6) return t;
  return Infinity;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Traces a laser from (ox,oy). The beam bounces off the arena walls up to cfg.beam.maxBounces times,
 * stops at the nearest player body (never its owner).
 */
export function traceBeam(
  ox: number,
  oy: number,
  angle: number,
  targets: BeamTarget[],
  ownerId: string | null,
  cfg: GameConfig,
): BeamResult {
  const { w, h, playerRadius } = cfg.arena;
  const hitR = playerRadius + cfg.beam.halfWidth;
  let dx = Math.cos(angle);
  let dy = Math.sin(angle);
  let px = ox;
  let py = oy;
  let remaining = cfg.beam.maxLength;
  let bounces = 0;
  const points = [r1(px), r1(py)];
  let hitId: string | null = null;
  let end: BeamResult['end'] = 'range';

  for (let seg = 0; seg <= cfg.beam.maxBounces; seg++) {
    const tx = dx > 1e-12 ? (w - px) / dx : dx < -1e-12 ? (0 - px) / dx : Infinity;
    const ty = dy > 1e-12 ? (h - py) / dy : dy < -1e-12 ? (0 - py) / dy : Infinity;
    const tWall = Math.max(0, Math.min(tx, ty));

    let tPlayer = Infinity;
    let pid: string | null = null;
    for (const t of targets) {
      if (t.id === ownerId) continue;
      const d = rayCircle(px, py, dx, dy, t.x, t.y, hitR);
      if (d < tPlayer) {
        tPlayer = d;
        pid = t.id;
      }
    }
    if (tPlayer < tWall && tPlayer <= remaining) {
      px += dx * tPlayer;
      py += dy * tPlayer;
      points.push(r1(px), r1(py));
      remaining -= tPlayer;
      hitId = pid;
      end = 'player';
      break;
    }
    if (tWall >= remaining) {
      px += dx * remaining;
      py += dy * remaining;
      points.push(r1(px), r1(py));
      remaining = 0;
      end = 'range';
      break;
    }
    // reach wall
    px += dx * tWall;
    py += dy * tWall;
    remaining -= tWall;
    points.push(r1(px), r1(py));
    if (seg === cfg.beam.maxBounces) {
      end = 'range'; // absorbed by the final wall
      break;
    }
    if (tx <= ty + 1e-9) dx = -dx;
    if (ty <= tx + 1e-9) dy = -dy;
    bounces++;
  }
  return { points, hitId, end, bounces, length: cfg.beam.maxLength - remaining };
}

/** Shortest distance from point to a polyline (flat array). */
export function distToPolyline(points: number[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i + 3 < points.length; i += 2) {
    const x1 = points[i], y1 = points[i + 1], x2 = points[i + 2], y2 = points[i + 3];
    const vx = x2 - x1, vy = y2 - y1;
    const len2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((x - x1) * vx + (y - y1) * vy) / len2));
    best = Math.min(best, Math.hypot(x - (x1 + vx * t), y - (y1 + vy * t)));
  }
  return best;
}
