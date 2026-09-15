import { useSyncExternalStore } from "react";
import { pieceImageSrc } from "../pieces/flat2dPieces";

// Cosmetic King skins - shared by the hub avatar, the deck builder's King
// card/slot, and the actual game board. One registry, one source of truth:
// every consumer reads a skin's art through here rather than hardcoding an
// image path, so adding a new (purchasable/unlockable) skin later is just
// another entry, and it's automatically available everywhere at once.
//
// `src` is the skin's normal/default look - used wherever there's no real
// chess-team context (the hub avatar, the skin picker, the profile
// picture). `whiteTeamSrc` is a recolored-to-white variant, used wherever
// the skin is actually standing in for White's King in a real game (and in
// the deck builder, which always displays pieces in their White coloring
// by convention regardless of which side you're drafting). For "Classic"
// the two are the same image, since that art is already white/cream; for
// "Dark Knight" whiteTeamSrc is a separate asset with its armor recolored
// from dark gray to cream while keeping the black linework and red accents
// untouched (see frontend/public/pieces/avatars/dark-knight-white.png).
//
// headSrc is a pre-cropped, pre-centered image of just the skin's
// head/crown (see frontend/public/pieces/avatars/*-head.png) - used by the
// profile picture badge, so it doesn't have to guess a crop from the
// full-body/full-piece art at render time.
//
// requiresStreak (optional): a Daily Puzzle streak-gated skin - the
// backend tracks each account's current daily-puzzle streak (see
// app/db.py's daily_puzzle_streaks table / STREAK_UNLOCK_SKIN_DAYS), and
// SkinsPanel.jsx checks it against this before letting the skin be
// equipped, showing a lock + "solve N days in a row" message otherwise.
// No entry actually sets this yet - it's foundation for whenever a
// streak-reward skin's art exists; isSkinUnlocked below is what any new
// entry should be checked against, not this field directly.
export const KING_SKINS = {
  classic: {
    name: "Classic King",
    src: pieceImageSrc("wK"),
    whiteTeamSrc: pieceImageSrc("wK"),
    headSrc: "/pieces/avatars/classic-king-head.png",
  },
  darkKnight: {
    name: "Dark Knight",
    src: "/pieces/avatars/dark-knight.png",
    whiteTeamSrc: "/pieces/avatars/dark-knight-white.png",
    headSrc: "/pieces/avatars/dark-knight-head.png",
  },
  blackKing: {
    name: "Black King",
    src: pieceImageSrc("bK"),
    whiteTeamSrc: pieceImageSrc("wK"),
    headSrc: "/pieces/avatars/black-king-head.png",
  },
  // The same Dark Knight bust, but always in its recolored-to-white form -
  // a distinct standalone choice for someone who wants that look
  // permanently rather than only when actually playing White.
  whiteDarkKnight: {
    name: "White Dark Knight",
    src: "/pieces/avatars/dark-knight-white.png",
    whiteTeamSrc: "/pieces/avatars/dark-knight-white.png",
    headSrc: "/pieces/avatars/dark-knight-white-head.png",
  },
  // Already cream/light-armored art (only the cape/trim color differs), so
  // - same as Classic - src doubles as whiteTeamSrc directly.
  royal: {
    name: "Royal King",
    src: "/pieces/avatars/royal-king.png",
    whiteTeamSrc: "/pieces/avatars/royal-king.png",
    headSrc: "/pieces/avatars/royal-king-head.png",
  },
  regal: {
    name: "Regal King",
    src: "/pieces/avatars/regal-king.png",
    whiteTeamSrc: "/pieces/avatars/regal-king.png",
    headSrc: "/pieces/avatars/regal-king-head.png",
  },
  sovereign: {
    name: "Sovereign King",
    src: "/pieces/avatars/sovereign-king.png",
    whiteTeamSrc: "/pieces/avatars/sovereign-king.png",
    headSrc: "/pieces/avatars/sovereign-king-head.png",
  },
  // Dark-armored, so - like Dark Knight - whiteTeamSrc is a separate
  // recolored-to-cream asset (armor plate recolored, black linework and
  // the green cape/accent color untouched).
  hydra: {
    name: "Threefold King",
    src: "/pieces/avatars/hydra-king.png",
    whiteTeamSrc: "/pieces/avatars/hydra-king-white.png",
    headSrc: "/pieces/avatars/hydra-king-head.png",
  },
  dragonKing: {
    name: "Dragon King",
    src: "/pieces/avatars/dragon-king.png",
    whiteTeamSrc: "/pieces/avatars/dragon-king-white.png",
    headSrc: "/pieces/avatars/dragon-king-head.png",
  },
  // A distinct second dark-armored look alongside the existing Dark
  // Knight, not a replacement for it.
  crimsonKnight: {
    name: "Crimson Knight",
    src: "/pieces/avatars/crimson-knight.png",
    whiteTeamSrc: "/pieces/avatars/crimson-knight-white.png",
    headSrc: "/pieces/avatars/crimson-knight-head.png",
  },
  // A third dark-armored look (glowing red eyes) - a distinct skin in its
  // own right, not a variant of Crimson Knight or the original Dark Knight.
  emberKnight: {
    name: "Ember Knight",
    src: "/pieces/avatars/ember-knight.png",
    whiteTeamSrc: "/pieces/avatars/ember-knight-white.png",
    headSrc: "/pieces/avatars/ember-knight-head.png",
  },
  // Dark navy plate under bronze/copper trim - dark enough to need its own
  // whiteTeamSrc recolor, like the others above.
  bronzeKing: {
    name: "Bronze King",
    src: "/pieces/avatars/bronze-king.png",
    whiteTeamSrc: "/pieces/avatars/bronze-king-white.png",
    headSrc: "/pieces/avatars/bronze-king-head.png",
  },
  silverAscendant: {
    name: "Silver Ascendant",
    src: "/pieces/avatars/silver-ascendant.png",
    whiteTeamSrc: "/pieces/avatars/silver-ascendant-white.png",
    headSrc: "/pieces/avatars/silver-ascendant-head.png",
  },
  goldenAscendant: {
    name: "Golden Ascendant",
    src: "/pieces/avatars/golden-ascendant.png",
    whiteTeamSrc: "/pieces/avatars/golden-ascendant-white.png",
    headSrc: "/pieces/avatars/golden-ascendant-head.png",
  },
};
const DEFAULT_SKIN = "classic";
const STORAGE_KEY = "evoChessEquippedSkin";

