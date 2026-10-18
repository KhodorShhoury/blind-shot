import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@shared/config';
import { RateLimiter, isToken, normalizeRoomCode, parseAngle, randomRoomCode, sanitizeName } from '@shared/protocol';

describe('validation', () => {
  it('normalises room codes', () => {
    expect(normalizeRoomCode(' abcde ', DEFAULT_CONFIG)).toBe('ABCDE');
    expect(normalizeRoomCode('ABCD0', DEFAULT_CONFIG)).toBeNull(); // 0 is not in the alphabet
    expect(normalizeRoomCode(12345, DEFAULT_CONFIG)).toBeNull();
    expect(normalizeRoomCode('ABC', DEFAULT_CONFIG)).toBeNull();
    expect(randomRoomCode(5)).toMatch(/^[A-HJKMNP-Z2-9]{5}$/);
  });
  it('sanitises names', () => {
    expect(sanitizeName('  <b>Hello</b>   World  ', DEFAULT_CONFIG)).toBe('bHello/b World');
    expect(sanitizeName('x'.repeat(100), DEFAULT_CONFIG)).toHaveLength(DEFAULT_CONFIG.room.nameMax);
    expect(sanitizeName({}, DEFAULT_CONFIG)).toBe('Player');
  });
  it('validates angles and tokens', () => {
    expect(parseAngle(1.5)).toBe(1.5);
    expect(parseAngle(NaN)).toBeNull();
    expect(parseAngle('1')).toBeNull();
    expect(parseAngle(1e9)).toBeNull();
    expect(isToken('abc')).toBe(false);
    expect(isToken('abcdefghijklmnop')).toBe(true);
  });
  it('rate limiter refills', () => {
    const rl = new RateLimiter(3, 1, 0);
    expect([rl.take(1, 0), rl.take(1, 0), rl.take(1, 0), rl.take(1, 0)]).toEqual([true, true, true, false]);
    expect(rl.take(1, 1000)).toBe(true);
  });
});

import { parseMove } from '@shared/protocol';

describe('parseMove', () => {
  it('accepts vectors and normalises anything longer than 1', () => {
    expect(parseMove({ x: 0.5, y: -0.25 })).toEqual({ x: 0.5, y: -0.25 });
    const v = parseMove({ x: 3, y: 4 })!;
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 6);
  });
  it('rejects garbage', () => {
    for (const bad of [null, undefined, 1, 'x', {}, { x: 1 }, { x: 'a', y: 0 }, { x: NaN, y: 0 }, { x: Infinity, y: 0 }, { x: 1e9, y: 0 }]) expect(parseMove(bad)).toBeNull();
  });
});
