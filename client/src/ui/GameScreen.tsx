import { useEffect, useRef, useState } from 'react';
import { Renderer } from '../game/renderer';
import { InputManager } from '../game/input';
import { audio } from '../game/audio';
import type { GameSession } from '../game/session';
import { OnlineSession } from '../net/onlineSession';
import { ColorDot, useSession, useSettings } from './common';
import { Joystick } from './Joystick';
import { Victory } from './Victory';

interface Props {
  session: GameSession;
  onExit: () => void;
  onAgain: () => void;
}

export function GameScreen({ session, onExit, onAgain }: Props) {
  useSession(session);
  const settings = useSettings();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [touchSeen, setTouchSeen] = useState(false);

  // renderer + input lifecycle
  useEffect(() => {
    const canvas = canvasRef.current!;
    const renderer = new Renderer(canvas, wrapRef.current!, session, {
      onFire: () => audio.fire(),
      onKill: () => audio.eliminate(),
    });
    const input = new InputManager(canvas, renderer, session);
    renderer.start();
    return () => {
      input.destroy();
      renderer.destroy();
    };
  }, [session]);

  // phase sounds + countdown ticks
  useEffect(() => {
    let lastSec = -1;
    const off = session.on((e) => {
      if (e.type !== 'phase') return;
      if (e.phase === 'aiming') audio.roundStart();
      if (e.phase === 'lock') audio.lockPhase();
    });
    const timer = setInterval(() => {
      const v = session.view;
      if (!v || v.snap.phase !== 'aiming') { lastSec = -1; return; }
      const sec = Math.ceil((v.endsAt - performance.now()) / 1000);
      if (sec !== lastSec) {
        lastSec = sec;
        if (sec >= 1 && sec <= 5) audio.tick(sec <= 3);
      }
    }, 80);
    return () => { off(); clearInterval(timer); };
  }, [session]);

  useEffect(() => {
    const t = () => setTouchSeen(true);
    window.addEventListener('touchstart', t, { once: true, passive: true });
    return () => window.removeEventListener('touchstart', t);
  }, []);

  const snap = session.view?.snap;
  const me = session.me;
  const phase = snap?.phase;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const showTouch = settings.touchControls === 'on' || (settings.touchControls === 'auto' && (coarse || touchSeen));
  const canAim = !!me?.alive && phase === 'aiming';
  const offline = session instanceof OnlineSession && session.conn !== 'connected';

  let status = 'Waiting for the match…';
  let tone = '';
  if (snap) {
    if (phase === 'aiming') {
      if (!me?.alive) { status = 'You are eliminated — spectating'; tone = 'dead'; }
      else if (session.locked) { status = 'LOCKED — unlock to re-aim'; tone = 'locked'; }
      else { status = showTouch ? 'Aim with the stick, then LOCK' : 'Move the mouse to aim · Click or Space to lock'; tone = 'aim'; }
    } else if (phase === 'lock') { status = 'Locking in…'; tone = 'locked'; }
    else if (phase === 'fire') { status = 'FIRE!'; tone = 'fire'; }
    else if (phase === 'result') { status = 'Results'; }
    else status = 'Match over';
  }

  return (
    <div className="game screen" data-touch={showTouch ? '1' : '0'}>
      <header className="hud">
        <button className="icon-btn" aria-label="Leave match" onClick={onExit}>✕</button>
        <div className="round-chip">ROUND <b>{snap?.round ?? 1}</b></div>
        <ul className="roster">
          {snap?.players.map((p) => (
            <li key={p.id} className={`${p.alive ? '' : 'out'} ${p.connected ? '' : 'off'} ${p.id === session.youId ? 'me' : ''}`}>
              <ColorDot slot={p.slot} size={12} />
              <span className="rn">{p.name}</span>
              <span className="rs">{!p.alive ? '✕' : !p.connected ? '⚠' : phase === 'aiming' && p.locked ? '🔒' : ''}</span>
            </li>
          ))}
        </ul>
      </header>

      <div className="arena-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} className="arena" />
      </div>

      <div className={`status ${tone}`}>{status}</div>

      <div className="controls">
        {showTouch && canAim ? <Joystick session={session} /> : <span />}
        {canAim && (
          <button
            className={`lock-btn ${session.locked ? 'on' : ''}`}
            onPointerDown={(e) => {
              e.preventDefault();
              audio.unlock();
              session.toggleLock();
              audio.lock(session.locked);
            }}
          >
            {session.locked ? 'LOCKED ✓' : 'LOCK'}
            <small>{showTouch ? '' : 'Space'}</small>
          </button>
        )}
      </div>

      {offline && <div className="conn-banner">Connection lost — reconnecting…</div>}
      {phase === 'over' && snap && <Victory session={session} onExit={onExit} onAgain={onAgain} />}
    </div>
  );
}
