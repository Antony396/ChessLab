import { forwardRef, useEffect, useRef, useState } from "react";
import AvatarController from "./AvatarController";
import InteractiveTrigger from "./InteractiveTrigger";
import { HUB_COLS, HUB_ROWS, TILE_SIZE, PEDESTAL_TILE, PUZZLE_PEDESTAL_TILE, LEADERBOARD_TILE, isInsideRoom } from "./useHubState";
import { KING_SKINS, useEquippedSkin } from "../skinStore";
import { CHAT_BUBBLE_DURATION_MS } from "../social/usePresence";
import SpeechBubble from "./SpeechBubble";
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
function RemoteAvatar({ occupant, bubbleText }) {
  const skin = KING_SKINS[occupant.skin] || KING_SKINS.classic;
  const style = { transform: `translate(${occupant.x * TILE_SIZE}px, ${occupant.y * TILE_SIZE}px)` };
  return (
    <div className={`hub-avatar facing-${occupant.facing || "down"} remote`} style={style}>
      {bubbleText && <SpeechBubble text={bubbleText} />}
      <img src={skin.src} alt="" className="hub-avatar-img" draggable={false} />
      <div className="hub-avatar-shadow" />
      <span className="hub-avatar-nameplate">{occupant.username}</span>
    </div>
  );
}

// The always-visible chat input, docked to the bottom of the room. Enter
// sends (and clears the field) while focused; pressing Enter ANYWHERE ELSE
// in the hub focuses it instead (see HubWorld's own window-level listener
// below), game-chat-convention style. Escape blurs without sending.
// Movement's own keydown listeners (AvatarController's WASD/arrows, and the
// "E to interact" one below) already skip acting while an <input>/
// <textarea> has focus, so typing here never also walks the avatar around
// or opens the pedestal overlay.
const ChatBar = forwardRef(function ChatBar({ onSend }, ref) {
  const [value, setValue] = useState("");

  function handleKeyDown(e) {
    if (e.key === "Enter") {
      const text = value.trim();
      if (text) onSend(text);
      setValue("");
    } else if (e.key === "Escape") {
      e.currentTarget.blur();
    }
  }

  return (
    <input
      ref={ref}
      type="text"
      className="hub-chat-input"
      placeholder="Say something… (Enter to send)"
      value={value}
      maxLength={200}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
    />
  );
});

// Extra space above row 0 so a tall avatar/prop sprite's head has room to
// stick up past the top of its own tile without being clipped by the
// room's overflow:hidden edge - a standing character is taller than the
// footprint tile it stands on.
const HEADROOM = 40;

// Purely decorative - a signboard standing on the floor near the back of
// the room, between the two pedestals (see useHubState.js's
// LEADERBOARD_TILE). Not an InteractiveTrigger: no proximity glow, no
// click handler - just art anchored to the bottom of its tile (like the
// pedestals below) so it reads as real furniture rather than a wall decal.
function LeaderboardProp() {
  return (
    <div
      className="leaderboard-prop"
      style={{ transform: `translate(${LEADERBOARD_TILE.x * TILE_SIZE}px, ${LEADERBOARD_TILE.y * TILE_SIZE}px)` }}
      aria-hidden="true"
    >
      <img src="/pieces/props/leaderboard.png" alt="" className="leaderboard-prop-img" draggable={false} />
    </div>
  );
}

// A proper standing pedestal - a chess table with a drafted-army board set
// on top, matching the room's navy-and-gold theme - rather than a small
// icon, so it actually reads as a piece of furniture in the room, not a
// button. There is exactly one of these in the room, set against the
// far-left wall.
function PedestalProp() {
  return (
    <div className="pedestal-prop">
      <div className="pedestal-glow" aria-hidden="true" />
      <img src="/pieces/props/pvp-pedestal.png" alt="" className="pedestal-prop-img" draggable={false} />
    </div>
  );
}

