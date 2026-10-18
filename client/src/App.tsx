import { useCallback, useEffect, useRef, useState } from 'react';
import type { BotLevel } from '@shared/config';
import { normalizeRoomCode } from '@shared/protocol';
import { DEFAULT_CONFIG } from '@shared/config';
import { LocalSession } from './game/localSession';
import type { GameSession } from './game/session';
import { audio } from './game/audio';
import { getSettings } from './game/settings';
import { OnlineSession, loadStored } from './net/onlineSession';
import { Menu } from './ui/Menu';
import { Lobby } from './ui/Lobby';
import { GameScreen } from './ui/GameScreen';
import { HowTo } from './ui/HowTo';
import { SettingsScreen } from './ui/SettingsScreen';
import { useSession } from './ui/common';

function readInvite(): string | null {
  try {
    const q = new URLSearchParams(location.search).get('room');
    return normalizeRoomCode(q, DEFAULT_CONFIG);
  } catch {
    return null;
  }
}

export function App() {
  const [screen, setScreen] = useState<'menu' | 'howto' | 'settings'>('menu');
  const [session, setSession] = useState<GameSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resuming, setResuming] = useState(() => !!loadStored());
  const [invite] = useState(readInvite);
  const initialised = useRef(false);

  useSession(session);

  const clearInvite = () => {
    try {
      if (location.search) history.replaceState(null, '', location.pathname);
    } catch { /* ignore */ }
  };

  // resume an online session after reload / drop
  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    const stored = loadStored();
    if (!stored) return;
    const s = new OnlineSession();
    s.resume(stored).then((ok) => {
      if (ok) setSession(s);
      else s.destroy();
      setResuming(false);
    });
  }, []);

  const exit = useCallback(() => {
    setSession((cur) => {
      if (cur instanceof OnlineSession) cur.leave();
      cur?.destroy();
      return null;
    });
    setScreen('menu');
    setError('');
  }, []);

  const startLocal = (bots: number, level: BotLevel) => {
    audio.unlock();
    setSession(new LocalSession(getSettings().name.trim() || 'You', bots, level));
  };

  const again = () => {
    setSession((cur) => {
      if (cur instanceof LocalSession) {
        const next = new LocalSession(cur.playerName, cur.bots, cur.level);
        cur.destroy();
        return next;
      }
      return cur;
    });
  };

  const connectOnline = async (fn: (s: OnlineSession) => Promise<{ ok: boolean; error?: string }>) => {
    audio.unlock();
    setBusy(true);
    setError('');
    const s = new OnlineSession();
    const res = await fn(s);
    setBusy(false);
    if (res.ok) {
      clearInvite();
      setSession(s);
    } else {
      s.destroy();
      setError(res.error ?? 'Could not connect.');
    }
  };

  if (resuming) return <div className="screen splash"><div className="spinner" /><p>Reconnecting to your match…</p></div>;

  if (session instanceof OnlineSession) {
    if (!session.lobby) return <div className="screen splash"><div className="spinner" /><p>Joining room…</p></div>;
    if (session.lobby.status === 'lobby') return <Lobby session={session} onLeave={exit} />;
  }
  if (session) return <GameScreen session={session} onExit={exit} onAgain={again} />;

  if (screen === 'howto') return <HowTo onBack={() => setScreen('menu')} />;
  if (screen === 'settings') return <SettingsScreen onBack={() => setScreen('menu')} />;

  return (
    <Menu
      inviteCode={invite}
      busy={busy}
      error={error}
      onCreate={(name) => connectOnline((s) => s.create(name))}
      onJoin={(code, name) => connectOnline((s) => s.join(code, name))}
      onPractice={startLocal}
      onHowTo={() => setScreen('howto')}
      onSettings={() => setScreen('settings')}
    />
  );
}
