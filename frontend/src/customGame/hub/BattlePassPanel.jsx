import { useEffect, useState } from "react";
import { fetchBattlePassState, claimBattlePassLevel } from "../social/api";

const REWARD_PER_LEVEL = 20; // mirrors db.py's BATTLE_PASS_REWARD_PER_LEVEL

// How many levels ahead of your CURRENT level to preview (greyed out, not
// yet reachable) - so the track reads as an actual track rather than a
// list that stops the instant you run out of claims.
const PREVIEW_AHEAD = 4;

// The one free reward track (see db.py's own comment on why there's no
// premium tier yet - no payment system to sell one through). Every level
// reached is claimable once, for currency that scales with the level.
export default function BattlePassPanel({ token }) {
  const [state, setState] = useState(null); // {level, xp, xp_into_level, xp_for_next_level, claimed_levels, claimable_levels}
  const [claimingLevel, setClaimingLevel] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchBattlePassState(token)
      .then((result) => {
        if (!cancelled) setState(result);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  function handleClaim(level) {
    setError(null);
    setClaimingLevel(level);
    claimBattlePassLevel(token, level)
      .then(setState)
      .catch((e) => setError(e.message))
      .finally(() => setClaimingLevel(null));
  }

  if (!state) {
    return <div className="battle-pass-panel">{error ? <p className="shop-panel-error">{error}</p> : <p className="skins-panel-hint">Loading…</p>}</div>;
  }

  const progressPct = state.xp_for_next_level > 0 ? Math.min(100, (state.xp_into_level / state.xp_for_next_level) * 100) : 100;
  const trackLevels = Array.from({ length: state.level + PREVIEW_AHEAD }, (_, i) => i + 1);

  return (
    <div className="battle-pass-panel">
      <div className="bp-header">
        <div className="bp-level-badge">Lv {state.level}</div>
        <div className="bp-xp-bar-wrap">
          <div className="bp-xp-bar-track">
            <div className="bp-xp-bar-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <span className="bp-xp-label">
            {state.xp_into_level} / {state.xp_for_next_level} XP to Lv {state.level + 1}
          </span>
        </div>
      </div>
      {error && <p className="shop-panel-error">{error}</p>}
      <p className="skins-panel-hint">Every level earns you a claim - win (or draw/lose) online games to gain XP.</p>
      <div className="bp-track">
        {trackLevels.map((level) => {
          const reached = level <= state.level;
          const claimed = state.claimed_levels.includes(level);
          const claimable = reached && !claimed;
          const isClaiming = claimingLevel === level;
          return (
            <div key={level} className={`bp-node${reached ? " reached" : ""}${claimed ? " claimed" : ""}`}>
              <div className="bp-node-level">{level}</div>
              <div className="bp-node-reward">🪙 {level * REWARD_PER_LEVEL}</div>
              {claimed ? (
                <span className="bp-node-status">Claimed</span>
              ) : claimable ? (
                <button type="button" className="bp-node-claim" disabled={isClaiming} onClick={() => handleClaim(level)}>
                  {isClaiming ? "…" : "Claim"}
                </button>
              ) : (
                <span className="bp-node-status locked">🔒</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
