import { Button, useSettings } from './common';
import { updateSettings } from '../game/settings';
import { audio } from '../game/audio';

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const s = useSettings();
  return (
    <div className="screen page">
      <div className="page-inner">
        <h2 className="page-title">Settings</h2>
        <div className="settings">
          <label className="row">
            <span>Master volume <em>{Math.round(s.volume * 100)}%</em></span>
            <input type="range" min={0} max={1} step={0.05} value={s.volume} onChange={(e) => { updateSettings({ volume: +e.target.value }); audio.unlock(); audio.click(); }} />
          </label>
          <label className="row inline">
            <span>Sound effects</span>
            <input type="checkbox" className="switch" checked={s.sfx} onChange={(e) => { updateSettings({ sfx: e.target.checked }); audio.unlock(); }} />
          </label>
          <label className="row inline">
            <span>Reduced motion <small>No screen shake or flashes</small></span>
            <input type="checkbox" className="switch" checked={s.reducedMotion} onChange={(e) => updateSettings({ reducedMotion: e.target.checked })} />
          </label>
          <div className="row">
            <span>Particle intensity</span>
            <div className="seg">
              {(['low', 'medium', 'high'] as const).map((p) => (
                <button key={p} className={s.particles === p ? 'on' : ''} onClick={() => updateSettings({ particles: p })}>{p}</button>
              ))}
            </div>
          </div>
          <div className="row">
            <span>Touch controls</span>
            <div className="seg">
              {(['auto', 'on', 'off'] as const).map((p) => (
                <button key={p} className={s.touchControls === p ? 'on' : ''} onClick={() => updateSettings({ touchControls: p })}>{p}</button>
              ))}
            </div>
          </div>
        </div>
        <Button variant="primary" onClick={onBack}>Back</Button>
      </div>
    </div>
  );
}
