import { useEffect, useRef } from 'react';
import type { GameSession } from '../game/session';

type Mode = 'aim' | 'move';

/**
 * Virtual stick. `aim` sets the private firing direction; `move` walks the player. Writes straight to
 * the session and moves the knob via transform (no React state).
 */
export function Joystick({ session, mode = 'aim' }: { session: GameSession; mode?: Mode }) {
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const active = useRef<number | null>(null);
  const vec = useRef({ x: 0, y: 0 });

  const radius = () => (base.current ? base.current.clientWidth * 0.36 : 50);
  const place = (x: number, y: number) => {
    if (knob.current) knob.current.style.transform = `translate(${x * radius()}px, ${y * radius()}px)`;
  };

  useEffect(() => {
    const sync = () => {
      if (mode === 'aim' && active.current === null) place(Math.cos(session.aim) * 0.62, Math.sin(session.aim) * 0.62);
    };
    sync();
    const off = session.on((e) => {
      if (e.type === 'phase' || e.type === 'snapshot') sync();
    });
    // movement intents expire on the server unless refreshed
    const refresh =
      mode === 'move'
        ? setInterval(() => {
            if (vec.current.x !== 0 || vec.current.y !== 0) session.setMove(vec.current.x, vec.current.y);
          }, 100)
        : null;
    return () => {
      off();
      if (refresh) clearInterval(refresh);
      if (mode === 'move') session.setMove(0, 0);
    };
  }, [session, mode]);

  const stop = () => {
    active.current = null;
    if (mode === 'move') {
      vec.current = { x: 0, y: 0 };
      session.setMove(0, 0);
      place(0, 0);
    }
  };

  const update = (e: React.PointerEvent) => {
    const r = base.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    if (mode === 'move') {
      const m = Math.min(1, len / radius());
      const v = len < 8 ? { x: 0, y: 0 } : { x: (dx / len) * m, y: (dy / len) * m };
      vec.current = v;
      place(v.x, v.y);
      session.setMove(v.x, v.y);
      return;
    }
    if (len < 10) return;
    const a = Math.atan2(dy, dx);
    const mag = Math.min(1, len / radius());
    place(Math.cos(a) * mag, Math.sin(a) * mag);
    if (session.view?.snap.phase === 'aiming') session.setAim(a);
  };

  return (
    <div
      ref={base}
      className={`joystick ${mode}`}
      onPointerDown={(e) => {
        e.preventDefault();
        active.current = e.pointerId;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        update(e);
      }}
      onPointerMove={(e) => active.current === e.pointerId && update(e)}
      onPointerUp={(e) => {
        if (active.current === e.pointerId) stop();
      }}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      aria-label={mode === 'move' ? 'Move stick' : 'Aim stick'}
    >
      <div className="ring r1" />
      <div ref={knob} className="knob" />
      <span className="stick-label">{mode === 'move' ? 'MOVE' : 'AIM'}</span>
    </div>
  );
}
