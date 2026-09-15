import { useEffect, useState } from "react";
import { KING_SKINS, useEquippedSkin, setEquippedSkin, isSkinUnlocked } from "../skinStore";
import { fetchMyStreak } from "../dailyPuzzle/api";

// A proper browsing surface for King skins - shown inside the hub's shared
// station-overlay chrome (see HeroChessApp.jsx), replacing the old cramped
// dropdown menu. Doesn't auto-close on selection, unlike that old menu -
// picking a skin here is "try it on and compare", not "confirm and leave",
// so equipping one just updates the highlighted card in place and leaves
// the gallery open for a further look.
export default function SkinsPanel({ token }) {
  const equipped = useEquippedSkin();
  // Only matters for a requiresStreak skin (see skinStore.js) - no entry
  // sets that yet, so this fetch is foundation for whenever one does.
  // Defaults to 0 (everything streak-gated stays locked) until it loads.
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchMyStreak(token)
      .then((result) => {
        if (!cancelled) setStreak(result.current_streak);
      })
      .catch(() => {
        // Not fatal - every skin without requiresStreak still works fine
        // locked at 0, and there isn't one that needs it yet anyway.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="skins-panel">
      <p className="skins-panel-hint">Pick a King skin - it shows up for everyone in the dorm, and on your side of the board.</p>
      <div className="skins-grid">
        {Object.entries(KING_SKINS).map(([key, skin]) => {
          const isEquipped = key === equipped;
          const unlocked = isSkinUnlocked(key, streak);
          return (
            <button
              key={key}
              type="button"
              className={`skin-card${isEquipped ? " equipped" : ""}${unlocked ? "" : " locked"}`}
              onClick={() => setEquippedSkin(key, streak)}
              disabled={!unlocked}
              title={
                isEquipped
                  ? `${skin.name} (equipped)`
                  : unlocked
                    ? `Equip ${skin.name}`
                    : `Solve the Daily Puzzle ${skin.requiresStreak} days in a row to unlock ${skin.name} (${streak}/${skin.requiresStreak} so far)`
              }
            >
              {isEquipped && <span className="skin-card-badge">Equipped</span>}
              {!unlocked && <span className="skin-card-lock">🔒 {streak}/{skin.requiresStreak}</span>}
              <span className="skin-card-preview">
                <img src={skin.src} alt="" className="skin-card-img" />
              </span>
              <span className="skin-card-name">{skin.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
