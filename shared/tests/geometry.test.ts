import { describe, expect, it } from 'vitest';
import { buildConfig, DEFAULT_CONFIG, seededRng } from '@shared/config';
import { formation, pillarRadius, traceBeam } from '@shared/geometry';

const cfg = buildConfig({ arena: { pillarBase: 0 } });

describe('traceBeam', () => {
  it('hits a target straight ahead', () => {
    const r = traceBeam(100, 500, 0, [{ id: 'b', x: 600, y: 500 }], 'a', 0, cfg);
    expect(r.hitId).toBe('b');
    expect(r.end).toBe('player');
  });

  it('stops at the NEAREST target along the beam', () => {
    const r = traceBeam(100, 500, 0, [{ id: 'far', x: 800, y: 500 }, { id: 'near', x: 400, y: 500 }], 'a', 0, cfg);
    expect(r.hitId).toBe('near');
    expect(r.points[r.points.length - 2]).toBeLessThan(400);
  });

  it('accounts for beam thickness and hitbox radius', () => {
    const reach = cfg.arena.playerRadius + cfg.beam.halfWidth;
    const hit = traceBeam(100, 500, 0, [{ id: 'b', x: 600, y: 500 + reach - 1 }], 'a', 0, cfg);
    const miss = traceBeam(100, 500, 0, [{ id: 'b', x: 600, y: 500 + reach + 1 }], 'a', 0, cfg);
    expect(hit.hitId).toBe('b');
    expect(miss.hitId).toBeNull();
  });

  it('never hits its owner, even after a bounce', () => {
    const r = traceBeam(500, 500, Math.PI / 2, [{ id: 'a', x: 500, y: 500 }], 'a', 0, cfg);
    expect(r.hitId).toBeNull();
  });

  it('is absorbed by the central pillar', () => {
    const r = traceBeam(100, 500, 0, [{ id: 'b', x: 900, y: 500 }], 'a', 60, cfg);
    expect(r.end).toBe('pillar');
    expect(r.hitId).toBeNull();
  });

  it('bounces off walls and can hit a player from the side', () => {
    // shooter at (200,800) fires up-right at 45°; hits the right wall? choose geometry: bounce off top wall
    const shooter = { x: 200, y: 600 };
    // beam aimed at the mirror image of the target across the top wall (y=0)
    const target = { id: 'b', x: 700, y: 300 };
    const mirror = { x: 700, y: -300 };
    const angle = Math.atan2(mirror.y - shooter.y, mirror.x - shooter.x);
    const r = traceBeam(shooter.x, shooter.y, angle, [target], 'a', 0, cfg);
    expect(r.bounces).toBe(1);
    expect(r.hitId).toBe('b');
    expect(r.points.length).toBe(6);
  });

  it('ends at max range when nothing is hit', () => {
    const r = traceBeam(500, 500, 0.3, [], 'a', 0, cfg);
    expect(r.end).toBe('range');
    expect(r.bounces).toBe(cfg.beam.maxBounces);
  });
});

describe('arena rules', () => {
  it('pillar collapses to zero', () => {
    expect(pillarRadius(1, DEFAULT_CONFIG)).toBe(DEFAULT_CONFIG.arena.pillarBase);
    expect(pillarRadius(DEFAULT_CONFIG.arena.pillarCollapseRound + 1, DEFAULT_CONFIG)).toBe(0);
  });

  it('formations are centre-symmetric and equidistant', () => {
    for (const n of [2, 3, 4]) {
      const pts = formation(n, DEFAULT_CONFIG, seededRng(n));
      expect(pts).toHaveLength(n);
      for (const p of pts) expect(Math.abs(Math.hypot(p.x - 500, p.y - 500) - DEFAULT_CONFIG.arena.spawnRadius)).toBeLessThan(1);
    }
  });
});
