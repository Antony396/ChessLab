// The puzzle pedestal's first stop: pick between the Daily Puzzle (one
// hand-authored, hero-piece-featuring puzzle a day, shared by everyone,
// building a streak) and the Puzzle Map (a fixed 50-node route of
// standard-chess tactics that unlocks the Hydra King skin at node 50).
// Rendered inside the same overlay chrome every other station uses (see
// HeroChessApp.jsx).
export default function PuzzleChoicePanel({ onChoosePuzzleMap, onChooseDailyPuzzle }) {
  return (
    <div className="puzzle-choice-panel">
      <button type="button" className="puzzle-choice-card" onClick={onChooseDailyPuzzle}>
        <span className="puzzle-choice-name">Daily Puzzle</span>
        <span className="puzzle-choice-desc">
          One new hero-piece puzzle every day. Solve 10 days in a row to unlock a skin.
        </span>
      </button>
      <button type="button" className="puzzle-choice-card" onClick={onChoosePuzzleMap}>
        <span className="puzzle-choice-name">Puzzle Map</span>
        <span className="puzzle-choice-desc">
          A 50-puzzle route. Solve your way to the end to unlock the Hydra King skin.
        </span>
      </button>
    </div>
  );
}
