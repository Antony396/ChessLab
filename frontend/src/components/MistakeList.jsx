import { formatEval } from "../utils/evalFormat";

export default function MistakeList({ analysis, currentPly, setCurrentPly }) {
  const mistakes = analysis.moves.filter((m) => m.is_player_move && m.classification !== "OK");

  if (!mistakes.length) {
    return (
      <p className="mistake-empty">
        No inaccuracies, mistakes, or blunders found for {analysis.searched_username} at this depth.
      </p>
    );
  }

  return (
    <ul className="mistake-list">
      {mistakes.map((m) => (
        <li
          key={m.ply}
          className={`mistake-item mistake-${m.classification.toLowerCase()}${
            m.ply === currentPly ? " selected" : ""
          }`}
          onClick={() => setCurrentPly(m.ply)}
        >
          <span className={`badge badge-${m.classification.toLowerCase()}`}>{m.classification}</span>
          <span>
            Move {m.move_number} ({m.side}): played <strong>{m.move_played_san}</strong>, best was{" "}
            <strong>{m.best_move_san}</strong>
          </span>
          <span className="mistake-eval">
            {formatEval(m.eval_before)} → {formatEval(m.eval_after)}
          </span>
        </li>
      ))}
    </ul>
  );
}
