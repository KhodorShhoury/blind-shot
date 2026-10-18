import { useEffect, useSyncExternalStore, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { DEFAULT_CONFIG } from '@shared/config';
import { audio } from '../game/audio';
import { getSettings, subscribeSettings } from '../game/settings';
import type { GameSession } from '../game/session';

export function useSession(session: GameSession | null): number {
  return useSyncExternalStore(
    (cb) => (session ? session.on(() => cb()) : () => {}),
    () => session?.version ?? 0,
  );
}

export function useSettings() {
  return useSyncExternalStore(subscribeSettings, getSettings);
}

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger';
  children: ReactNode;
}

export function Button({ variant = 'ghost', className = '', onClick, children, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      className={`btn btn-${variant} ${className}`}
      onPointerEnter={() => audio.hover()}
      onClick={(e) => {
        audio.unlock();
        audio.click();
        onClick?.(e);
      }}
    >
      <span>{children}</span>
    </button>
  );
}

export const slotColor = (slot: number) => DEFAULT_CONFIG.colors[slot % 4];

export function ColorDot({ slot, size = 14 }: { slot: number; size?: number }) {
  const c = slotColor(slot);
  return <i className="dot" style={{ width: size, height: size, background: c.hex, boxShadow: `0 0 12px ${c.hex}` }} />;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
