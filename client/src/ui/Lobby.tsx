import { useState } from 'react';
import type { OnlineSession } from '../net/onlineSession';
import { Button, ColorDot, slotColor, useSession } from './common';

export function Lobby({ session, onLeave }: { session: OnlineSession; onLeave: () => void }) {
  useSession(session);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState('');
  const lobby = session.lobby!;
  const me = lobby.players.find((p) => p.id === session.youId);
  const isHost = !!me?.isHost;
  const link = `${location.origin}/?room=${lobby.code}`;
  const others = lobby.players.filter((p) => !p.isHost);
  const connected = lobby.players.filter((p) => p.connected);
  const canStart = isHost && connected.length >= lobby.minPlayers && others.filter((p) => p.connected).every((p) => p.ready);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: 'Blind Shot', text: `Join my Blind Shot room ${lobby.code}`, url: link }); return; } catch { /* cancelled */ }
    }
    void copy(link);
  };

  const start = async () => {
    setErr('');
    const res = await session.start();
    if (!res.ok) setErr(res.error ?? 'Could not start.');
  };

  const hint = isHost
    ? connected.length < lobby.minPlayers
      ? 'Waiting for at least one more player…'
      : canStart
        ? 'Everyone is ready — start when you like.'
        : 'Waiting for everyone to get ready…'
    : me?.ready
      ? 'You are ready. Waiting for the host to start.'
      : 'Press Ready when you are set.';

  return (
    <div className="lobby screen">
      <div className="lobby-inner">
        <p className="eyebrow">Private room</p>
        <button className="room-code" onClick={() => copy(lobby.code)} aria-label="Copy room code">
          {lobby.code.split('').map((c, i) => <span key={i}>{c}</span>)}
        </button>
        <div className="share-row">
          <Button onClick={() => copy(link)}>{copied ? 'Link copied ✓' : 'Copy invite link'}</Button>
          <Button onClick={share}>Share</Button>
        </div>

        <ul className="slots">
          {Array.from({ length: lobby.maxPlayers }, (_, i) => {
            const p = lobby.players.find((x) => x.slot === i);
            if (!p) {
              return (
                <li key={i} className="slot empty">
                  <div className="radar" aria-hidden />
                  <div className="slot-text"><b>Open slot</b><small>Waiting for player…</small></div>
                </li>
              );
            }
            const c = slotColor(p.slot);
            return (
              <li key={i} className={`slot ${p.connected ? '' : 'offline'}`} style={{ ['--c' as string]: c.hex }}>
                <ColorDot slot={p.slot} size={18} />
                <div className="slot-text">
                  <b>{p.name}{p.id === session.youId && <em> (you)</em>}</b>
                  <small>{c.name}{p.isHost ? ' · Host' : ''}{!p.connected ? ' · reconnecting…' : ''}</small>
                </div>
                <span className={`pill ${p.isHost || p.ready ? 'ok' : ''}`}>{p.isHost ? 'HOST' : p.ready ? 'READY' : 'NOT READY'}</span>
              </li>
            );
          })}
        </ul>

        <p className="hint">{hint}</p>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="lobby-actions">
          {isHost ? (
            <Button variant="primary" disabled={!canStart} onClick={start}>Start game</Button>
          ) : (
            <Button variant="primary" onClick={() => session.setReady(!me?.ready)}>{me?.ready ? 'Unready' : 'Ready'}</Button>
          )}
          <Button variant="danger" onClick={onLeave}>Leave</Button>
        </div>
      </div>
    </div>
  );
}
