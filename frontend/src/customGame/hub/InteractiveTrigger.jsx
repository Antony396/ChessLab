// A generic wrapper for anything in the room the player can interact with -
// the PvP pedestal, the deck-building desk, and whatever else gets added
// later. Renders its prop art at a fixed tile, a proximity glow + floating
// prompt when the avatar is standing next to it, and fires onActivate on a
// direct click regardless of distance (so it doubles as point-and-click).
export default function InteractiveTrigger({ tile, tileSize, isNear, label, promptLabel, icon, variant, onActivate }) {
  const style = {
    transform: `translate(${tile.x * tileSize}px, ${tile.y * tileSize}px)`,
  };

  return (
    <button
      type="button"
      className={`hub-trigger${variant ? ` hub-trigger-${variant}` : ""}${isNear ? " near" : ""}`}
      style={style}
      onClick={onActivate}
      title={label}
    >
      {isNear && <span className="hub-trigger-prompt">{promptLabel}</span>}
      <span className="hub-trigger-glow" aria-hidden="true" />
      <span className="hub-trigger-icon">{icon}</span>
      <span className="hub-trigger-label">{label}</span>
    </button>
  );
}
