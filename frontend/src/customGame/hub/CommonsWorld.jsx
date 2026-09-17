import { useEffect, useRef, useState } from "react";
import AvatarController from "./AvatarController";
import InteractiveTrigger from "./InteractiveTrigger";
import {
  RemoteAvatar,
  ChatBar,
  HEADROOM,
  PlayerProfileBadge,
  SkinButton,
  LeaderboardProp,
  PlaySection,
  PlayerStatsBadge,
  FriendsButton,
} from "./HubWorld";
import { HUB_COLS, HUB_ROWS, TILE_SIZE, COMMONS_EXIT_TILE, LEADERBOARD_TILE, isInsideRoom } from "./useHubState";
import { KING_SKINS, useEquippedSkin } from "../skinStore";
import { CHAT_BUBBLE_DURATION_MS } from "../social/usePresence";
import "./hubWorld.css";

// The Commons - a single shared room every connected user walks into
// together (reached through a door in their own dorm - see HubWorld.jsx's
// DOOR_TILE trigger), unlike every other room here which belongs to one
// account. No pedestal/puzzle-stand furniture of its own - deck-building
// and puzzles both still route through the right sidebar's Play/Puzzles
// entries rather than a piece of floor furniture, since there's no single
// owner's desk to put one at. The leaderboard signboard is genuinely
// shared/global though (it's not "whose room is it" - it's everyone's
// standings), so it gets real floor furniture here same as the hub does,
// reusing LEADERBOARD_TILE/LeaderboardProp rather than duplicating them.
// Your own profile picture and skin picker aren't a "station" either
// (they're about you, not this room), so those DO still show here - see
// the side panels below, reusing HubWorld's own exports rather than
// duplicating that chrome. Reuses HubWorld's own RemoteAvatar/ChatBar/
// HEADROOM and hubWorld.css wholesale (same avatar, same chat bar, same
// tile grid) rather than duplicating them, overriding only the one thing
// that's actually different: which image the room's floor/walls are
// painted with.
export default function CommonsWorld({
  hub,
  presence,
  onReturnHome,
  username,
  token,
  myUserId,
  onOpenSkins,
  onOpenFriends,
  onOpenPuzzles,
  onOpenLeaderboard,
}) {
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

  // "E to interact" for the exit door and the leaderboard, mirroring
  // HubWorld's own pattern. No shop entrance for now - see the
  // InteractiveTrigger below's own comment.
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key.toLowerCase() !== "e") return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (hub.isNearCommonsExit) onReturnHome();
      else if (hub.isNearLeaderboard) onOpenLeaderboard();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hub.isNearCommonsExit, hub.isNearLeaderboard, onReturnHome, onOpenLeaderboard]);

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
      <div className="hub-side-panel left">
        <PlayerProfileBadge username={username} />
        <SkinButton onClick={onOpenSkins} />
      </div>
      <div className="hub-side-panel right">
        <PlayerStatsBadge token={token} />
        <PlaySection isVisiting={false} onOpenPuzzles={onOpenPuzzles} onOpenMatchQueue={() => hub.setActiveOverlay("match-queue")} />
        <FriendsButton onClick={onOpenFriends} />
      </div>
      <div className="hub-room-wrap">
        <div
          className="hub-room"
          style={{
            width: HUB_COLS * TILE_SIZE,
            height: HUB_ROWS * TILE_SIZE + HEADROOM,
            backgroundImage: "url(/hub/Commons_revamped.jpg)",
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
              variant="door"
              onActivate={onReturnHome}
            />

            <InteractiveTrigger
              tile={LEADERBOARD_TILE}
              tileSize={TILE_SIZE}
              isNear={hub.isNearLeaderboard}
              label="Leaderboard"
              promptLabel="Click or press E"
              variant="leaderboard"
              icon={<LeaderboardProp />}
              onActivate={onOpenLeaderboard}
            />

            {/* No shop stall/entrance for now - COMMONS_SHOP_TILE,
                ShopWorld.jsx, and HeroChessApp's handleVisitShop are all
                still there and working, just not wired up from here
                until the shop area's ready to ship. */}

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
