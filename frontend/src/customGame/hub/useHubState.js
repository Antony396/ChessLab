import { useCallback, useEffect, useRef, useState } from "react";
import { useEquippedSkin, setEquippedSkin } from "../skinStore";
import { playHopSound } from "../sound";

// The room's tile grid - an enclosed space, Club Penguin-igloo scale rather
// than an open world, but sized to actually fill most of the screen.
// Coordinates are grid cells, not pixels; TILE_SIZE is exported alongside
// so the scene, the avatar, and the corner-blocking math below all agree on
// the same pixel size for a cell.
// 15x8 rather than square - this now matches the aspect ratio of the
// painted dorm-room background (see hubWorld.css/HubWorld.jsx), a wide oval
// rather than a near-circle.
export const HUB_COLS = 15;
export const HUB_ROWS = 8;
export const TILE_SIZE = 72;

// A single pedestal on the left side of the room - the one and only place
// to queue up for a game (drafting a deck and starting it, vs the computer
// or online, all happen in the same station) - interacted with from an
// adjacent tile (its own tile is unwalkable - see isBlocked below). x:2
// (rather than the very edge x:0) keeps it clearly inside the painted
// room's own floor/wall boundary instead of overlapping it - see
// hubWorld.css's .hub-room background-size:cover comment for how that
// boundary maps into this grid's pixel space.
export const PEDESTAL_TILE = { x: 2, y: 4 };
// The puzzle stand's pedestal - mirrored on the right side of the room,
// symmetric with PEDESTAL_TILE on the left, and interacted with the same
// way (see isBlocked below and HubWorld.jsx's InteractiveTrigger for it).
export const PUZZLE_PEDESTAL_TILE = { x: 12, y: 4 };
// The leaderboard signboard - free-standing on the floor in the open gap
// between the avatar's start spot and the bookshelf, right of center.
// Purely decorative for now (see HubWorld.jsx's LeaderboardProp), but
// still a real piece of furniture - it blocks its own tile like the
// pedestals do, just with no InteractiveTrigger wrapping it since there's
// nothing to activate yet.
export const LEADERBOARD_TILE = { x: 10, y: 2 };
// Bottom-center, lined up with the glowing entrance notch painted into the
// background art.
const AVATAR_START = { x: 7, y: 6 };

// The Commons - a single shared room every connected user can walk into
// together (see social_routes.py's COMMONS_DORM_ID), reached through the
// dorm's own door and left through a matching one back. Reuses this same
// grid (HUB_COLS/HUB_ROWS/TILE_SIZE, isInsideRoom's ellipse) rather than
// defining its own - see CommonsWorld.jsx for why: it's the same
// background-image-in-an-oval treatment as the dorm, just a different
// image and different furniture. EXIT_TILE lines up with the arched
// double doors painted at the top-center of commons.jpg; AVATAR_START
// spawns just in front of them, mirroring how the dorm's own AVATAR_START
// lines up with ITS entrance notch.
export const COMMONS_EXIT_TILE = { x: 7, y: 1 };
const COMMONS_AVATAR_START = { x: 7, y: 2 };
// A teleport point inside the Commons leading to the Shop (see
// SHOP_COUNTER_TILE/SHOP_EXIT_TILE below) - open floor, left of center, not
// aligned to any painted feature since commons.jpg predates this trigger.
export const COMMONS_SHOP_TILE = { x: 3, y: 4 };
// The dorm's own door, leading out to the Commons - positioned to match
// the painted door on the left wall of dorm-room.jpg.
export const DOOR_TILE = { x: 1, y: 2 };

