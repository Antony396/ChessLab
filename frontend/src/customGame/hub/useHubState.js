import { useCallback, useRef, useState } from "react";
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
// Bottom-center, lined up with the glowing entrance notch painted into the
// background art.
const AVATAR_START = { x: 7, y: 6 };

// The room reads as round (igloo-inspired) by inscribing an ellipse in the
// tile grid's bounding box and treating anything outside it as unwalkable -
// the actual movement grid stays plain rectangular coordinates underneath
// (no hex/polar math needed anywhere else), this just carves its corners
// off. hubWorld.css clips the room's own visuals to the matching ellipse.
const ELLIPSE_CENTER = { x: (HUB_COLS * TILE_SIZE) / 2, y: (HUB_ROWS * TILE_SIZE) / 2 };
const ELLIPSE_RADII = { x: (HUB_COLS * TILE_SIZE) / 2, y: (HUB_ROWS * TILE_SIZE) / 2 };

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

function isBlocked(tile) {
  return tilesEqual(tile, PEDESTAL_TILE) || !isInsideRoom(tile);
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
export function useHubState() {
  const [position, setPosition] = useState(AVATAR_START);
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
  const positionRef = useRef(AVATAR_START);
  // Click-to-move keeps its own interval/timeout alive across renders so a
  // second click can cancel an in-flight walk before starting a new one.
  const walkHandleRef = useRef(null);

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
      if (!inBounds(next) || isBlocked(next)) return; // walked into a wall/prop - no hop, no cooldown
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
    [hopDuration]
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
        if (!inBounds(next) || isBlocked(next)) {
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
    [hopDuration]
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
    step,
    walkTo,
  };
}
