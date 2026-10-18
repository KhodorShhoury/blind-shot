import { Button } from './common';

const steps = [
  ['1', 'Vanish & scatter', 'Every round the server drops every survivor at a brand-new random spot, then hides everyone. You only see yourself — nobody can see anyone else, and nobody gets any hint where they are.'],
  ['2', 'Aim blind', 'Spin your laser through 360° and pick a direction on pure instinct. Your aim is private. Click / press Space (or use the stick and LOCK button on phones) to commit; you can re-aim until the timer ends.'],
  ['3', 'Fire together', 'When the countdown hits zero every laser fires at the same instant, in a straight line to the wall. Anyone a beam touches is out — even if they fired in the same volley. The arena then lights up to show who hit whom.'],
  ['4', 'Last one standing', 'If nobody was hit, everyone is scattered again and a new round starts. One survivor wins; everyone down at once is a draw.'],
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
            <li>Positions are re-rolled every round, so what you saw last round tells you nothing.</li>
            <li>Aiming through the middle of the arena covers the most ground; aiming at a nearby wall rarely hits anything.</li>
          </ul>
        </div>
        <Button variant="primary" onClick={onBack}>Back</Button>
      </div>
    </div>
  );
}
