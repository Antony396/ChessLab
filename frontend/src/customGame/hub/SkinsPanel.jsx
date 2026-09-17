import { useEffect, useState } from "react";
import { KING_SKINS, useEquippedSkin, setEquippedSkin, isSkinUnlocked } from "../skinStore";
import { fetchMyStreak } from "../dailyPuzzle/api";
import { fetchMapState } from "../puzzleMap/api";
import { fetchHeroMapState } from "../heroPuzzleMap/api";
import { fetchShopState, fetchMe } from "../social/api";

// A proper browsing surface for King skins - shown inside the hub's shared
// station-overlay chrome (see HeroChessApp.jsx), replacing the old cramped
// dropdown menu. Doesn't auto-close on selection, unlike that old menu -
// picking a skin here is "try it on and compare", not "confirm and leave",
// so equipping one just updates the highlighted card in place and leaves
// the gallery open for a further look.
export default function SkinsPanel({ token }) {
  const equipped = useEquippedSkin();
  // Feeds isSkinUnlocked's gating mechanisms (see skinStore.js) -
  // requiresStreak (Daily Puzzle), requiresMapProgress (Puzzle Map),
  // requiresHeroMapProgress (Hero Puzzle Map), and requiresLevel. Defaults
  // to 0/0 (everything gated stays locked) until each loads.
  const [streak, setStreak] = useState(0);
  const [mapSolved, setMapSolved] = useState(0);
  const [heroMapSolved, setHeroMapSolved] = useState(0);
  const [level, setLevel] = useState(0);
  const [ownedSkins, setOwnedSkins] = useState([]);

  useEffect(() => {
    let cancelled = false;
    fetchMyStreak(token)
      .then((result) => {
        if (!cancelled) setStreak(result.current_streak);
      })
      .catch(() => {
        // Not fatal - every skin without requiresStreak still works fine
        // locked at 0.
      });
    fetchMapState(token)
      .then((result) => {
        if (!cancelled) setMapSolved(result.solved_count);
      })
      .catch(() => {
        // Not fatal - same reasoning as above, for requiresMapProgress.
      });
    fetchHeroMapState(token)
      .then((result) => {
        if (!cancelled) setHeroMapSolved(result.solved_count);
      })
      .catch(() => {
        // Not fatal - same reasoning as above, for requiresHeroMapProgress.
      });
    fetchShopState(token)
      .then((result) => {
        if (!cancelled) setOwnedSkins(result.owned_skins);
      })
      .catch(() => {
        // Not fatal - same reasoning as above, for cost-gated skins.
      });
    fetchMe(token)
      .then((me) => {
        if (!cancelled) setLevel(me.level);
      })
      .catch(() => {
        // Not fatal - same reasoning as above, for requiresLevel.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const progress = { streak, mapSolved, heroMapSolved, level, ownedSkins };

  return (
    <div className="skins-panel">
      <p className="skins-panel-hint">Pick a King skin - it shows up for everyone in the dorm, and on your side of the board.</p>
      <div className="skins-grid">
        {Object.entries(KING_SKINS).map(([key, skin]) => {
          const isEquipped = key === equipped;
          const unlocked = isSkinUnlocked(key, progress);
          const lockHint = skin.requiresMapProgress
            ? `Solve ${skin.requiresMapProgress} Puzzle Map nodes to unlock ${skin.name} (${mapSolved}/${skin.requiresMapProgress} so far)`
            : skin.requiresHeroMapProgress
              ? `Solve ${skin.requiresHeroMapProgress} Hero Puzzle Map nodes to unlock ${skin.name} (${heroMapSolved}/${skin.requiresHeroMapProgress} so far)`
              : skin.requiresStreak
                ? `Solve the Daily Puzzle ${skin.requiresStreak} days in a row to unlock ${skin.name} (${streak}/${skin.requiresStreak} so far)`
                : skin.requiresLevel && level < skin.requiresLevel
                  ? `Reach Level ${skin.requiresLevel} to buy ${skin.name} in the Shop (currently Level ${level})`
                  : `Buy ${skin.name} in the Shop for ${skin.cost} currency`;
          return (
            <button
              key={key}
              type="button"
              className={`skin-card${isEquipped ? " equipped" : ""}${unlocked ? "" : " locked"}`}
              onClick={() => setEquippedSkin(key, progress, token)}
              disabled={!unlocked}
              title={isEquipped ? `${skin.name} (equipped)` : unlocked ? `Equip ${skin.name}` : lockHint}
            >
              {isEquipped && <span className="skin-card-badge">Equipped</span>}
              {!unlocked && (
                <span className="skin-card-lock">
                  🔒{" "}
                  {skin.requiresMapProgress
                    ? `${mapSolved}/${skin.requiresMapProgress}`
                    : skin.requiresHeroMapProgress
                      ? `${heroMapSolved}/${skin.requiresHeroMapProgress}`
                      : skin.requiresStreak
                        ? `${streak}/${skin.requiresStreak}`
                        : skin.requiresLevel && level < skin.requiresLevel
                          ? `Lv ${level}/${skin.requiresLevel}`
                          : `${skin.cost}`}
                </span>
              )}
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
