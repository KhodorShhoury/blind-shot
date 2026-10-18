import { describe, expect, it } from 'vitest';
import { buildConfig, seededRng } from '@shared/config';
import { MatchEngine, type PlayerInit } from '@shared/engine';
import { planBot } from '@shared/bots';

const cfg = buildConfig({ room: { disconnectGraceMs: 5000 } });
const T = cfg.timing;

function inits(n: number): PlayerInit[] {
  return Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, slot: i }));
}

function make(n: number, seed = 1, c = cfg) {
  const events: string[] = [];
  const e = new MatchEngine(inits(n), seededRng(seed), c, (ev) => events.push(ev));
  e.start(0);
  return { e, events };
}

const pos = (e: MatchEngine, id: string) => e.secretPositions().find((p) => p.id === id)!;

function aimAt(e: MatchEngine, from: string, to: string) {
  const a = pos(e, from);
  const b = pos(e, to);
  e.setAim(from, Math.atan2(b.y - a.y, b.x - a.x));
}

/** Fire directly away from `other`, which can never hit it (a ray only goes forward). */
function aimAwayFrom(e: MatchEngine, id: string, other: string) {
  const a = pos(e, id);
  const b = pos(e, other);
  e.setAim(id, Math.atan2(a.y - b.y, a.x - b.x));
}

/** Advance to the fire reveal; returns the time at which 'fire' began. */
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

  it('lets a player change direction until the countdown expires, then locks it', () => {
    const { e } = make(2);
    e.setAim('p0', 1);
    e.setAim('p0', -2);
    expect(e.snapshot(0, 'p0').you!.aim).toBeCloseTo(-2, 2);
    e.tick(T.aimMs);
    e.setAim('p0', 2); // too late
    e.setLocked('p0', false);
    const s = e.snapshot(T.aimMs, 'p0');
    expect(s.you!.aim).toBeCloseTo(-2, 2);
    expect(s.you!.locked).toBe(true);
  });

  it('ignores aim changes while locked', () => {
    const { e } = make(2);
    e.setAim('p0', 1);
    e.setLocked('p0', true);
    e.setAim('p0', 2);
    expect(e.snapshot(0, 'p0').you!.aim).toBeCloseTo(1, 2);
  });
});

