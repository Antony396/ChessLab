import { KING_SKINS, useEquippedSkin, setEquippedSkin } from "../skinStore";

// A proper browsing surface for King skins - shown inside the hub's shared
// station-overlay chrome (see HeroChessApp.jsx), replacing the old cramped
// dropdown menu. Doesn't auto-close on selection, unlike that old menu -
// picking a skin here is "try it on and compare", not "confirm and leave",
// so equipping one just updates the highlighted card in place and leaves
// the gallery open for a further look.
export default function SkinsPanel() {
  const equipped = useEquippedSkin();

  return (
    <div className="skins-panel">
      <p className="skins-panel-hint">Pick a King skin - it shows up for everyone in the dorm, and on your side of the board.</p>
      <div className="skins-grid">
        {Object.entries(KING_SKINS).map(([key, skin]) => {
          const isEquipped = key === equipped;
          return (
            <button
              key={key}
              type="button"
              className={`skin-card${isEquipped ? " equipped" : ""}`}
              onClick={() => setEquippedSkin(key)}
              title={isEquipped ? `${skin.name} (equipped)` : `Equip ${skin.name}`}
            >
              {isEquipped && <span className="skin-card-badge">Equipped</span>}
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
