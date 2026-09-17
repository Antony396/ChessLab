import { useEffect, useState } from "react";
import { fetchLeaderboard } from "../social/api";
import { KING_SKINS } from "../skinStore";
import "./leaderboardPanel.css";

// Same crown glyph as the King's deck-slot badge (DeckBuilder.jsx's own
// CrownIcon) - the emoji this replaced rendered as a different crown per
// OS/browser and didn't match the game's own art anywhere else.
function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none">
      <path d="M4 18h16l1-9-5 3-4-6-4 6-5-3 1 9z" />
    </svg>
  );
}

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
  // The top 10% of whatever's actually on screen (the top-N list, not the
  // whole userbase - the backend doesn't return a total account count) -
  // always at least 1, so a short list still highlights its own #1.
  const topTenPercentCutoff = Math.max(1, Math.ceil(data.entries.length * 0.1));

  function skinFor(key) {
    return KING_SKINS[key] || KING_SKINS.classic;
  }

  return (
    <div className="leaderboard-panel">
      <p className="leaderboard-hint">
        ELO updates after a real online match ends - vs Computer games don't count. Everyone starts at 1000.
      </p>
      <ol className="leaderboard-list">
        {data.entries.map((entry) => {
          const isFirst = entry.rank === 1;
          const isTopTen = entry.rank <= topTenPercentCutoff;
          return (
            <li
              key={entry.id}
              className={`leaderboard-row${entry.id === myUserId ? " me" : ""}${isFirst ? " first" : ""}${
                isTopTen ? " top-ten" : ""
              }`}
            >
              <span className="leaderboard-rank">#{entry.rank}</span>
              <img
                src={skinFor(entry.equipped_skin).src}
                alt=""
                className={`leaderboard-skin-img${isFirst ? " first" : ""}`}
              />
              <span className="leaderboard-username">{entry.username}</span>
              {isFirst && (
                <span className="leaderboard-crown" title="#1">
                  <CrownIcon />
                </span>
              )}
              {!isFirst && isTopTen && <span className="leaderboard-top-ten-badge" title="Top 10%">★</span>}
              <span className="leaderboard-elo">{entry.elo}</span>
            </li>
          );
        })}
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
