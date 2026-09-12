import { useEffect, useState } from "react";
import AvatarController from "./AvatarController";
import InteractiveTrigger from "./InteractiveTrigger";
import { HUB_COLS, HUB_ROWS, TILE_SIZE, PEDESTAL_TILE, isInsideRoom } from "./useHubState";
import { KING_SKINS, useEquippedSkin, setEquippedSkin } from "../skinStore";
import "./hubWorld.css";

function FriendsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17" cy="7" r="2.4" />
      <path d="M15.5 14.2c2.4.4 4.5 2.6 4.5 5.8" />
    </svg>
  );
}

// A read-only avatar for someone else currently in this dorm - no input
// handling, no click-to-move, just rendered at their last-known position
// (see social/usePresence.js).
function RemoteAvatar({ occupant }) {
  const skin = KING_SKINS[occupant.skin] || KING_SKINS.classic;
  const style = { transform: `translate(${occupant.x * TILE_SIZE}px, ${occupant.y * TILE_SIZE}px)` };
  return (
    <div className={`hub-avatar facing-${occupant.facing || "down"} remote`} style={style}>
      <img src={skin.src} alt="" className="hub-avatar-img" draggable={false} />
      <div className="hub-avatar-shadow" />
      <span className="hub-avatar-nameplate">{occupant.username}</span>
    </div>
  );
}

// Extra space above row 0 so a tall avatar/prop sprite's head has room to
// stick up past the top of its own tile without being clipped by the
// room's overflow:hidden edge - a standing character is taller than the
// footprint tile it stands on.
const HEADROOM = 40;

// Two crossed swords - the pedestal's finial ornament, standing in for the
// PvP duel the pedestal actually queues.
function DuelingSwordsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="19" x2="19" y2="5" />
      <line x1="19" y1="19" x2="5" y2="5" />
      <path d="M12.5 11.5l2.5 2.5M11.5 12.5l-2.5-2.5" />
      <circle cx="5" cy="19" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="19" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

// A proper standing pedestal/statue (Wizard101-courtyard-inspired) built
// from a few stacked CSS shapes rather than a single small icon, so it
// actually reads as a piece of furniture in the room, not a button. There
// is exactly one of these in the room, set against the far-left wall.
function PedestalProp() {
  return (
    <div className="pedestal-prop">
      <div className="pedestal-glow" aria-hidden="true" />
      <div className="pedestal-finial">
        <DuelingSwordsIcon />
      </div>
      <div className="pedestal-column" />
      <div className="pedestal-base-slab pedestal-base-slab-1" />
      <div className="pedestal-base-slab pedestal-base-slab-2" />
    </div>
  );
}

// A small circular "profile picture" - Facebook-style - showing just the
// head of whichever King skin is currently equipped, so the player always
// has a glanceable reminder of who they're playing as. Uses a dedicated
// pre-cropped headSrc image (see skinStore.js) rather than zooming into the
// full-body/full-piece art at render time, so the whole head is always in
// frame regardless of each skin's proportions. Rendered outside
// .hub-room-wrap (see the component below) so its `position: fixed` is
// anchored to the real page edge, not to that wrapper's own transform.
function PlayerProfileBadge({ username }) {
  const equipped = useEquippedSkin();
  return (
    <div className="hub-profile-badge-wrap">
      <div className="hub-profile-badge" title={KING_SKINS[equipped].name}>
        <img src={KING_SKINS[equipped].headSrc} alt="" className="hub-profile-badge-img" />
      </div>
      {username && <span className="hub-username-label">{username}</span>}
    </div>
  );
}

