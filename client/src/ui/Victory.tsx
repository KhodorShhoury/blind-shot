import { useEffect, useMemo } from 'react';
import { audio } from '../game/audio';
import type { GameSession } from '../game/session';
import { OnlineSession } from '../net/onlineSession';
import { Button, ColorDot, slotColor, useSession } from './common';

export function Victory({ session, onExit, onAgain }: { session: GameSession; onExit: () => void; onAgain: () => void }) {
  useSession(session);
  const snap = session.view!.snap;
  const byId = new Map(snap.players.map((p) => [p.id, p]));
  const winner = snap.winnerId ? byId.get(snap.winnerId) : undefined;
  const won = winner?.id === session.youId;
  const color = winner ? slotColor(winner.slot).hex : '#9d6bff';

  useEffect(() => {
    if (won) audio.win();
    else audio.lose();
  }, [won]);

  const confetti = useMemo(
    () => Array.from({ length: won ? 36 : 0 }, (_, i) => ({ left: (i * 37) % 100, delay: (i % 9) * 0.12, dur: 1.8 + (i % 5) * 0.3, rot: (i * 53) % 360 })),
    [won],
  );

  const online = session instanceof OnlineSession ? session : null;
  const lobbyPlayers = online?.lobby?.players ?? [];
  const myVote = lobbyPlayers.find((p) => p.id === session.youId)?.rematch ?? false;
  const votes = lobbyPlayers.filter((p) => p.rematch).length;
  const connected = lobbyPlayers.filter((p) => p.connected).length;

  return (
    <div className="victory">
      {confetti.map((c, i) => (
        <i key={i} className="confetti" style={{ left: `${c.left}%`, animationDelay: `${c.delay}s`, animationDuration: `${c.dur}s`, background: i % 2 ? color : '#fff', transform: `rotate(${c.rot}deg)` }} />
      ))}
      <div className="victory-card" style={{ ['--c' as string]: color }}>
        <p className="eyebrow">{snap.draw ? 'Mutual destruction' : won ? 'Victory' : 'Match over'}</p>
        <h2 className="winner">{snap.draw ? 'DRAW' : winner ? (won ? 'YOU WIN!' : `${winner.name.toUpperCase()} WINS`) : 'NO WINNER'}</h2>
        <ol className="standings">
          {snap.standings.map((s) => {
            const p = byId.get(s.id)!;
            return (
              <li key={s.id} className={s.id === session.youId ? 'me' : ''}>
                <span className="place">{s.place}</span>
                <ColorDot slot={p.slot} size={12} />
                <span className="sn">{p.name}</span>
                <span className="sk">{s.kills} kill{s.kills === 1 ? '' : 's'}</span>
                <span className="se">{s.eliminatedRound ? `out R${s.eliminatedRound}` : snap.draw ? 'drew' : 'survived'}</span>
              </li>
            );
          })}
        </ol>
        <div className="victory-actions">
          {online ? (
            <>
              <Button variant="primary" onClick={() => online.rematch(!myVote)}>
                {myVote ? `Waiting… ${votes}/${connected}` : 'Rematch'}
              </Button>
              <Button onClick={() => online.backToLobby()}>Back to lobby</Button>
            </>
          ) : (
            <Button variant="primary" onClick={onAgain}>Rematch</Button>
          )}
          <Button variant="danger" onClick={onExit}>Menu</Button>
        </div>
      </div>
    </div>
  );
}
