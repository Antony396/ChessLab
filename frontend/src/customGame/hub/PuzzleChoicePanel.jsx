// The puzzle pedestal's first stop: pick between the Puzzle Map (a fixed
// 50-node route of standard-chess tactics that unlocks the Regal King skin
// at node 50) and the Hero Puzzle Map (a second, hand-authored route built
// around the custom hero pieces, unlocking the Hydra King skin at node 50).
// Rendered inside the shared hub-overlay chrome (see HeroChessApp.jsx), but
// dressed in its own hand-painted frame/banner art rather than that generic
// chrome - see the .hub-overlay-panel:has(.puzzle-choice-panel) overrides in
// hubWorld.css. The old Daily Puzzle option lives here in history only -
// its backend/streak data is untouched, just no longer reachable from this
// screen.
export default function PuzzleChoicePanel({ onChoosePuzzleMap, onChooseHeroPuzzleMap }) {
  return (
    <div className="puzzle-choice-panel">
      <div className="puzzle-choice-header" />
      <button type="button" className="puzzle-choice-card map" onClick={onChoosePuzzleMap}>
        <span className="puzzle-choice-name">Puzzle Map</span>
        <span className="puzzle-choice-desc">Classic tactics. Unlocks the Regal King skin.</span>
      </button>
      <button type="button" className="puzzle-choice-card hero" onClick={onChooseHeroPuzzleMap}>
        <span className="puzzle-choice-name">Hero Puzzles</span>
        <span className="puzzle-choice-desc">Original hero-piece puzzles. Unlocks the Hydra King skin.</span>
      </button>
    </div>
  );
}
