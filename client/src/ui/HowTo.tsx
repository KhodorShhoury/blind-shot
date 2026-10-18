import { Button } from './common';

const steps = [
  ['1', 'Walk to your spot', 'Everyone is invisible. Use WASD / arrow keys (or the green stick on a phone) to walk wherever you like while the timer runs. Nobody can see you move — and you can’t see them.'],
  ['2', 'Aim blind', 'Spin your laser through 360° with the mouse (or the purple stick) and pick a direction on instinct. Your aim is private. Click / press Space (or LOCK) to commit; you can re-aim until the timer ends.'],
  ['3', 'Fire together', 'When the countdown hits zero every laser fires at the same instant, in a straight line to the wall. Anyone a beam touches is out — even if they fired in the same volley. The arena then lights up to show where everyone stood and who hit whom.'],
  ['4', 'Last one standing', 'If nobody was hit, a new round starts from where everyone stood. One survivor wins; everyone down at once is a draw.'],
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
            <li>There is no radar and no aim assist — it is a game of nerve and luck.</li>
            <li>You saw where everyone stood last round, but they may have walked since. Predict, or hide somewhere new.</li>
            <li>Aiming through the middle of the arena covers the most ground; aiming at a nearby wall rarely hits anything.</li>
          </ul>
        </div>
        <Button variant="primary" onClick={onBack}>Back</Button>
      </div>
    </div>
  );
}
