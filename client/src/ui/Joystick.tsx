import { useEffect, useRef } from 'react';
import type { GameSession } from '../game/session';

const RADIUS = 62;

/** Virtual aiming stick. Writes straight to the session and moves the knob via transform (no React state). */
export function Joystick({ session }: { session: GameSession }) {
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const active = useRef<number | null>(null);

  const place = (angle: number, mag: number) => {
    if (knob.current) knob.current.style.transform = `translate(${Math.cos(angle) * mag * RADIUS}px, ${Math.sin(angle) * mag * RADIUS}px)`;
  };

  useEffect(() => {
    const sync = () => {
      if (active.current === null) place(session.aim, 0.62);
    };
    sync();
    return session.on((e) => {
      if (e.type === 'phase' || e.type === 'snapshot') sync();
    });
  }, [session]);

  const update = (e: React.PointerEvent) => {
    const r = base.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len < 10) return;
    const a = Math.atan2(dy, dx);
    place(a, Math.min(1, len / RADIUS));
    if (session.view?.snap.phase === 'aiming') session.setAim(a);
  };

  return (
    <div
      ref={base}
      className="joystick"
      onPointerDown={(e) => {
        e.preventDefault();
        active.current = e.pointerId;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        update(e);
      }}
      onPointerMove={(e) => active.current === e.pointerId && update(e)}
      onPointerUp={(e) => {
        if (active.current === e.pointerId) active.current = null;
      }}
      onPointerCancel={() => (active.current = null)}
      onLostPointerCapture={() => (active.current = null)}
      aria-label="Aim stick"
    >
      <div className="ring r1" />
      <div ref={knob} className="knob" />
    </div>
  );
}