function loadInitial() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && KING_SKINS[stored]) return stored;
  } catch {
    // private browsing / storage disabled - just fall back to the default
  }
  return DEFAULT_SKIN;
}

let equippedSkin = loadInitial();
const listeners = new Set();

export function getEquippedSkin() {
  return equippedSkin;
}

// currentStreak is optional - callers with no streak info yet (or an
// anonymous/not-yet-fetched context) can omit it, which locks every
// requiresStreak skin by default rather than guessing they're unlocked.
export function isSkinUnlocked(key, currentStreak = 0) {
  const skin = KING_SKINS[key];
  if (!skin) return false;
  return !skin.requiresStreak || currentStreak >= skin.requiresStreak;
}

export function setEquippedSkin(key, currentStreak = 0) {
  if (!KING_SKINS[key] || key === equippedSkin) return;
  if (!isSkinUnlocked(key, currentStreak)) return;
  equippedSkin = key;
  try {
    localStorage.setItem(STORAGE_KEY, key);
  } catch {
    // fine to just not persist it
  }
  listeners.forEach((notify) => notify());
}

function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

// A plain module-level store (not React state) so the hub, the deck
// builder, and the game board - three totally separate component trees,
// none of which is an ancestor of the others - can all read and react to
// the same equipped skin without threading it through a shared parent.
// useSyncExternalStore is exactly the API this shape of problem calls for.
export function useEquippedSkin() {
  return useSyncExternalStore(subscribe, getEquippedSkin);
}