// The Shop - a third room, reached from the Commons (see HeroChessApp.jsx's
// handleVisitShop/handleReturnToCommons) rather than from a player's own
// dorm, and - unlike the Commons - not a shared space: nobody else can ever
// be standing in it, so it needs no presence wiring, just the same
// walkable-room treatment as every other room here. Reuses this same grid
// (HUB_COLS/HUB_ROWS/TILE_SIZE, isInsideRoom's ellipse) for the same reason
// Commons does - see ShopWorld.jsx. SHOP_COUNTER_TILE lines up with the
// curtained counter stall painted at the top-center of shop_area.png;
// SHOP_EXIT_TILE/SHOP_AVATAR_START mirror COMMONS_EXIT_TILE/
// COMMONS_AVATAR_START's own bottom-of-room "the way back" shape, just
// flipped to the bottom edge since this scene has no painted door to align
// to - approximate placement, nudge once it's actually on screen.
export const SHOP_COUNTER_TILE = { x: 7, y: 2 };
export const SHOP_EXIT_TILE = { x: 7, y: 7 };
const SHOP_AVATAR_START = { x: 7, y: 6 };

// The room reads as round (igloo-inspired) by inscribing an ellipse in the
// tile grid and treating anything outside it as unwalkable - the actual
// movement grid stays plain rectangular coordinates underneath (no hex/
// polar math needed anywhere else), this just carves its corners off. The
// room's oval shape itself is just the painted background image; nothing
// here clips it, this only governs which tiles the avatar can stand on.
//
// The vertical numbers here are NOT just "inscribed in the grid's own
// bounding box" (that was the original approach, and it let players walk
// well past the actual painted floor - up into the back wall/banners,
// since the wall band eats a good third of the room image's height and
// the walkable area never accounted for it). Measured instead from the
// actual source art: sampled dorm-room.jpg and Commons_revamped.jpg
// pixel-by-pixel for where the wall-to-floor shadow seam falls, mapped
// through each image's own background-size: cover transform into this
// grid's coordinate space, then averaged (the two rooms' independently-
// measured floor tops landed within a few px of each other). The
// horizontal radius, on the other hand, stays fully inscribed - an
// initial attempt at tightening it too ended up excluding real floor
// near the pedestals on the sides (the floor is wider side-to-side than
// a single sampled row suggested), so only the vertical extent - where
// the wall band genuinely eats into the grid - is pulled in.
const ELLIPSE_CENTER = { x: (HUB_COLS * TILE_SIZE) / 2, y: 354 };
const ELLIPSE_RADII = { x: (HUB_COLS * TILE_SIZE) / 2, y: 195 };

export function isInsideRoom(tile) {
  const px = tile.x * TILE_SIZE + TILE_SIZE / 2;
  const py = tile.y * TILE_SIZE + TILE_SIZE / 2;
  const nx = (px - ELLIPSE_CENTER.x) / ELLIPSE_RADII.x;
  const ny = (py - ELLIPSE_CENTER.y) / ELLIPSE_RADII.y;
  return nx * nx + ny * ny <= 1;
}

const DIRECTION_OFFSETS = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

function tilesEqual(a, b) {
  return a.x === b.x && a.y === b.y;
}

// room is "dorm" (default), "commons", or "shop" - each has its own set of
// unwalkable prop tiles (see useHubState's own room param below).
function isBlocked(tile, room) {
  if (room === "commons") {
    return tilesEqual(tile, COMMONS_EXIT_TILE) || tilesEqual(tile, COMMONS_SHOP_TILE) || !isInsideRoom(tile);
  }
  if (room === "shop") {
    return tilesEqual(tile, SHOP_COUNTER_TILE) || tilesEqual(tile, SHOP_EXIT_TILE) || !isInsideRoom(tile);
  }
  return (
    tilesEqual(tile, PEDESTAL_TILE) ||
    tilesEqual(tile, PUZZLE_PEDESTAL_TILE) ||
    tilesEqual(tile, LEADERBOARD_TILE) ||
    tilesEqual(tile, DOOR_TILE) ||
    !isInsideRoom(tile)
  );
}

function inBounds(tile) {
  return tile.x >= 0 && tile.x < HUB_COLS && tile.y >= 0 && tile.y < HUB_ROWS;
}