// The Puzzle Rush counterpart, mirrored on the right side of the room -
// same treatment as PedestalProp (real furniture, not an icon-in-a-box).
function PuzzlePedestalProp() {
  return (
    <div className="puzzle-pedestal-prop">
      <div className="puzzle-pedestal-glow" aria-hidden="true" />
      <img src="/pieces/props/puzzle-pedestal.png" alt="" className="puzzle-pedestal-prop-img" draggable={false} />
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
// is - see its comment above). Opens the shared station-overlay chrome
// (see HeroChessApp.jsx's SkinsPanel branch) rather than its own inline
// dropdown - a proper gallery to browse/compare skins in, not a cramped list.
function SkinButton({ onClick }) {
  const equipped = useEquippedSkin();
  return (
    <div className="hub-skin-picker">
      <button type="button" className="hub-skin-toggle" onClick={onClick} title="Change King skin">
        <img src={KING_SKINS[equipped].src} alt="" className="hub-skin-toggle-img" />
        <span>Skin</span>
      </button>
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

function PuzzleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9a2 2 0 0 1 2-2h1.2a1.8 1.8 0 1 0 0-3.4V3a2 2 0 0 1 2-2h1.6a2 2 0 0 1 2 2v.6a1.8 1.8 0 1 0 0 3.4H14a2 2 0 0 1 2 2v1.2a1.8 1.8 0 1 1 0 3.6V11" />
      <path d="M4 9v6a2 2 0 0 0 2 2h1.2a1.8 1.8 0 1 1 0 3.4V21a2 2 0 0 0 2 2h1.6a2 2 0 0 0 2-2v-.6a1.8 1.8 0 1 1 3.4 0 2 2 0 0 0 2-2v-4" />
    </svg>
  );
}

function PuzzleRushButton({ onClick }) {
  return (
    <button type="button" className="hub-friends-toggle" onClick={onClick} title="Puzzle Rush">
      <PuzzleIcon />
      <span>Puzzles</span>
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
export default function HubWorld({ hub, username, presence, visiting, onReturnHome, onOpenFriends, onOpenPuzzleRush, onOpenSkins, onLogout }) {
  const equippedSkin = useEquippedSkin();
  const skin = KING_SKINS[equippedSkin];
  const isVisiting = Boolean(visiting);
  // My own chat bubble - never comes back over the wire (presence_ws never
  // echoes a sender's own message), so it's shown locally the instant I
  // send it, same pattern as my own avatar's movement.
  const [myBubble, setMyBubble] = useState(null); // {text, key} | null
  const myBubbleTimerRef = useRef(null);
  const chatInputRef = useRef(null);

  // Press Enter anywhere in the hub (not just while the chat box already
  // has focus) to jump into it - standard game-chat convention. Skipped
  // when some OTHER input/textarea already has focus (that keystroke is
  // meant for it, not for stealing focus into chat), and when the chat box
  // itself already has focus (its own handler below sends instead).
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

  // "E to interact" - the keyboard-native counterpart to clicking a
  // pedestal directly, active only while standing next to one (and, for
  // the PvP pedestal, only in your own dorm - see VisitingBanner above;
  // the Puzzle Rush pedestal has no such ambiguity, so it works while
  // visiting too, same as the side-panel Puzzles button). Skipped while
  // the chat input (or any other input/textarea) has focus, so typing the
  // letter "e" in a message never also pops an overlay open.
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key.toLowerCase() !== "e") return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!isVisiting && hub.isNearPedestal) hub.setActiveOverlay("match-queue");
      else if (hub.isNearPuzzlePedestal) onOpenPuzzleRush();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hub.isNearPedestal, hub.isNearPuzzlePedestal, hub.setActiveOverlay, isVisiting, onOpenPuzzleRush]);

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
        <SkinButton onClick={onOpenSkins} />
        <FriendsButton onClick={onOpenFriends} />
        <PuzzleRushButton onClick={onOpenPuzzleRush} />
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

            <InteractiveTrigger
              tile={PUZZLE_PEDESTAL_TILE}
              tileSize={TILE_SIZE}
              isNear={hub.isNearPuzzlePedestal}
              label="Puzzle Rush"
              promptLabel="Click or press E"
              variant="puzzle-pedestal"
              icon={<PuzzlePedestalProp />}
              onActivate={onOpenPuzzleRush}
            />

            <LeaderboardProp />

            {presence?.occupants.map((occupant) => (
              <RemoteAvatar
                key={occupant.user_id}
                occupant={occupant}
                bubbleText={presence.chatBubbles[occupant.user_id]?.text}
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
          Move with <strong>WASD</strong> or the arrow keys, or click a tile to walk there.{" "}
          {isVisiting
            ? "This is someone else's dorm - just visiting."
            : "Approach a pedestal to draft your deck and start a game, or the puzzle stand for Puzzle Rush."}
        </p>
      </div>
    </>
  );
}
