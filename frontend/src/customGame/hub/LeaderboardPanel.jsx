import { useEffect, useState } from "react";
import { fetchLeaderboard } from "../social/api";
import "./leaderboardPanel.css";

// The Leaderboard station: top players by ELO (see backend's db.py -
// apply_elo_result only ever moves it for a real online game between two
// known accounts, never vs_ai/local-sandbox play). Rendered inside the same
// overlay chrome the deck builder/Friends/Skins stations use.
export default function LeaderboardPanel({ token, myUserId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchLeaderboard(token)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (error) return <p className="leaderboard-error">{error}</p>;
  if (!data) return <p className="leaderboard-loading">Loading…</p>;

  const onTheList = data.entries.some((entry) => entry.id === myUserId);

  return (
    <div className="leaderboard-panel">
      <p className="leaderboard-hint">
        ELO updates after a real online match ends - vs Computer games don't count. Everyone starts at 1000.
      </p>
      <ol className="leaderboard-list">
        {data.entries.map((entry) => (
          <li key={entry.id} className={`leaderboard-row${entry.id === myUserId ? " me" : ""}`}>
            <span className="leaderboard-rank">#{entry.rank}</span>
            <span className="leaderboard-username">{entry.username}</span>
            <span className="leaderboard-elo">{entry.elo}</span>
          </li>
        ))}
      </ol>
      {!onTheList && data.my_rank && (
        <div className="leaderboard-me-row">
          <span className="leaderboard-rank">#{data.my_rank}</span>
          <span className="leaderboard-username">You</span>
          <span className="leaderboard-elo">{data.my_elo}</span>
        </div>
      )}
    </div>
  );
}
