import { Button } from './common';

const steps = [
  ['1', 'Aim in secret', 'Everyone picks a firing direction at the same time. Your aim is private — rivals only see their own. Rival gun barrels sweep randomly until the reveal.'],
  ['2', 'Lock it in', 'Click / press Space (or use the stick and LOCK button on phones) to commit. You can unlock and re-aim until the timer ends or all players have locked.'],
  ['3', 'Fire together', 'All lasers fire at the same instant. Beams bounce off the arena walls up to twice, stop at the first player they hit, and are absorbed by the central pillar.'],
  ['4', 'Last one standing', 'Players hit by a laser are out — even if they fired in the same volley. Survivors are repositioned fairly each round and the pillar slowly collapses. Everyone down at once is a draw.'],
];

export function HowTo({ onBack }: { onBack: () => void }) {
  return (
    <div className="screen page">
      <div className="page-inner">
        <h2 className="page-title">How to play</h2>
        <ol className="how">
          {steps.map(([n, t, d]) => (
            <li key={n}>
              <span className="num">{n}</span>
              <div><b>{t}</b><p>{d}</p></div>
            </li>
          ))}
        </ol>
        <div className="tips">
          <b>Pro tips</b>
          <ul>
            <li>The dashed preview shows exactly where your laser will travel, bounces included.</li>
            <li>Direct lines across the arena are often blocked — bank shots off the walls can win rounds.</li>
            <li>Opponents that locked early show a rotating ring. Read the room, then bluff.</li>
          </ul>
        </div>
        <Button variant="primary" onClick={onBack}>Back</Button>
      </div>
    </div>
  );
}
