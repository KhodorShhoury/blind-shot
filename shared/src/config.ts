export type BotLevel = 'easy' | 'normal' | 'hard';

export interface GameConfig {
  arena: {
    w: number;
    h: number;
    spawnRadius: number;
    playerRadius: number;
    /** Radius of the central pillar in round 1; shrinks every round. */
    pillarBase: number;
    /** Round at which the pillar has fully collapsed (guarantees the match makes progress). */
    pillarCollapseRound: number;
  };
  beam: {
    halfWidth: number;
    maxBounces: number;
    maxLength: number;
    /** Visual travel speed in arena px/s (used by the renderer only). */
    speed: number;
  };
  timing: {
    aimMs: number;
    lockMs: number;
    fireMs: number;
    resultMs: number;
    /** When everyone is locked the aiming phase ends after this grace period. */
    allLockedGraceMs: number;
    warnMs: number;
  };
  room: {
    minPlayers: number;
    maxPlayers: number;
    codeLength: number;
    nameMax: number;
    /** How long a disconnected player stays in an active match before forfeiting. */
    disconnectGraceMs: number;
    /** How long a disconnected player stays in a lobby slot. */
    lobbyGraceMs: number;
    emptyRoomTtlMs: number;
    maxRooms: number;
  };
  colors: { name: string; hex: string; glow: string }[];
  bots: Record<BotLevel, { noiseDeg: number; wildChance: number; lockMin: number; lockMax: number; rethink: number }>;
}

export const DEFAULT_CONFIG: GameConfig = {
  arena: { w: 1000, h: 1000, spawnRadius: 360, playerRadius: 24, pillarBase: 70, pillarCollapseRound: 6 },
  beam: { halfWidth: 4, maxBounces: 2, maxLength: 3600, speed: 7000 },
  timing: { aimMs: 8000, lockMs: 600, fireMs: 1500, resultMs: 2300, allLockedGraceMs: 900, warnMs: 3000 },
  room: {
    minPlayers: 2,
    maxPlayers: 4,
    codeLength: 5,
    nameMax: 14,
    disconnectGraceMs: 30000,
    lobbyGraceMs: 15000,
    emptyRoomTtlMs: 60000,
    maxRooms: 1000,
  },
  colors: [
    { name: 'Blue', hex: '#2f8cff', glow: '#6fb2ff' },
    { name: 'Pink', hex: '#ff3d9a', glow: '#ff86c2' },
    { name: 'Yellow', hex: '#ffd92e', glow: '#ffe97a' },
    { name: 'Green', hex: '#39ff88', glow: '#8bffb9' },
  ],
  bots: {
    easy: { noiseDeg: 9, wildChance: 0.25, lockMin: 0.7, lockMax: 0.95, rethink: 0.3 },
    normal: { noiseDeg: 3.2, wildChance: 0.08, lockMin: 0.45, lockMax: 0.85, rethink: 0.25 },
    hard: { noiseDeg: 0.9, wildChance: 0.02, lockMin: 0.3, lockMax: 0.8, rethink: 0.12 },
  },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function buildConfig(overrides: DeepPartial<GameConfig> = {}): GameConfig {
  const merge = (base: any, over: any): any => {
    if (over === undefined) return base;
    if (Array.isArray(base) || typeof base !== 'object' || base === null) return over;
    const out: any = { ...base };
    for (const k of Object.keys(over)) out[k] = merge(base[k], over[k]);
    return out;
  };
  return merge(DEFAULT_CONFIG, overrides) as GameConfig;
}

export type Rng = () => number;

/** Small deterministic PRNG (mulberry32) for tests and reproducible bots. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
