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

export function setEquippedSkin(key) {
  if (!KING_SKINS[key] || key === equippedSkin) return;
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
