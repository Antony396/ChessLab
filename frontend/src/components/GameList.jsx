export default function GameList({ games, selectedGameId, onSelect }) {
  if (!games.length) return null;

  return (
    <ul className="game-list">
      {games.map((g) => {
        const opponent = g.played_color === "white" ? g.black : g.white;
        const outcome = describeOutcome(g);
        return (
          <li
            key={g.id}
            className={`game-item${g.id === selectedGameId ? " selected" : ""}`}
            onClick={() => onSelect(g)}
          >
            <span className={`badge badge-${outcome}`}>{outcome}</span>
            <span className="opponent">
              vs {opponent.username}
              {opponent.rating ? ` (${opponent.rating})` : ""}
            </span>
            <span className="meta">
              {g.platform} · {g.time_control ?? "?"} · {formatDate(g.end_time)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function describeOutcome(g) {
  if (g.result === "1/2-1/2") return "draw";
  const whiteWon = g.result === "1-0";
  const youWon = (whiteWon && g.played_color === "white") || (!whiteWon && g.played_color === "black");
  return youWon ? "win" : "loss";
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString();
}
