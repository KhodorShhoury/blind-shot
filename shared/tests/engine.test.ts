import { describe, expect, it } from 'vitest';
import { buildConfig, seededRng } from '@shared/config';
import { MatchEngine, type PlayerInit } from '@shared/engine';

const cfg = buildConfig({ arena: { pillarBase: 0 }, room: { disconnectGraceMs: 5000 } });
const T = cfg.timing;
const zero = () => 0; // deterministic: no shuffle, base angle 0

function make(n: number, c = cfg, rng = zero) {
  const inits: PlayerInit[] = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, slot: i }));
  const events: string[] = [];
  const e = new MatchEngine(inits, rng, c, (ev) => events.push(ev));
  e.start(0);
  return { e, events };
}

function aimAt(e: MatchEngine, from: string, to: string) {
  const s = e.snapshot(0);
  const a = s.players.find((p) => p.id === from)!;
  const b = s.players.find((p) => p.id === to)!;
  e.setAim(from, Math.atan2(b.y - a.y, b.x - a.x));
}

function aimAway(e: MatchEngine, id: string, off = 0.35) {
  const a = e.snapshot(0).players.find((p) => p.id === id)!;
  e.setAim(id, Math.atan2(a.y - 500, a.x - 500) + off);
}

/** Advance to the fire reveal. */
function playRound(e: MatchEngine, t0 = 0) {
  e.tick(t0 + T.aimMs);
  e.tick(t0 + T.aimMs + T.lockMs);
  return t0 + T.aimMs + T.lockMs;
}

describe('MatchEngine phases', () => {
  it('runs aiming → lock → fire → result → next round', () => {
    const { e, events } = make(3);
    expect(e.phase).toBe('aiming');
    e.tick(T.aimMs);
    expect(e.phase).toBe('lock');
    e.tick(T.aimMs + T.lockMs);
    expect(e.phase).toBe('fire');
    e.tick(T.aimMs + T.lockMs + T.fireMs);
    expect(e.phase).toBe('result');
    expect(events).toEqual(['round', 'lock', 'fire', 'result']);
  });

  it('ends aiming early after everyone locks (with grace)', () => {
    const { e } = make(2);
    e.setLocked('p0', true);
    e.setLocked('p1', true);
    e.tick(100);
    expect(e.phase).toBe('aiming');
    e.tick(100 + T.allLockedGraceMs);
    expect(e.phase).toBe('lock');
  });

  it('allows unlocking before the grace period ends', () => {
    const { e } = make(2);
    e.setLocked('p0', true);
    e.setLocked('p1', true);
    e.tick(100);
    e.setLocked('p0', false);
    e.tick(100 + T.allLockedGraceMs + 10);
    expect(e.phase).toBe('aiming');
  });

  it('ignores aim changes while locked and after the aiming phase', () => {
    const { e } = make(2);
    e.setAim('p0', 1);
    e.setLocked('p0', true);
    e.setAim('p0', 2);
    expect(e.snapshot(0, 'p0').you!.aim).toBeCloseTo(1, 2);
    e.tick(T.aimMs);
    e.setLocked('p0', false);
    expect(e.snapshot(T.aimMs, 'p0').you!.locked).toBe(true);
  });
});

describe('secrecy', () => {
  it("never leaks other players' aim before the reveal", () => {
    const { e } = make(3);
    e.setAim('p1', 1.2345);
    e.setAim('p2', -2.5);
    const json = JSON.stringify(e.snapshot(0, 'p0'));
    expect(json).not.toContain('1.2345');
    expect(json).not.toContain('-2.5');
    expect(JSON.stringify(e.snapshot(0))).not.toContain('"aim"');
    e.tick(T.aimMs);
    expect(e.snapshot(T.aimMs, 'p0').shots).toHaveLength(0);
  });

  it('reveals all shots after firing', () => {
    const { e } = make(3);
    const t = playRound(e);
    expect(e.snapshot(t).shots).toHaveLength(3);
  });
});

