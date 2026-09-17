import { useSyncExternalStore } from "react";
import { pieceImageSrc } from "../pieces/flat2dPieces";
import { postEquippedSkin } from "./social/api";

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
//
// requiresMapProgress (optional): a Puzzle Map progress-gated skin - the
// backend tracks each account's solved node count out of MAP_LENGTH (see
// app/puzzle_map/store.py / db.py's map_puzzle_progress table). The Regal
// King skin below is gated this way: reaching node 50 - the classic map's
// finale - unlocks it.
//
// requiresHeroMapProgress (optional): same idea, but for the newer Hero
// Puzzle Map (see app/hero_puzzle_map/store.py / db.py's
// hero_map_puzzle_progress table) - a separate hand-authored route built
// around the custom hero pieces. The Hydra skin below is gated this way.
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
    requiresMapProgress: 50,
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
    requiresHeroMapProgress: 50,
  },
  // cost: a Shop skin (see ShopPanel.jsx) - locked until purchased with
  // currency, tracked server-side in owned_skins (unlike every other gate
  // here, ownership isn't derivable from streak/map progress, so
  // isSkinUnlocked below also needs `ownedSkins` in `progress` for these).
  // The actual price charged always comes from the backend's own
  // SHOP_CATALOG (db.py) - this number is display-only and must be kept in
  // sync with it by hand.
  dragonKing: {
    name: "Dragon King",
    src: "/pieces/avatars/dragon-king.png",
    whiteTeamSrc: "/pieces/avatars/dragon-king-white.png",
    headSrc: "/pieces/avatars/dragon-king-head.png",
    cost: 150,
  },
  // A distinct second dark-armored look alongside the existing Dark
  // Knight, not a replacement for it.
  crimsonKnight: {
    name: "Crimson Knight",
    src: "/pieces/avatars/crimson-knight.png",
    whiteTeamSrc: "/pieces/avatars/crimson-knight-white.png",
    headSrc: "/pieces/avatars/crimson-knight-head.png",
    cost: 150,
  },
  // A third dark-armored look (glowing red eyes) - a distinct skin in its
  // own right, not a variant of Crimson Knight or the original Dark Knight.
  emberKnight: {
    name: "Ember Knight",
    src: "/pieces/avatars/ember-knight.png",
    whiteTeamSrc: "/pieces/avatars/ember-knight-white.png",
    headSrc: "/pieces/avatars/ember-knight-head.png",
    cost: 180,
  },
  // Dark navy plate under bronze/copper trim - dark enough to need its own
  // whiteTeamSrc recolor, like the others above.
  bronzeKing: {
    name: "Bronze King",
    src: "/pieces/avatars/bronze-king.png",
    whiteTeamSrc: "/pieces/avatars/bronze-king-white.png",
    headSrc: "/pieces/avatars/bronze-king-head.png",
    cost: 200,
  },
  // requiresLevel (optional, shop skins only): needs both the currency
  // AND this player level (see PlayerStatsBadge's own level readout) to
  // buy - checked alongside `cost` in isSkinUnlocked/ShopPanel.jsx, same
  // "locks by default if progress isn't known yet" rule as
  // requiresMapProgress above. The two "Ascendant" skins are the natural
  // fit for this - the name already implies levelling up to reach them.
  silverAscendant: {
    name: "Silver Ascendant",
    src: "/pieces/avatars/silver-ascendant.png",
    whiteTeamSrc: "/pieces/avatars/silver-ascendant-white.png",
    headSrc: "/pieces/avatars/silver-ascendant-head.png",
    cost: 250,
    requiresLevel: 5,
  },
  goldenAscendant: {
    name: "Golden Ascendant",
    src: "/pieces/avatars/golden-ascendant.png",
    whiteTeamSrc: "/pieces/avatars/golden-ascendant-white.png",
    headSrc: "/pieces/avatars/golden-ascendant-head.png",
    cost: 300,
    requiresLevel: 10,
  },
  // Dark charcoal armor under a green cape/gem accents, so - like Dark
  // Knight/Hydra - whiteTeamSrc is a separate recolor (charcoal plate ->
  // cream, green cape/gems and black linework untouched).
  emeraldWarden: {
    name: "Emerald Warden",
    src: "/pieces/avatars/emerald-warden.png",
    whiteTeamSrc: "/pieces/avatars/emerald-warden-white.png",
    headSrc: "/pieces/avatars/emerald-warden-head.png",
    cost: 220,
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

// `progress` is optional - callers with no progress info yet (or an
// anonymous/not-yet-fetched context) can omit any field, which locks every
// gated skin by default rather than guessing it's unlocked. `ownedSkins`
// gates any skin with a `cost` (see ShopPanel.jsx) - unlike streak/map
// progress, ownership can only ever be "yes" or "no", fetched from
// /api/social/shop/state.
export function isSkinUnlocked(key, progress = {}) {
  const skin = KING_SKINS[key];
  if (!skin) return false;
  const { streak = 0, mapSolved = 0, heroMapSolved = 0, level = 0, ownedSkins = [] } = progress;
  if (skin.requiresStreak && streak < skin.requiresStreak) return false;
  if (skin.requiresMapProgress && mapSolved < skin.requiresMapProgress) return false;
  if (skin.requiresHeroMapProgress && heroMapSolved < skin.requiresHeroMapProgress) return false;
  if (skin.requiresLevel && level < skin.requiresLevel) return false;
  if (skin.cost && !ownedSkins.includes(key)) return false;
  return true;
}

// `token`, when given, also persists the choice server-side (see
// social/api.js's postEquippedSkin / db.py's equipped_skin column) - the
// one thing localStorage alone can never do, since it can't answer "what
// does this OTHER account have on" for the leaderboard or a dorm/Commons
// visit. Fire-and-forget: a failed persist just means other viewers see a
// stale skin until the next successful equip, not a broken local UX, so
// it's not awaited and its error is swallowed rather than surfaced here.
export function setEquippedSkin(key, progress = {}, token = null) {
  if (!KING_SKINS[key] || key === equippedSkin) return;
  if (!isSkinUnlocked(key, progress)) return;
  equippedSkin = key;
  try {
    localStorage.setItem(STORAGE_KEY, key);
  } catch {
    // fine to just not persist it
  }
  if (token) {
    postEquippedSkin(token, key).catch(() => {
      // Not fatal - see this function's own comment above.
    });
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
