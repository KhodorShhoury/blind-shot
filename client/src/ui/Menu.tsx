import { useState } from 'react';
import type { BotLevel } from '@shared/config';
import { Button, Modal, useSettings } from './common';
import { getSettings, updateSettings } from '../game/settings';

interface Props {
  inviteCode: string | null;
  busy: boolean;
  error: string;
  onCreate: (name: string) => void;
  onJoin: (code: string, name: string) => void;
  onPractice: (bots: number, level: BotLevel) => void;
  onHowTo: () => void;
  onSettings: () => void;
}

export function Menu({ inviteCode, busy, error, onCreate, onJoin, onPractice, onHowTo, onSettings }: Props) {
  const s = useSettings();
  const [panel, setPanel] = useState<'none' | 'online' | 'practice'>(inviteCode ? 'online' : 'none');
  const [code, setCode] = useState(inviteCode ?? '');
  const [bots, setBots] = useState(2);
  const [level, setLevel] = useState<BotLevel>('normal');

  const name = s.name;
  const setName = (v: string) => updateSettings({ name: v.slice(0, 14) });
  const finalName = () => (name.trim() ? name.trim() : getSettings().name || 'Player');

  return (
    <div className="menu screen">
      <div className="bg-lasers" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={`bl bl${i}`} />
        ))}
      </div>
      <div className="menu-inner">
        <h1 className="title" aria-label="Blind Shot">
          <span className="t1">BLIND</span>
          <span className="t2">SHOT</span>
        </h1>
        <p className="tagline">Aim in secret. Fire together. Outguess everyone.</p>
        <nav className="menu-buttons">
          <Button variant="primary" onClick={() => setPanel('online')}>Play Online</Button>
          <Button onClick={() => setPanel('practice')}>Practice Mode</Button>
          <Button onClick={onHowTo}>How to Play</Button>
          <Button onClick={onSettings}>Settings</Button>
        </nav>
        <footer className="foot">2–4 players · no account needed · works on phones</footer>
      </div>

      {panel === 'online' && (
        <Modal title="Play Online" onClose={() => setPanel('none')}>
          <label className="field">
            <span>Your name</span>
            <input value={name} maxLength={14} placeholder="Player" onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </label>
          <Button variant="primary" className="wide" disabled={busy} onClick={() => onCreate(finalName())}>Create private room</Button>
          <div className="or"><span>or join with a code</span></div>
          <div className="join-row">
            <input
              className="code-input"
              value={code}
              maxLength={5}
              placeholder="ABCDE"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && code.length === 5 && onJoin(code, finalName())}
            />
            <Button disabled={busy || code.length !== 5} onClick={() => onJoin(code, finalName())}>Join</Button>
          </div>
          {busy && <p className="note">Connecting…</p>}
          {error && <p className="error" role="alert">{error}</p>}
        </Modal>
      )}

      {panel === 'practice' && (
        <Modal title="Practice Mode" onClose={() => setPanel('none')}>
          <label className="field">
            <span>Your name</span>
            <input value={name} maxLength={14} placeholder="You" onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </label>
          <div className="field">
            <span>Opponents</span>
            <div className="seg">
              {[1, 2, 3].map((n) => (
                <button key={n} className={bots === n ? 'on' : ''} onClick={() => setBots(n)}>{n} bot{n > 1 ? 's' : ''}</button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>Difficulty</span>
            <div className="seg">
              {(['easy', 'normal', 'hard'] as const).map((l) => (
                <button key={l} className={level === l ? 'on' : ''} onClick={() => setLevel(l)}>{l}</button>
              ))}
            </div>
          </div>
          <Button variant="primary" className="wide" onClick={() => onPractice(bots, level)}>Start match</Button>
          <p className="note">Runs entirely in your browser — no server needed.</p>
        </Modal>
      )}
    </div>
  );
}
