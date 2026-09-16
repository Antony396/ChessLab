import { useEffect, useRef, useState } from "react";
import AvatarController from "./AvatarController";
import InteractiveTrigger from "./InteractiveTrigger";
import { RemoteAvatar, ChatBar, HEADROOM, PlayerProfileBadge, SkinButton } from "./HubWorld";
import { HUB_COLS, HUB_ROWS, TILE_SIZE, COMMONS_EXIT_TILE, isInsideRoom } from "./useHubState";
import { KING_SKINS, useEquippedSkin } from "../skinStore";
import { CHAT_BUBBLE_DURATION_MS } from "../social/usePresence";
import "./hubWorld.css";

// The Commons - a single shared room every connected user walks into
// together (reached through a door in their own dorm - see HubWorld.jsx's
// DOOR_TILE trigger), unlike every other room here which belongs to one
// account. Deliberately a trimmed-down sibling of HubWorld rather than a
// "visiting" mode of it: no pedestal, no puzzle stand, no leaderboard,
// none of that room-specific station machinery belongs to a room nobody
// owns - just walking around and chatting with whoever else is here right
// now. Your own profile picture and skin picker aren't a "station" though
// (they're about you, not this room), so those DO still show here - see
// the side panel below, reusing HubWorld's own PlayerProfileBadge/
// SkinButton exports rather than duplicating that chrome. Reuses HubWorld's
// own RemoteAvatar/ChatBar/HEADROOM and hubWorld.css wholesale (same
// avatar, same chat bar, same tile grid) rather than duplicating them,
// overriding only the one thing that's actually different: which image the
// room's floor/walls are painted with.
export default function CommonsWorld({ hub, presence, onReturnHome, username, token, myUserId, onOpenSkins }) {
  const equippedSkin = useEquippedSkin();
  const skin = KING_SKINS[equippedSkin];
  const [myBubble, setMyBubble] = useState(null);
  const myBubbleTimerRef = useRef(null);
  const chatInputRef = useRef(null);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key !== "Enter") return;
      const active = document.activeElement;
      if (active === chatInputRef.current) return;
      if (active?.tagName === "INPUT" || active?.tagName === "TEXTAREA") return;
      e.preventDefault();
      chatInputRef.current?.focus();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function handleSendChat(text) {
    presence?.sendChat(text);
    const key = `${Date.now()}-${Math.random()}`;
    setMyBubble({ text, key });
    window.clearTimeout(myBubbleTimerRef.current);
    myBubbleTimerRef.current = window.setTimeout(() => {
      setMyBubble((prev) => (prev?.key === key ? null : prev));
    }, CHAT_BUBBLE_DURATION_MS);
  }

  // "E to interact" for the exit door, mirroring HubWorld's own pattern.
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key.toLowerCase() !== "e") return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (hub.isNearCommonsExit) onReturnHome();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hub.isNearCommonsExit, onReturnHome]);

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
      {/* Fixed to the real viewport edge, not the room - rendered as a
          sibling of .hub-room-wrap below (not inside it), same reasoning
          as HubWorld.jsx's own side panel: .hub-room-wrap has its own
          transform (see hubWorld.css), which would turn this fixed
          positioning back into something relative to it instead. */}
      <div className="hub-side-panel">
        <PlayerProfileBadge username={username} />
        <SkinButton onClick={onOpenSkins} />
      </div>
      <div className="hub-room-wrap">
        <div
          className="hub-room"
          style={{
            width: HUB_COLS * TILE_SIZE,
            height: HUB_ROWS * TILE_SIZE + HEADROOM,
            backgroundImage: "url(/hub/commons.jpg)",
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
              tile={COMMONS_EXIT_TILE}
              tileSize={TILE_SIZE}
              isNear={hub.isNearCommonsExit}
              label="Back to Dorm"
              promptLabel="Click or press E"
              icon={<span aria-hidden="true">🚪</span>}
              onActivate={onReturnHome}
            />

            {presence?.occupants.map((occupant) => (
              <RemoteAvatar
                key={occupant.user_id}
                occupant={occupant}
                bubbleText={presence.chatBubbles[occupant.user_id]?.text}
                token={token}
                myUserId={myUserId}
              />
            ))}

            <AvatarController
              position={hub.position}
              facing={hub.facing}
              isHopping={hub.isHopping}
              bubbleText={myBubble?.text}
              skin={skin}
              tileSize={TILE_SIZE}
              onStep={hub.step}
            />
          </div>
        </div>

        <ChatBar ref={chatInputRef} onSend={handleSendChat} />

        <p className="hub-hint">
          Move with <strong>WASD</strong> or the arrow keys, or click a tile to walk there. Everyone's dorm connects
          here - approach the door to head back to yours.
        </p>
      </div>
    </>
  );
}