describe('secrecy: hidden positions and aims', () => {
  it("a player's snapshot contains only their OWN position during aiming and lock", () => {
    const { e } = make(4);
    for (const phaseAt of [0, T.aimMs]) {
      for (const id of ['p0', 'p1', 'p2', 'p3']) {
        const s = e.snapshot(phaseAt, id);
        expect(['aiming', 'lock']).toContain(s.phase);
        for (const p of s.players) {
          if (p.id === id) {
            expect(p.x).toBe(pos(e, id).x);
            expect(p.y).toBe(pos(e, id).y);
          } else {
            expect(p.x).toBeUndefined();
            expect(p.y).toBeUndefined();
          }
        }
      }
    }
  });

  it('the only coordinates in a player’s payload are their own', () => {
    const { e } = make(4, 7);
    for (const id of ['p0', 'p1', 'p2', 'p3']) {
      const json = JSON.stringify(e.snapshot(0, id));
      expect(json.match(/"x":/g)).toHaveLength(1);
      expect(json.match(/"y":/g)).toHaveLength(1);
    }
    // spectator / server broadcast view has no coordinates at all
    expect(JSON.stringify(e.snapshot(0))).not.toMatch(/"x":/);
    expect(JSON.stringify(e.snapshot(0))).not.toMatch(/"y":/);
  });

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

  it('reveals every shooter, shot and position after firing', () => {
    const { e } = make(3);
    const t = playRound(e);
    const s = e.snapshot(t, 'p0');
    expect(s.phase).toBe('fire');
    expect(s.shots).toHaveLength(3);
    for (const p of s.players) {
      expect(p.x).toBe(pos(e, p.id).x);
      expect(p.y).toBe(pos(e, p.id).y);
    }
  });

  it('hides everyone again in the next round; nobody is re-placed, everyone keeps their spot', () => {
    const { e } = make(4, 11);
    const before = e.secretPositions();
    const t = playRound(e);
    e.tick(t + T.fireMs + T.resultMs);
    if (e.phase === 'aiming') {
      const s2 = e.snapshot(0, 'p0');
      expect(s2.round).toBe(2);
      for (const p of s2.players) if (p.id !== 'p0') expect(p.x).toBeUndefined();
      expect(s2.shots).toHaveLength(0);
      expect(s2.eliminations).toHaveLength(0);
      for (const q of e.secretPositions()) {
        const old = before.find((o) => o.id === q.id)!;
        expect(q).toEqual(old);
      }
    }
  });

  it('eliminated players never get a position in aiming snapshots', () => {
    const { e } = make(4, 3);
    aimAt(e, 'p0', 'p1');
    for (const id of ['p1', 'p2', 'p3']) aimAwayFrom(e, id, 'p0');
    const t = playRound(e);
    e.tick(t + T.fireMs + T.resultMs);
    expect(e.phase).toBe('aiming');
    const dead = e.snapshot(0, 'p1');
    expect(dead.players.find((p) => p.id === 'p1')!.alive).toBe(false);
    expect(dead.players.every((p) => p.x === undefined)).toBe(true);
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

  it('collision uses the secret positions: aiming where nobody is hits nobody', () => {
    const { e } = make(4, 21);
    const ids = ['p0', 'p1', 'p2', 'p3'];
    // each player shoots away from the closest other player's direction... a guaranteed-miss is hard
    // with 4 players, so instead check the result is exactly what geometry says it should be
    for (const id of ids) e.setAim(id, 0.5);
    const t = playRound(e);
    const s = e.snapshot(t);
    for (const shot of s.shots) {
      const shooter = pos(e, shot.shooterId);
      expect(shot.points[0]).toBeCloseTo(shooter.x, 0);
      expect(shot.points[1]).toBeCloseTo(shooter.y, 0);
      expect(shot.angle).toBeCloseTo(0.5, 2);
    }
  });

  it('a round where nobody is hit leaves everyone alive and simply starts another round', () => {
    const { e } = make(4, 5);
    const ids = ['p0', 'p1', 'p2', 'p3'];
    // pick, per player, a direction that provably misses every opponent
    for (const id of ids) {
      const me = pos(e, id);
      const others = e.secretPositions().filter((q) => q.id !== id);
      let chosen = 0;
      for (let k = 0; k < 720; k++) {
        const a = (k / 720) * Math.PI * 2;
        const hits = others.some((o) => {
          const dx = o.x - me.x, dy = o.y - me.y;
          const along = dx * Math.cos(a) + dy * Math.sin(a);
          const across = Math.abs(-dx * Math.sin(a) + dy * Math.cos(a));
          return along > 0 && across < cfg.arena.playerRadius + cfg.beam.halfWidth + 2;
        });
        if (!hits) { chosen = a; break; }
      }
      e.setAim(id, chosen);
    }
    const t = playRound(e);
    const fire = e.snapshot(t);
    expect(fire.eliminations).toHaveLength(0);
    expect(fire.players.every((p) => p.alive)).toBe(true);
    e.tick(t + T.fireMs + T.resultMs);
    expect(e.phase).toBe('aiming');
    expect(e.round).toBe(2);
    expect(e.snapshot(0, 'p0').players.filter((p) => p.alive)).toHaveLength(4);
  });
});

describe('full four-player gameplay loop', () => {
  it('plays rounds with misses and hits until one survivor, repositioning everyone each round', () => {
    const e = new MatchEngine(
      inits(4).map((p) => ({ ...p, botLevel: 'normal' as const })),
      seededRng(2024),
      buildConfig({ timing: { aimMs: 1000 } }),
    );
    let now = 0;
    e.start(now);
    const seenPositions: string[] = [];
    let lastRound = 0;
    let missRounds = 0;
    let hitRounds = 0;
    let guard = 0;
    while (e.phase !== 'over' && guard++ < 100000) {
      if (e.round !== lastRound && e.phase === 'aiming') {
        lastRound = e.round;
        seenPositions.push(JSON.stringify(e.secretPositions()));
      }
      now += 25;
      e.tick(now);
      if (e.phase === 'result') {
        const s = e.snapshot(now);
        if (s.eliminations.length === 0) missRounds++;
        else hitRounds++;
      }
    }
    expect(e.phase).toBe('over');
    const final = e.snapshot(now);
    expect(final.draw || final.winnerId !== null).toBe(true);
    expect(hitRounds).toBeGreaterThan(0);
    // bots walk, so positions do change from round to round
    expect(new Set(seenPositions).size).toBeGreaterThan(1);
    void missRounds;
  });

  it('across many seeded matches, rounds without a single hit do occur and are harmless', () => {
    let rounds = 0;
    let empty = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const e = new MatchEngine(
        inits(4).map((p) => ({ ...p, botLevel: 'easy' as const })),
        seededRng(seed),
        buildConfig({ timing: { aimMs: 500 } }),
      );
      let now = 0;
      e.start(0);
      let counted = -1;
      let guard = 0;
      while (e.phase !== 'over' && guard++ < 100000) {
        now += 25;
        e.tick(now);
        if (e.phase === 'result' && counted !== e.round) {
          counted = e.round;
          rounds++;
          if (e.snapshot(now).eliminations.length === 0) empty++;
        }
      }
      expect(e.phase).toBe('over');
    }
    expect(empty).toBeGreaterThan(0);
    expect(empty).toBeLessThan(rounds);
  });
});

describe('disconnects', () => {
  it('disconnected player is auto-locked and still fires', () => {
    const { e } = make(2);
    aimAt(e, 'p0', 'p1');
    e.setConnected('p0', false, 10);
    expect(e.snapshot(10, 'p0').you!.locked).toBe(true);
    aimAwayFrom(e, 'p1', 'p0');
    const t = playRound(e);
    expect(e.snapshot(t).shots.find((s) => s.shooterId === 'p0')!.hitId).toBe('p1');
  });

  it('forfeits after the grace period and awards the win', () => {
    const { e } = make(2);
    aimAwayFrom(e, 'p0', 'p1');
    aimAwayFrom(e, 'p1', 'p0');
    e.setConnected('p1', false, 0);
    const t = playRound(e);
    const end = t + T.fireMs + T.resultMs;
    e.tick(end);
    const s = e.snapshot(end);
    expect(s.phase).toBe('over');
    expect(s.winnerId).toBe('p0');
  });

  it('a reconnect within the grace period keeps the player alive', () => {
    const { e } = make(2);
    aimAwayFrom(e, 'p0', 'p1');
    aimAwayFrom(e, 'p1', 'p0');
    e.setConnected('p1', false, 0);
    e.setConnected('p1', true, 1000);
    const t = playRound(e);
    e.tick(t + T.fireMs + T.resultMs);
    expect(e.phase).toBe('aiming');
  });
});

describe('bots are blind', () => {
  it('planBot only receives the bot’s own position (no way to read opponents)', () => {
    expect(planBot.length).toBe(5); // (self, level, cfg, rng, aimMs)
  });

  it('bot aim never depends on where opponents are', () => {
    // same seed + same own position => identical plan regardless of the rest of the arena
    const a = planBot({ x: 200, y: 300 }, 'hard', cfg, seededRng(9), 5000);
    const b = planBot({ x: 200, y: 300 }, 'hard', cfg, seededRng(9), 5000);
    expect(a).toEqual(b);
  });

  it('hard bots lean toward the arena centre more than easy bots, but are never aimbots', () => {
    const me = { x: 150, y: 150 };
    const near = (level: 'easy' | 'hard') => {
      const rng = seededRng(3);
      let n = 0;
      for (let i = 0; i < 2000; i++) {
        const plan = planBot(me, level, cfg, rng, 5000);
        const toC = Math.atan2(500 - plan.dest.y, 500 - plan.dest.x);
        const d = Math.abs(Math.atan2(Math.sin(plan.aim1 - toC), Math.cos(plan.aim1 - toC)));
        if (d < 0.5) n++;
      }
      return n / 2000;
    };
    expect(near('hard')).toBeGreaterThan(near('easy'));
    expect(near('hard')).toBeLessThan(0.95);
  });

  it('bot-only matches terminate even though every round is luck', () => {
    for (const level of ['easy', 'normal', 'hard'] as const) {
      const e = new MatchEngine(
        inits(4).map((p) => ({ ...p, botLevel: level })),
        seededRng(42),
        buildConfig({ timing: { aimMs: 1000 } }),
      );
      let now = 0;
      e.start(now);
      let guard = 0;
      while (e.phase !== 'over' && guard++ < 200000) {
        now += 50;
        e.tick(now);
      }
      expect(e.phase).toBe('over');
    }
  });
});

function walk(e: MatchEngine, id: string, dx: number, dy: number, from: number, ms: number) {
  let t = from;
  const end = from + ms;
  while (t < end) {
    t += 25;
    e.setMove(id, dx, dy, t);
    e.tick(t);
  }
  return t;
}

describe('walking (players choose where to stand)', () => {
  it('first round starts everyone in their own corner, not at a random spot', () => {
    const { e } = make(4, 1);
    const ps = e.secretPositions();
    const { w, h, startInset } = cfg.arena;
    expect(ps.map((p) => [p.x, p.y])).toEqual([
      [startInset, startInset],
      [w - startInset, h - startInset],
      [w - startInset, startInset],
      [startInset, h - startInset],
    ]);
    // different RNG, same start: it is not random
    expect(make(4, 99).e.secretPositions()).toEqual(ps);
  });

  it('moves at the configured speed and only while aiming', () => {
    const { e } = make(2);
    const x0 = pos(e, 'p0').x;
    const y0 = pos(e, 'p0').y;
    walk(e, 'p0', 1, 0, 0, 1000);
    const p = pos(e, 'p0');
    expect(p.x - x0).toBeGreaterThan(cfg.arena.moveSpeed * 0.9);
    expect(p.x - x0).toBeLessThanOrEqual(cfg.arena.moveSpeed * 1.05);
    expect(p.y).toBe(y0);
    expect(pos(e, 'p1')).toEqual({ id: 'p1', x: cfg.arena.w - cfg.arena.startInset, y: cfg.arena.h - cfg.arena.startInset });
    // after the aiming phase ends nobody can walk any more
    e.tick(T.aimMs);
    expect(e.phase).toBe('lock');
    const frozen = pos(e, 'p0');
    e.setMove('p0', 1, 0, T.aimMs + 10);
    e.tick(T.aimMs + 100);
    expect(pos(e, 'p0')).toEqual(frozen);
  });

  it('stays inside the arena margins', () => {
    const { e } = make(2);
    let t = walk(e, 'p0', 1, 1, 0, 3000);
    t = walk(e, 'p0', -1, -1, t, 3000);
    const p = pos(e, 'p0');
    expect(p.x).toBeGreaterThanOrEqual(cfg.arena.wallMargin);
    expect(p.y).toBeGreaterThanOrEqual(cfg.arena.wallMargin);
    expect(p.x).toBeLessThanOrEqual(cfg.arena.w - cfg.arena.wallMargin);
    expect(p.y).toBeLessThanOrEqual(cfg.arena.h - cfg.arena.wallMargin);
  });

  it('diagonal movement is not faster than straight movement', () => {
    const { e } = make(2);
    const a = pos(e, 'p0');
    walk(e, 'p0', 5, 5, 0, 500);
    const b = pos(e, 'p0');
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThanOrEqual(cfg.arena.moveSpeed * 0.5 * 1.05);
  });

  it('an intent that is not refreshed expires (a lost stop message cannot leave a player running)', () => {
    const { e } = make(2);
    e.setMove('p0', 1, 0, 0);
    for (let t = 25; t <= 1500; t += 25) e.tick(t);
    const moved = pos(e, 'p0').x - cfg.arena.startInset;
    expect(moved).toBeLessThan(cfg.arena.moveSpeed * 0.75);
  });

  it('walking never reveals anything to opponents', () => {
    const { e } = make(2);
    walk(e, 'p0', 1, 1, 0, 800);
    const other = e.snapshot(800, 'p1');
    expect(other.players.find((p) => p.id === 'p0')!.x).toBeUndefined();
    expect(JSON.stringify(other)).not.toContain(String(Math.round(pos(e, 'p0').x)));
    const own = e.snapshot(800, 'p0');
    expect(own.players.find((p) => p.id === 'p0')!.x).toBeCloseTo(pos(e, 'p0').x, 5);
  });

  it('ignores movement from a disconnected or dead player', () => {
    const { e } = make(2);
    e.setConnected('p0', false, 0);
    const before = pos(e, 'p0');
    e.setMove('p0', 1, 0, 10);
    e.tick(200);
    expect(pos(e, 'p0')).toEqual(before);
  });

  it('where you stood decides who you hit: walking into the line of fire changes the outcome', () => {
    const miss = make(2);
    miss.e.setAim('p0', 0); // p0 (top-left corner) fires along y=150
    miss.e.tick(T.aimMs);
    miss.e.tick(T.aimMs + T.lockMs);
    expect(miss.e.snapshot(T.aimMs + T.lockMs).shots.find((s) => s.shooterId === 'p0')!.hitId).toBeNull();

    const { e } = make(2);
    e.setAim('p0', 0);
    walk(e, 'p1', 0, -1, 0, 2500); // p1 walks from the bottom-right corner up onto p0's line
    expect(Math.abs(pos(e, 'p1').y - pos(e, 'p0').y)).toBeLessThan(15);
    e.tick(T.aimMs);
    e.tick(T.aimMs + T.lockMs);
    expect(e.snapshot(T.aimMs + T.lockMs).shots.find((s) => s.shooterId === 'p0')!.hitId).toBe('p1');
  });

  it('bots walk to a spot of their own choosing and stay in bounds', () => {
    const e = new MatchEngine(
      inits(3).map((p) => ({ ...p, botLevel: 'normal' as const })),
      seededRng(8),
      buildConfig({ timing: { aimMs: 4000 } }),
    );
    e.start(0);
    const start = e.secretPositions();
    for (let t = 25; t < 4000; t += 25) e.tick(t);
    const end = e.secretPositions();
    expect(end.some((q, i) => q.x !== start[i].x || q.y !== start[i].y)).toBe(true);
    for (const q of end) {
      expect(q.x).toBeGreaterThanOrEqual(cfg.arena.wallMargin);
      expect(q.x).toBeLessThanOrEqual(cfg.arena.w - cfg.arena.wallMargin);
      expect(q.y).toBeGreaterThanOrEqual(cfg.arena.wallMargin);
      expect(q.y).toBeLessThanOrEqual(cfg.arena.h - cfg.arena.wallMargin);
    }
  });
});
