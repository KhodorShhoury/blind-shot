import { describe, expect, it } from 'vitest';
import { buildConfig, DEFAULT_CONFIG, seededRng } from '@shared/config';
import { randomSpawns, traceBeam } from '@shared/geometry';

const cfg = buildConfig();

describe('traceBeam', () => {
  it('hits a target straight ahead', () => {
    const r = traceBeam(100, 500, 0, [{ id: 'b', x: 600, y: 500 }], 'a', cfg);
    expect(r.hitId).toBe('b');
    expect(r.end).toBe('player');
  });

  it('stops at the NEAREST target along the beam', () => {
    const r = traceBeam(100, 500, 0, [{ id: 'far', x: 800, y: 500 }, { id: 'near', x: 400, y: 500 }], 'a', cfg);
    expect(r.hitId).toBe('near');
    expect(r.points[r.points.length - 2]).toBeLessThan(400);
  });

  it('accounts for beam thickness and hitbox radius', () => {
    const reach = cfg.arena.playerRadius + cfg.beam.halfWidth;
    const hit = traceBeam(100, 500, 0, [{ id: 'b', x: 600, y: 500 + reach - 1 }], 'a', cfg);
    const miss = traceBeam(100, 500, 0, [{ id: 'b', x: 600, y: 500 + reach + 1 }], 'a', cfg);
    expect(hit.hitId).toBe('b');
    expect(miss.hitId).toBeNull();
  });

  it('never hits its owner', () => {
    const r = traceBeam(500, 500, Math.PI / 2, [{ id: 'a', x: 500, y: 500 }], 'a', cfg);
    expect(r.hitId).toBeNull();
  });

  it('travels in a straight line to the arena boundary (no bounces by default)', () => {
    const r = traceBeam(300, 400, 0.4, [], 'a', cfg);
    expect(r.end).toBe('range');
    expect(r.bounces).toBe(0);
    expect(r.points).toHaveLength(4);
    const [, , ex, ey] = r.points;
    expect(ex === 0 || ey === 0 || ex === cfg.arena.w || ey === cfg.arena.h).toBe(true);
  });

  it('does not hit a player behind the shooter', () => {
    const r = traceBeam(500, 500, 0, [{ id: 'b', x: 200, y: 500 }], 'a', cfg);
    expect(r.hitId).toBeNull();
  });

  it('can still bounce when the config enables it', () => {
    const c = buildConfig({ beam: { maxBounces: 1 } });
    const shooter = { x: 200, y: 600 };
    const target = { id: 'b', x: 700, y: 300 };
    const mirror = { x: 700, y: -300 }; // mirror image across the top wall
    const angle = Math.atan2(mirror.y - shooter.y, mirror.x - shooter.x);
    const r = traceBeam(shooter.x, shooter.y, angle, [target], 'a', c);
    expect(r.bounces).toBe(1);
    expect(r.hitId).toBe('b');
  });
});

describe('randomSpawns', () => {
  const { w, h, spawnMargin, minPlayerDist, playerRadius } = DEFAULT_CONFIG.arena;

  it('keeps every player inside the margin and apart from each other', () => {
    for (let seed = 1; seed <= 300; seed++) {
      for (const n of [2, 3, 4]) {
        const pts = randomSpawns(n, DEFAULT_CONFIG, seededRng(seed * 7 + n));
        expect(pts).toHaveLength(n);
        for (const p of pts) {
          expect(p.x).toBeGreaterThanOrEqual(spawnMargin);
          expect(p.x).toBeLessThanOrEqual(w - spawnMargin);
          expect(p.y).toBeGreaterThanOrEqual(spawnMargin);
          expect(p.y).toBeLessThanOrEqual(h - spawnMargin);
        }
        for (let i = 0; i < n; i++)
          for (let j = i + 1; j < n; j++) expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThanOrEqual(minPlayerDist - 1);
      }
    }
  });

  it('is a fresh draw every time (no fixed pattern, no dependence on the previous call)', () => {
    const rng = seededRng(99);
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(JSON.stringify(randomSpawns(4, DEFAULT_CONFIG, rng)));
    expect(seen.size).toBe(50);
  });

  it('covers the whole arena fairly (no centre/corner bias)', () => {
    const rng = seededRng(5);
    const quad = [0, 0, 0, 0];
    let total = 0;
    for (let i = 0; i < 2000; i++) {
      for (const p of randomSpawns(2, DEFAULT_CONFIG, rng)) {
        quad[(p.x > w / 2 ? 1 : 0) + (p.y > h / 2 ? 2 : 0)]++;
        total++;
      }
    }
    for (const q of quad) expect(q / total).toBeGreaterThan(0.22);
  });

  it('still produces valid non-overlapping spots with a degenerate RNG (fallback grid)', () => {
    for (const v of [0, 0.999999]) {
      const pts = randomSpawns(4, DEFAULT_CONFIG, () => v);
      expect(pts).toHaveLength(4);
      for (let i = 0; i < 4; i++)
        for (let j = i + 1; j < 4; j++) expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThan(playerRadius * 2);
    }
  });
});