describe('volley resolution', () => {
  it('mutual head-on kill is a draw in a 2-player game', () => {
    const { e, events } = make(2);
    aimAt(e, 'p0', 'p1');
    aimAt(e, 'p1', 'p0');
    const t = playRound(e);
    const s = e.snapshot(t);
    expect(s.players.every((p) => !p.alive)).toBe(true);
    e.tick(t + T.fireMs + T.resultMs);
    const f = e.snapshot(t + T.fireMs + T.resultMs);
    expect(f.phase).toBe('over');
    expect(f.draw).toBe(true);
    expect(f.winnerId).toBeNull();
    expect(events.at(-1)).toBe('over');
  });

  it('a player killed in the same volley still fires their committed shot', () => {
    const { e } = make(3);
    // p0 -> p1, p1 -> p2, p2 -> p0 : all three die simultaneously
    aimAt(e, 'p0', 'p1');
    aimAt(e, 'p1', 'p2');
    aimAt(e, 'p2', 'p0');
    const s = e.snapshot(playRound(e));
    expect(s.eliminations).toHaveLength(3);
    expect(s.players.filter((p) => p.alive)).toHaveLength(0);
  });

  it('handles multiple eliminations with a surviving winner', () => {
    const { e } = make(3);
    aimAt(e, 'p0', 'p1');
    aimAt(e, 'p1', 'p0');
    aimAt(e, 'p2', 'p0');
    const t = playRound(e);
    const s = e.snapshot(t);
    expect(s.eliminations.map((x) => x.victimId).sort()).toEqual(['p0', 'p1']);
    expect(s.eliminations.find((x) => x.victimId === 'p0')!.killerIds.sort()).toEqual(['p1', 'p2']);
    e.tick(t + T.fireMs + T.resultMs);
    const f = e.snapshot(t + T.fireMs + T.resultMs);
    expect(f.phase).toBe('over');
    expect(f.winnerId).toBe('p2');
    expect(f.standings[0]).toMatchObject({ id: 'p2', place: 1 });
    expect(f.standings.find((x) => x.id === 'p1')!.place).toBe(2);
  });

  it('continues to the next round when 2+ survive and repositions players', () => {
    const { e } = make(4, buildConfig({ arena: { pillarBase: 0 }, beam: { maxBounces: 0 } }));
    aimAt(e, 'p0', 'p1'); // p0 kills p1; everyone else aims harmlessly outward
    aimAway(e, 'p1'); aimAway(e, 'p2'); aimAway(e, 'p3');
    const t = playRound(e);
    e.tick(t + T.fireMs + T.resultMs);
    const s = e.snapshot(t + T.fireMs + T.resultMs);
    expect(s.phase).toBe('aiming');
    expect(s.round).toBe(2);
    expect(s.players.filter((p) => p.alive).length).toBeGreaterThanOrEqual(2);
  });
});

describe('disconnects', () => {
  it('disconnected player is auto-locked and still fires', () => {
    const { e } = make(2);
    aimAt(e, 'p0', 'p1');
    e.setConnected('p0', false, 10);
    expect(e.snapshot(10, 'p0').you!.locked).toBe(true);
    e.setAim('p1', Math.PI / 2);
    const t = playRound(e);
    expect(e.snapshot(t).shots.find((s) => s.shooterId === 'p0')!.hitId).toBe('p1');
  });

  it('forfeits after the grace period and awards the win', () => {
    const { e } = make(2);
    aimAway(e, 'p1', Math.PI / 2);
    e.setConnected('p1', false, 0);
    // nobody hits anything
    aimAway(e, 'p0', Math.PI / 2);
    const t = playRound(e);
    const end = t + T.fireMs + T.resultMs;
    e.tick(end);
    const s = e.snapshot(end);
    expect(s.phase).toBe('over');
    expect(s.winnerId).toBe('p0');
  });

  it('a reconnect within the grace period keeps the player alive', () => {
    const { e } = make(2);
    aimAway(e, 'p0', Math.PI / 2);
    aimAway(e, 'p1', Math.PI / 2);
    e.setConnected('p1', false, 0);
    e.setConnected('p1', true, 1000);
    const t = playRound(e);
    e.tick(t + T.fireMs + T.resultMs);
    expect(e.phase).toBe('aiming');
  });
});

describe('bots', () => {
  it('bot-only matches always terminate (pillar collapse prevents stalemates)', () => {
    for (const level of ['easy', 'normal', 'hard'] as const) {
      const inits: PlayerInit[] = [0, 1, 2, 3].map((i) => ({ id: 'b' + i, name: 'B' + i, slot: i, botLevel: level }));
      const rng = seededRng(42);
      const e = new MatchEngine(inits, rng, buildConfig({ timing: { aimMs: 1000 } }));
      let now = 0;
      e.start(now);
      let guard = 0;
      while (e.phase !== 'over' && guard++ < 20000) {
        now += 50;
        e.tick(now);
      }
      expect(e.phase).toBe('over');
      expect(e.round).toBeLessThan(40);
    }
  });

  it('hard bots score kills more often than easy bots', () => {
    const wins = { easy: 0, hard: 0 };
    for (let seed = 1; seed <= 60; seed++) {
      const inits: PlayerInit[] = [
        { id: 'easy', name: 'E', slot: 0, botLevel: 'easy' },
        { id: 'hard', name: 'H', slot: 1, botLevel: 'hard' },
      ];
      const e = new MatchEngine(inits, seededRng(seed), buildConfig({ timing: { aimMs: 1000 } }));
      let now = 0;
      e.start(0);
      while (e.phase !== 'over') { now += 50; e.tick(now); }
      const s = e.snapshot(now);
      if (s.winnerId === 'easy') wins.easy++;
      if (s.winnerId === 'hard') wins.hard++;
    }
    expect(wins.hard).toBeGreaterThan(wins.easy);
  });
});
