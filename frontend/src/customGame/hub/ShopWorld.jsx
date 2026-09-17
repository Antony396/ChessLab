import { useEffect } from "react";
import AvatarController from "./AvatarController";
import InteractiveTrigger from "./InteractiveTrigger";
import { PlayerProfileBadge, SkinButton, HEADROOM } from "./HubWorld";
import { HUB_COLS, HUB_ROWS, TILE_SIZE, SHOP_COUNTER_TILE, SHOP_EXIT_TILE, isInsideRoom } from "./useHubState";
import { KING_SKINS, useEquippedSkin } from "../skinStore";
import "./hubWorld.css";

// The Shop - a third room, reached from the Commons (see
// useHubState.js's COMMONS_SHOP_TILE and HeroChessApp.jsx's
// handleVisitShop/handleReturnToCommons), not from a player's own dorm.
// Unlike the Commons, nobody else is ever in here with you - no presence,
// no chat, no RemoteAvatar rendering - so this is an even more trimmed-down
// sibling of HubWorld than CommonsWorld is: just the walkable floor, your
// own avatar, the shop counter (which opens the same Shop panel the hub's
// side-button already does - see HeroChessApp.jsx's onOpenShop), and the
// way back to the Commons. Reuses HubWorld's own PlayerProfileBadge/
// SkinButton/HEADROOM exports rather than duplicating that chrome, same as
// CommonsWorld does.
export default function ShopWorld({ hub, onReturnToCommons, username, token, onOpenSkins, onOpenShop }) {
  const equippedSkin = useEquippedSkin();
  const skin = KING_SKINS[equippedSkin];

  // "E to interact", mirroring HubWorld/CommonsWorld's own pattern.
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key.toLowerCase() !== "e") return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (hub.isNearShopCounter) onOpenShop();
      else if (hub.isNearShopExit) onReturnToCommons();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hub.isNearShopCounter, hub.isNearShopExit, onOpenShop, onReturnToCommons]);

  const tiles = [];
  for (let y = 0; y < HUB_ROWS; y++) {
    for (let x = 0; x < HUB_COLS; x++) {
      if (isInsideRoom({ x, y })) tiles.push({ x, y });
    }
  }

  function handleFloorClick(tile) {
    hub.walkTo(tile);
  }

  return (
    <>
      <div className="hub-side-panel left">
        <PlayerProfileBadge username={username} />
        <SkinButton onClick={onOpenSkins} />
      </div>
      <div className="hub-room-wrap">
        <div
          className="hub-room"
          style={{
            width: HUB_COLS * TILE_SIZE,
            height: HUB_ROWS * TILE_SIZE + HEADROOM,
            backgroundImage: "url(/hub/shop_area.png)",
          }}
        >
          <div className="hub-grid" style={{ top: HEADROOM }}>
            {tiles.map((tile) => (
              <button
                key={`${tile.x}-${tile.y}`}
                type="button"
                className="hub-floor-tile"
                style={{ transform: `translate(${tile.x * TILE_SIZE}px, ${tile.y * TILE_SIZE}px)` }}
                onClick={() => handleFloorClick(tile)}
                aria-label={`Walk to tile ${tile.x}, ${tile.y}`}
              />
            ))}

            <InteractiveTrigger
              tile={SHOP_COUNTER_TILE}
              tileSize={TILE_SIZE}
              isNear={hub.isNearShopCounter}
              label="Browse the Shop"
              promptLabel="Click or press E"
              icon={<span aria-hidden="true">🛒</span>}
              onActivate={onOpenShop}
            />

            <InteractiveTrigger
              tile={SHOP_EXIT_TILE}
              tileSize={TILE_SIZE}
              isNear={hub.isNearShopExit}
              label="Back to Commons"
              promptLabel="Click or press E"
              variant="door"
              onActivate={onReturnToCommons}
            />

            <AvatarController
              position={hub.position}
              facing={hub.facing}
              isHopping={hub.isHopping}
              skin={skin}
              tileSize={TILE_SIZE}
              onStep={hub.step}
            />
          </div>
        </div>

        <p className="hub-hint">
          Move with <strong>WASD</strong> or the arrow keys, or click a tile to walk there. Approach the counter to
          browse the Shop, or the way out to head back to the Commons.
        </p>
      </div>
    </>
  );
}
