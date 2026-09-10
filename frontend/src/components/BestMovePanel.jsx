import { describeMove, summarizeTags } from "../utils/moveInsight";

export default function BestMovePanel({ analysis, currentPly, showPath, onTogglePath }) {
  if (currentPly >= analysis.moves.length) {
    return <div className="best-move-panel best-move-panel-done">Game over — no further moves to suggest.</div>;
  }

  const m = analysis.moves[currentPly];
  const tags = describeMove(m.fen_before, m.best_move_uci, m.move_number);
  const hasLine = m.best_line_san.length > 1;

  return (
    <div className="best-move-panel">
      <div className="best-move-heading">
        <span className="best-move-label">Stockfish suggests, for {m.side}</span>
        <span className="best-move-san">{m.best_move_san}</span>
        {hasLine && (
          <button type="button" className="show-path-btn" onClick={onTogglePath}>
            {showPath ? "Hide path" : "Show path"}
          </button>
        )}
      </div>
      <p className="best-move-reason">{summarizeTags(tags)}</p>
      {showPath && hasLine && (
        <p className="best-move-line">
          Expected continuation: {m.best_line_san.join(" → ")}
        </p>
      )}
      <p className="best-move-caveat">Reasoning is a local heuristic, not Stockfish's own words.</p>
    </div>
  );
}
