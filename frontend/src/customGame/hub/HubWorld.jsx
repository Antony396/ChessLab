import { forwardRef, useEffect, useRef, useState } from "react";
import AvatarController from "./AvatarController";
import InteractiveTrigger from "./InteractiveTrigger";
import {
  HUB_COLS,
  HUB_ROWS,
  TILE_SIZE,
  PEDESTAL_TILE,
  PUZZLE_PEDESTAL_TILE,
  DOOR_TILE,
  isInsideRoom,
} from "./useHubState";
import { KING_SKINS, useEquippedSkin } from "../skinStore";
import { CHAT_BUBBLE_DURATION_MS } from "../social/usePresence";
import { sendFriendRequest, fetchMe, fetchBattlePassState } from "../social/api";
import { pieceImageSrc } from "../../pieces/flat2dPieces";
import SpeechBubble from "./SpeechBubble";
import "./hubWorld.css";

// A read-only avatar for someone else currently in this dorm - no input
// handling, no click-to-move, just rendered at their last-known position
// (see social/usePresence.js). Exported for CommonsWorld.jsx to reuse -
// occupant rendering is identical there, just a different shared room.
//
// Clicking it sends a friend request (token/myUserId are optional - a
// caller with neither just gets the old read-only behavior back). A bot
// (see social/bots.py) has no real account row to friend at all, and
// clicking yourself makes no sense either, so both are excluded up front
// rather than letting the request round-trip just to 404/400.
export function RemoteAvatar({ occupant, bubbleText, token, myUserId }) {
  const skin = KING_SKINS[occupant.skin] || KING_SKINS.classic;
  const style = { transform: `translate(${occupant.x * TILE_SIZE}px, ${occupant.y * TILE_SIZE}px)` };
  const [friendStatus, setFriendStatus] = useState("idle"); // "idle" | "sending" | "sent" | "error"
  const isBot = occupant.user_id?.startsWith("bot-");
  const isSelf = occupant.user_id === myUserId;
  const canAddFriend = Boolean(token) && !isBot && !isSelf;

  function handleClick() {
    if (!canAddFriend || friendStatus !== "idle") return;
    setFriendStatus("sending");
    sendFriendRequest(token, occupant.user_id)
      .then(() => setFriendStatus("sent"))
      .catch(() => setFriendStatus("error"))
      .finally(() => {
        window.setTimeout(() => setFriendStatus("idle"), 2200);
      });
  }

  return (
    <div
      className={`hub-avatar facing-${occupant.facing || "down"} remote${canAddFriend ? " addable" : ""}`}
      style={style}
      onClick={canAddFriend ? handleClick : undefined}
      role={canAddFriend ? "button" : undefined}
      title={canAddFriend ? `Click to add ${occupant.username} as a friend` : undefined}
    >
      {bubbleText && <SpeechBubble text={bubbleText} />}
      <img src={skin.src} alt="" className="hub-avatar-img" draggable={false} />
      <div className="hub-avatar-shadow" />
      <span className="hub-avatar-nameplate">{occupant.username}</span>
      {friendStatus === "sent" && <span className="hub-avatar-friend-toast">Friend request sent</span>}
      {friendStatus === "error" && <span className="hub-avatar-friend-toast error">Couldn't add friend</span>}
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
// or opens the pedestal overlay. Exported for CommonsWorld.jsx to reuse.
export const ChatBar = forwardRef(function ChatBar({ onSend }, ref) {
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
// footprint tile it stands on. Exported for CommonsWorld.jsx to reuse -
// same grid, same avatar, same headroom need.
export const HEADROOM = 40;

// A signboard standing on the floor near the back of the room, between the
// two pedestals (see useHubState.js's LEADERBOARD_TILE) - now a real
// InteractiveTrigger showing top ELO standings, same treatment as the
// pedestals below (proximity glow, "press E" prompt, click-to-activate).
export function LeaderboardProp() {
  return (
    <div className="leaderboard-prop">
      <div className="leaderboard-glow" aria-hidden="true" />
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

// The puzzle stand's own pedestal, mirrored on the right side of the room -
// same treatment as PedestalProp (real furniture, not an icon-in-a-box).
// Opens the choice between the Puzzle Map and the Hero Puzzle Map.
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
// Exported for CommonsWorld.jsx to reuse - your own profile picture and
// skin picker shouldn't disappear just because you walked into a shared
// room that owns no stations of its own.
// `token` is unused now that the level pill's gone (see below) but kept
// in the signature - both call sites already pass it, and PlayerStatsBadge
// (right sidebar) is the one real place level lives now, not duplicated
// here too.
export function PlayerProfileBadge({ username }) {
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
// dropdown - a proper gallery to browse/compare skins in, not a cramped
// list. Exported for CommonsWorld.jsx to reuse - see PlayerProfileBadge's
// own comment on why.
export function SkinButton({ onClick }) {
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

export function FriendsButton({ onClick }) {
  return (
    <button type="button" className="hub-friends-toggle" onClick={onClick} title="Friends">
      <span>Friends</span>
    </button>
  );
}

function ShopButton({ onClick }) {
  return (
    <button type="button" className="hub-shop-toggle" onClick={onClick} title="Shop">
      <span>Shop</span>
    </button>
  );
}

function BattlePassButton({ onClick }) {
  return (
    <button type="button" className="hub-battlepass-toggle" onClick={onClick} title="Battle Pass">
      <span>Pass</span>
    </button>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

// Right-sidebar "Play" entry - an expandable group rather than a single
// button, since it now covers all three ways to start something (Puzzles,
// Online, Computer) instead of jumping straight to the deck-builder
// overlay. Online and Computer both still land on that same overlay
// (hub.setActiveOverlay("match-queue")) since the deck has to be built/
// picked there either way - there's no separate "online-only" or
// "computer-only" screen to pre-navigate to, this just groups the three
// destinations under one heading instead of three loose sidebar buttons.
// Online/Computer hidden while isVisiting for the same reason the
// pedestal itself is hidden then (see the "E to interact" effect's own
// comment above); Puzzles stays available, same as the puzzle pedestal.
export function PlaySection({ isVisiting, onOpenPuzzles, onOpenMatchQueue }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="hub-play-section">
      <button
        type="button"
        className="hub-play-toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        title="Play"
      >
        <span>Play</span>
        <span className={`hub-play-chevron${expanded ? " open" : ""}`}>
          <ChevronIcon />
        </span>
      </button>
      {expanded && (
        <div className="hub-play-submenu">
          <button type="button" className="hub-play-subitem" onClick={onOpenPuzzles}>
            <span>Puzzles</span>
          </button>
          {!isVisiting && (
            <>
              <button type="button" className="hub-play-subitem" onClick={onOpenMatchQueue}>
                <span>Online</span>
              </button>
              <button type="button" className="hub-play-subitem" onClick={onOpenMatchQueue}>
                <span>Computer</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// A solid-gold silhouette of the actual pawn art (same wP.png every deck
// card/board uses), not a coin - masked rather than recolored via filter
// so it comes out a clean flat gold instead of a sepia-tinted cream.
export function GoldPawnIcon() {
  const src = pieceImageSrc("wP");
  return (
    <span
      className="hub-gold-pawn-icon"
      style={{ WebkitMaskImage: `url(${src})`, maskImage: `url(${src})` }}
    />
  );
}

// Level (+ progress toward the next one) and currency readout for the
// right sidebar - a second at-a-glance spot for the same stats
// PlayerProfileBadge's level pill already shows on the left, so they're
// visible without opening the Shop/Battle Pass. The progress fraction
// reuses the Battle Pass endpoint's own xp_into_level/xp_for_next_level
// rather than re-deriving the level curve client-side. Own fetch calls
// rather than threading down from a parent, same reasoning as
// PlayerProfileBadge's own (nothing upstream already has this data).
export function PlayerStatsBadge({ token }) {
  const [stats, setStats] = useState(null); // {level, currency, xpInto, xpForNext} | null
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    Promise.all([fetchMe(token), fetchBattlePassState(token)])
      .then(([me, bp]) => {
        if (!cancelled) {
          setStats({ level: bp.level, currency: me.currency, xpInto: bp.xp_into_level, xpForNext: bp.xp_for_next_level });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!stats) return null;
  const progress = stats.xpForNext > 0 ? Math.min(1, stats.xpInto / stats.xpForNext) : 0;

  return (
    <div className="hub-player-stats">
      <span className="hub-stat-level" title={`Level ${stats.level} - ${stats.xpInto}/${stats.xpForNext} XP`}>
        <span className="hub-stat-level-label">LV {stats.level}</span>
        <span className="hub-stat-level-bar">
          <span className="hub-stat-level-bar-fill" style={{ width: `${progress * 100}%` }} />
        </span>
      </span>
      <span className="hub-stat-currency" title={`${stats.currency} currency`}>
        <GoldPawnIcon />
        {stats.currency}
      </span>
    </div>
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
export default function HubWorld({
  hub,
  username,
  token,
  myUserId,
  presence,
  visiting,
  onReturnHome,
  onOpenFriends,
  onOpenPuzzles,
  onOpenSkins,
  onOpenShop,
  onOpenBattlePass,
  onOpenCommons,
  onLogout,
}) {
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
  // the puzzle pedestal and the leaderboard have no such ambiguity, so
  // they work while visiting too, same as the side-panel Puzzles button).
  // Skipped while the chat input (or any other input/textarea) has focus,
  // so typing the letter "e" in a message never also pops an overlay open.
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key.toLowerCase() !== "e") return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!isVisiting && hub.isNearPedestal) hub.setActiveOverlay("match-queue");
      else if (hub.isNearPuzzlePedestal) onOpenPuzzles();
      else if (!isVisiting && hub.isNearDoor) onOpenCommons();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    hub.isNearPedestal,
    hub.isNearPuzzlePedestal,
    hub.isNearDoor,
    hub.setActiveOverlay,
    isVisiting,
    onOpenPuzzles,
    onOpenCommons,
  ]);

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
      <div className="hub-side-panel left">
        <PlayerProfileBadge username={username} />
        <SkinButton onClick={onOpenSkins} />
        <ShopButton onClick={onOpenShop} />
        <BattlePassButton onClick={onOpenBattlePass} />
        <LogoutButton onClick={onLogout} />
      </div>
      <div className="hub-side-panel right">
        <PlayerStatsBadge token={token} />
        <PlaySection
          isVisiting={isVisiting}
          onOpenPuzzles={onOpenPuzzles}
          onOpenMatchQueue={() => hub.setActiveOverlay("match-queue")}
        />
        <FriendsButton onClick={onOpenFriends} />
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

            {!isVisiting && (
              <InteractiveTrigger
                tile={DOOR_TILE}
                tileSize={TILE_SIZE}
                isNear={hub.isNearDoor}
                label="Commons"
                promptLabel="Click or press E"
                variant="door"
                onActivate={onOpenCommons}
              />
            )}

            <InteractiveTrigger
              tile={PUZZLE_PEDESTAL_TILE}
              tileSize={TILE_SIZE}
              isNear={hub.isNearPuzzlePedestal}
              label="Puzzles"
              promptLabel="Click or press E"
              variant="puzzle-pedestal"
              icon={<PuzzlePedestalProp />}
              onActivate={onOpenPuzzles}
            />

            {/* No leaderboard station here anymore - it's a genuinely
                shared/global thing (everyone's standings, not "whose
                room"), so it lives in the Commons now (see
                CommonsWorld.jsx) instead of duplicating it in every
                private dorm. LeaderboardProp/LEADERBOARD_TILE are still
                exported/defined above for that reuse. */}

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
          Move with <strong>WASD</strong> or the arrow keys, or click a tile to walk there.{" "}
          {isVisiting
            ? "This is someone else's dorm - just visiting."
            : "Approach a pedestal to draft your deck and start a game, or the puzzle stand for the Puzzle Map and Hero Puzzles."}
        </p>
      </div>
    </>
  );
}