// Stacked directly under the profile picture (both `position: fixed`,
// anchored to the real page edge for the same reason PlayerProfileBadge
// is - see its comment above).
function SkinPicker() {
  const [open, setOpen] = useState(false);
  const equipped = useEquippedSkin();

  return (
    <div className="hub-skin-picker">
      <button type="button" className="hub-skin-toggle" onClick={() => setOpen((v) => !v)} title="Change King skin">
        <img src={KING_SKINS[equipped].src} alt="" className="hub-skin-toggle-img" />
        <span>Skin</span>
      </button>
      {open && (
        <div className="hub-skin-menu">
          {Object.entries(KING_SKINS).map(([key, skin]) => (
            <button
              key={key}
              type="button"
              className={`hub-skin-option${key === equipped ? " active" : ""}`}
              onClick={() => {
                setEquippedSkin(key);
                setOpen(false);
              }}
            >
              <img src={skin.src} alt="" className="hub-skin-option-img" />
              <span>{skin.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FriendsButton({ onClick }) {
  return (
    <button type="button" className="hub-friends-toggle" onClick={onClick} title="Friends">
      <FriendsIcon />
      <span>Friends</span>
    </button>
  );
}

function LogoutButton({ onClick }) {
  return (
    <button type="button" className="hub-logout-btn" onClick={onClick} title="Log out">
      Log Out
    </button>
  );
}

// Shown instead of the pedestal while visiting someone else's dorm - the
// pedestal itself is hidden then (queuing a match from inside someone
// else's room would be ambiguous about whose deck/turn it even is), and
// this is the way back.
function VisitingBanner({ username, onReturnHome }) {
  return (
    <div className="hub-visiting-banner">
      <span>
        Visiting <strong>{username}</strong>&apos;s dorm
      </span>
      <button type="button" onClick={onReturnHome}>
        Return to your dorm
      </button>
    </div>
  );
}

// The "Dorm Room Hub" - a round, igloo-inspired enclosed room the player's
// King avatar walks around in. Purely presentational: all state (position,
// facing, which overlay is open, ...) is owned by useHubState() one level
// up in HeroChessApp, so this component - and the match scenes it hands
// off to - stay decoupled and easy to swap independently.
//
// `presence` (see social/usePresence.js) drives the live, multi-user part:
// whoever else is currently standing in the same dorm renders here too,
// and this avatar's own movement gets broadcast to them. `visiting` (from
// HeroChessApp, since it needs the friend's username which presence alone
// doesn't carry) is who this dorm actually belongs to right now, if not
// the signed-in player themself.
export default function HubWorld({ hub, username, presence, visiting, onReturnHome, onOpenFriends, onLogout }) {
  const equippedSkin = useEquippedSkin();
  const skin = KING_SKINS[equippedSkin];
  const isVisiting = Boolean(visiting);

  // "E to interact" - the keyboard-native counterpart to clicking the
  // pedestal directly, active only while standing next to it (and only in
  // your own dorm - see VisitingBanner above).
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key.toLowerCase() !== "e") return;
      if (!isVisiting && hub.isNearPedestal) hub.setActiveOverlay("match-queue");
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hub.isNearPedestal, hub.setActiveOverlay, isVisiting]);

  // Broadcast this avatar's own position/facing/skin to whoever else is in
  // the same dorm right now, whenever any of them change.
  useEffect(() => {
    presence?.sendMove(hub.position.x, hub.position.y, hub.facing, equippedSkin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hub.position.x, hub.position.y, hub.facing, equippedSkin]);

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
      <div className="hub-side-panel">
        <PlayerProfileBadge username={username} />
        <SkinPicker />
        <FriendsButton onClick={onOpenFriends} />
        <LogoutButton onClick={onLogout} />
      </div>
      <div className="hub-room-wrap">
        {isVisiting && <VisitingBanner username={visiting.username} onReturnHome={onReturnHome} />}
        <div className="hub-room" style={{ width: HUB_COLS * TILE_SIZE, height: HUB_ROWS * TILE_SIZE + HEADROOM }}>
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

            {!isVisiting && (
              <InteractiveTrigger
                tile={PEDESTAL_TILE}
                tileSize={TILE_SIZE}
                isNear={hub.isNearPedestal}
                label="Play a Game"
                promptLabel="Click or press E"
                variant="pedestal"
                icon={<PedestalProp />}
                onActivate={() => hub.setActiveOverlay("match-queue")}
              />
            )}

            {presence?.occupants.map((occupant) => (
              <RemoteAvatar key={occupant.user_id} occupant={occupant} />
            ))}

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
          Move with <strong>WASD</strong> or the arrow keys, or click a tile to walk there.{" "}
          {isVisiting
            ? "This is someone else's dorm - just visiting."
            : "Approach the pedestal to draft your deck and start a game."}
        </p>
      </div>
    </>
  );
}
