export type ParticleLevel = 'low' | 'medium' | 'high';
export type TouchMode = 'auto' | 'on' | 'off';

export interface Settings {
  volume: number;
  sfx: boolean;
  reducedMotion: boolean;
  particles: ParticleLevel;
  touchControls: TouchMode;
  name: string;
}

const KEY = 'blindshot.settings.v1';

function defaults(): Settings {
  let rm = false;
  try {
    rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    /* ignore */
  }
  return { volume: 0.7, sfx: true, reducedMotion: rm, particles: 'medium', touchControls: 'auto', name: '' };
}

function load(): Settings {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const p = JSON.parse(raw) as Partial<Settings>;
    return {
      volume: typeof p.volume === 'number' ? Math.min(1, Math.max(0, p.volume)) : d.volume,
      sfx: typeof p.sfx === 'boolean' ? p.sfx : d.sfx,
      reducedMotion: typeof p.reducedMotion === 'boolean' ? p.reducedMotion : d.reducedMotion,
      particles: p.particles === 'low' || p.particles === 'high' ? p.particles : 'medium',
      touchControls: p.touchControls === 'on' || p.touchControls === 'off' ? p.touchControls : 'auto',
      name: typeof p.name === 'string' ? p.name.slice(0, 14) : '',
    };
  } catch {
    return d;
  }
}

let current = load();
const listeners = new Set<() => void>();

export const getSettings = (): Settings => current;

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage may be unavailable (private mode) */
  }
  document.documentElement.dataset.reduced = current.reducedMotion ? '1' : '0';
  listeners.forEach((l) => l());
}

export function subscribeSettings(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const particleFactor = (s: Settings): number => (s.particles === 'low' ? 0.4 : s.particles === 'high' ? 1.6 : 1);

document.documentElement.dataset.reduced = current.reducedMotion ? '1' : '0';
