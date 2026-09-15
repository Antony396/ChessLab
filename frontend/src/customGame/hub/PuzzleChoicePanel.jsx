// The puzzle pedestal's first stop: pick between the existing Puzzle Rush
// (a timed run through a static pool of plain-chess puzzles) and the new
// Daily Puzzle (one hand-authored, hero-piece-featuring puzzle a day,
// shared by everyone, building a streak). Rendered inside the same overlay
// chrome every other station uses (see HeroChessApp.jsx).
export default function PuzzleChoicePanel({ onChoosePuzzleRush, onChooseDailyPuzzle }) {
  return (
    <div className="puzzle-choice-panel">
      <button type="button" className="puzzle-choice-card" onClick={onChoosePuzzleRush}>
        <span className="puzzle-choice-name">Puzzle Rush</span>
        <span className="puzzle-choice-desc">Timed run through standard-chess puzzles. Beat your score.</span>
      </button>
      <button type="button" className="puzzle-choice-card" onClick={onChooseDailyPuzzle}>
        <span className="puzzle-choice-name">Daily Puzzle</span>
        <span className="puzzle-choice-desc">
          One new hero-piece puzzle every day. Solve 10 days in a row to unlock a skin.
        </span>
      </button>
    </div>
  );
}
