import { describe, expect, it } from 'vitest';
import { buildConfig } from '@shared/config';
import { traceBeam } from '@shared/geometry';

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