function chebyshevDistance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// The Hub's state manager: player position/facing/skin, which overlay (if
// any) is currently open, and match-queue status. A plain hook rather than
// a Context - nothing outside HubWorld's own tree needs this state, so a
// Provider would just be ceremony.
//
// room ("dorm" | "commons" | "shop") - the SAME position/facing/step/walkTo
// state serves all three rather than each having its own hook instance,
// since switching between them is really just "which grid's blocked-tile
// rules and start position apply right now" (see isBlocked above) - the
// effect below resets position to the new room's own start the moment room
// changes, the same way arriving at a fresh location always would.
function startFor(room) {
  if (room === "commons") return COMMONS_AVATAR_START;
  if (room === "shop") return SHOP_AVATAR_START;
  return AVATAR_START;
}

export function useHubState(room = "dorm") {
  const [position, setPosition] = useState(startFor(room));
  const [facing, setFacing] = useState("down");
  const [isHopping, setIsHopping] = useState(false);
  // Shared with the deck builder and the game board (see skinStore.js) -
  // equipping a skin here is what makes it show up as your King everywhere
  // else too.
  const equippedSkin = useEquippedSkin();
  // null | "match-queue" - whether the (single) station overlay is open.
  const [activeOverlay, setActiveOverlay] = useState(null);
  // Purely cosmetic/status for now (no real matchmaking backend yet) - kept
  // here so the pedestal's UI has somewhere real to read/write from once
  // one exists, instead of bolting it on later.
  const [matchQueueStatus, setMatchQueueStatus] = useState("idle");

  const isNearPedestal = chebyshevDistance(position, PEDESTAL_TILE) <= 1;
  const isNearPuzzlePedestal = chebyshevDistance(position, PUZZLE_PEDESTAL_TILE) <= 1;
  const isNearLeaderboard = chebyshevDistance(position, LEADERBOARD_TILE) <= 1;
  const isNearDoor = chebyshevDistance(position, DOOR_TILE) <= 1;
  const isNearCommonsExit = chebyshevDistance(position, COMMONS_EXIT_TILE) <= 1;
  const isNearShopCounter = chebyshevDistance(position, SHOP_COUNTER_TILE) <= 1;
  const isNearShopExit = chebyshevDistance(position, SHOP_EXIT_TILE) <= 1;
  const isNearCommonsShop = chebyshevDistance(position, COMMONS_SHOP_TILE) <= 1;

  const hopDuration = 220; // ms - must match hubWorld.css's .avatar.hopping animation

  // A synchronous busy-guard, shared by keyboard steps and click-driven
  // walks, so the two input methods can never fight over the same avatar
  // mid-hop. A ref rather than state: it only needs to gate a plain JS
  // function call, never drive a render itself (isHopping state below does
  // that part, for the CSS animation).
  const busyRef = useRef(false);
  // Mirrors `position` for synchronous reads inside step()/walkTo() below -
  // see their own comments for why this can't just read `position` (the
  // state variable) or use setPosition's functional-updater form instead.
  const positionRef = useRef(position);
  // Click-to-move keeps its own interval/timeout alive across renders so a
  // second click can cancel an in-flight walk before starting a new one.
  const walkHandleRef = useRef(null);

  // Arriving in a (possibly new) room resets position to ITS start - runs
  // on mount too (a harmless no-op there, already the same value), and
  // again on every room switch (see this hook's own docstring above).
  // Also cancels any walk-in-progress from the room just left, same as a
  // fresh arrival anywhere should.
  useEffect(() => {
    walkHandleRef.current?.();
    const start = startFor(room);
    positionRef.current = start;
    setPosition(start);
    setFacing("down");
  }, [room]);

  const step = useCallback(
    (direction) => {
      if (busyRef.current) return; // ignore input mid-hop
      const { dx, dy } = DIRECTION_OFFSETS[direction];
      const prev = positionRef.current;
      const next = { x: prev.x + dx, y: prev.y + dy };
      setFacing(direction);
      // Deliberately NOT a setPosition(prev => ...) functional updater: React
      // 18 StrictMode invokes those twice in development to catch impure
      // ones, and this one used to set a "moved" flag as a side effect
      // inside it - the second (discarded) invocation's side effect could
      // clobber the first, silently skipping playHopSound() below even
      // though the position itself still committed correctly (from
      // whichever invocation React kept). Reading/writing positionRef here
      // instead means there's no updater function for React to double-
      // invoke - just a single, plain setPosition(next) value call.
      if (!inBounds(next) || isBlocked(next, room)) return; // walked into a wall/prop - no hop, no cooldown
      positionRef.current = next;
      setPosition(next);
      playHopSound();
      busyRef.current = true;
      setIsHopping(true);
      window.setTimeout(() => {
        busyRef.current = false;
        setIsHopping(false);
      }, hopDuration);
    },
    [hopDuration, room]
  );

  // Click-to-move: walks one tile at a time toward the target, Club
  // Penguin-style, reusing the same hop timing the avatar moves by. Stops
  // early if the path becomes blocked, and always clears its own interval
  // once it arrives (or gives up) rather than leaking a timer.
  const walkTo = useCallback(
    (target) => {
      walkHandleRef.current?.(); // cancel any walk already in progress
      let interval = null;
      let timeout = null;
      let cancelled = false;
      function stop() {
        if (cancelled) return;
        cancelled = true;
        busyRef.current = false;
        if (interval !== null) window.clearInterval(interval);
        if (timeout !== null) window.clearTimeout(timeout);
        setIsHopping(false);
        walkHandleRef.current = null;
      }
      function tick() {
        if (cancelled) return;
        // Same reasoning as step() above: no setPosition(prev => ...)
        // functional updater, since playHopSound() (and everything else
        // here) used to run INSIDE one - a real side effect, not just a
        // flag, so React double-invoking it in StrictMode used to play the
        // sound twice per step during a click-to-move walk.
        const prev = positionRef.current;
        if (tilesEqual(prev, target)) {
          stop();
          return;
        }
        const dx = target.x - prev.x;
        const dy = target.y - prev.y;
        // One axis at a time keeps this simple - no real pathfinding is
        // needed in a room this small and this empty of obstacles.
        const direction = dx !== 0 ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
        const { dx: sdx, dy: sdy } = DIRECTION_OFFSETS[direction];
        const next = { x: prev.x + sdx, y: prev.y + sdy };
        if (!inBounds(next) || isBlocked(next, room)) {
          stop();
          return;
        }
        setFacing(direction);
        playHopSound();
        busyRef.current = true;
        setIsHopping(true);
        positionRef.current = next;
        setPosition(next);
      }
      tick();
      // Guard against the immediate tick() above already having finished
      // the walk (e.g. the target was one step away) before this line runs.
      if (!cancelled) {
        interval = window.setInterval(tick, hopDuration + 40);
        // Upper bound so a stuck walk can never run forever, even though the
        // normal case is stop() firing first when the target is reached.
        timeout = window.setTimeout(stop, (HUB_COLS + HUB_ROWS) * (hopDuration + 40));
        walkHandleRef.current = stop;
      }
      return stop;
    },
    [hopDuration, room]
  );

  return {
    position,
    facing,
    isHopping,
    equippedSkin,
    setEquippedSkin,
    activeOverlay,
    setActiveOverlay,
    matchQueueStatus,
    setMatchQueueStatus,
    isNearPedestal,
    isNearPuzzlePedestal,
    isNearLeaderboard,
    isNearDoor,
    isNearCommonsExit,
    isNearShopCounter,
    isNearShopExit,
    isNearCommonsShop,
    step,
    walkTo,
  };
}
