import { Chess } from "chess.js";
import { ARCHER_COST, POINT_COSTS, POPE_COST } from "../pieces/flat2dPieces";

// Archer/Pope aren't directly draftable (they only ever come from evolving
// a Knight/Bishop), so they have their own cost constants instead of a
// POINT_COSTS entry - and their own art key (reusing the OLD Wizard/Archer
// skins - "W"/"A", not the "N"/"B" slot they're actually stored as, see
// flat2dPieces.jsx). Dragon IS directly draftable now, so it folds into the
// regular POINT_COSTS-based lookup below like every other letter. "kind"
// here is this module's own vocabulary: every letter POINT_COSTS already
// uses, plus these two synthetic ones.
const KIND_INFO = {
  Q: { icon: "Q", cost: POINT_COSTS.Q },
  R: { icon: "R", cost: POINT_COSTS.R },
  B: { icon: "B", cost: POINT_COSTS.B },
  N: { icon: "N", cost: POINT_COSTS.N },
  P: { icon: "P", cost: POINT_COSTS.P },
  D: { icon: "D", cost: POINT_COSTS.D },
  H: { icon: "H", cost: POINT_COSTS.H },
  C: { icon: "C", cost: POINT_COSTS.C },
  M: { icon: "M", cost: POINT_COSTS.M },
  ARCHER: { icon: "W", cost: ARCHER_COST },
  POPE: { icon: "A", cost: POPE_COST },
};

// chess.com-style captured-piece tray + material point difference. Computed
// entirely on the frontend by diffing the CURRENT army against the
// INITIAL drafted one (fen_history[0]/evolution_history[0]) - not by
// attributing captures move-by-move, which would need its own bookkeeping
// this app doesn't otherwise keep. Only ever reflects the LIVE position,
// even while reviewing move history (a reviewed position's own capture
// state isn't tracked separately - showing "what's been captured so far in
// the whole game" throughout review is a reasonable simplification).
//
// A hero piece's stored FEN type doesn't distinguish it from a plain piece
// of the same type (a Dragon is just a Rook in the FEN) - so the raw
// before/after piece-count diff alone can't tell "1 Rook captured" apart
// from "1 Dragon captured". The evolution snapshot's own before/after
// hero-square counts resolve that ambiguity: however many of a hero type
// disappeared is attributed to that hero first, and whatever's left of the
// stored-type's count diff is a plain capture of that type.

function countBaseTypes(fen, color) {
  const counts = { q: 0, r: 0, b: 0, n: 0, p: 0 };
  try {
    const board = new Chess(fen).board();
    for (const row of board) {
      for (const cell of row) {
        if (cell && cell.color === color && counts[cell.type] !== undefined) {
          counts[cell.type] += 1;
        }
      }
    }
  } catch {
    // Malformed FEN - just report an empty army rather than throwing.
  }
  return counts;
}

function heroCounts(snapshot, isWhite) {
  const prefix = isWhite ? "white_" : "black_";
  const s = snapshot || {};
  return {
    dragon: (s[`${prefix}dragon_squares`] || []).length,
    pope: s[`${prefix}pope_square`] ? 1 : 0,
    archer: s[`${prefix}archer_square`] ? 1 : 0,
    hydra: (s[`${prefix}hydra_squares`] || []).length,
    cyclops: (s[`${prefix}cyclops_squares`] || []).length,
    mirror: (s[`${prefix}mirror_squares`] || []).length,
  };
}

// Everything captured FROM one color's army (i.e. captured BY the other
// side) - a list of {letter, count} using the same hero-aware letters
// (D/H/C/M) DeckBuilder's own POINT_COSTS keys off, so cost lookup and
// piece art both stay consistent with the rest of the app.
function capturedFromArmy(initialFen, initialSnapshot, currentFen, currentSnapshot, isWhite) {
  const color = isWhite ? "w" : "b";
  const initialBase = countBaseTypes(initialFen, color);
  const currentBase = countBaseTypes(currentFen, color);
  const initialHero = heroCounts(initialSnapshot, isWhite);
  const currentHero = heroCounts(currentSnapshot, isWhite);

  const lost = (a, b) => Math.max(0, a - b);
  const capturedDragon = lost(initialHero.dragon, currentHero.dragon);
  const capturedPope = lost(initialHero.pope, currentHero.pope);
  const capturedArcher = lost(initialHero.archer, currentHero.archer);
  const capturedHydra = lost(initialHero.hydra, currentHero.hydra);
  const capturedCyclops = lost(initialHero.cyclops, currentHero.cyclops);
  const capturedMirror = lost(initialHero.mirror, currentHero.mirror);

  // Dragon -> Rook slot, Pope/Mirror -> Bishop slot, Archer/Hydra -> Knight
  // slot, Cyclops -> Pawn slot (see flat2dPieces.jsx's own comment on which
  // FEN type each hero piece is actually stored as).
  const capturedPlainR = Math.max(0, lost(initialBase.r, currentBase.r) - capturedDragon);
  const capturedPlainB = Math.max(0, lost(initialBase.b, currentBase.b) - capturedPope - capturedMirror);
  const capturedPlainN = Math.max(0, lost(initialBase.n, currentBase.n) - capturedArcher - capturedHydra);
  const capturedPlainP = Math.max(0, lost(initialBase.p, currentBase.p) - capturedCyclops);
  const capturedQ = lost(initialBase.q, currentBase.q);

  const entries = [
    { kind: "Q", count: capturedQ },
    { kind: "R", count: capturedPlainR },
    { kind: "B", count: capturedPlainB },
    { kind: "N", count: capturedPlainN },
    { kind: "P", count: capturedPlainP },
    { kind: "D", count: capturedDragon },
    { kind: "POPE", count: capturedPope },
    { kind: "ARCHER", count: capturedArcher },
    { kind: "H", count: capturedHydra },
    { kind: "C", count: capturedCyclops },
    { kind: "M", count: capturedMirror },
  ];
  return entries
    .filter((e) => e.count > 0)
    .map((e) => ({ ...e, icon: KIND_INFO[e.kind].icon, cost: KIND_INFO[e.kind].cost }));
}

function materialValue(entries) {
  return entries.reduce((sum, { cost, count }) => sum + cost * count, 0);
}

// Returns { whiteCaptured, blackCaptured, materialDiff } - whiteCaptured is
// what WHITE has taken from BLACK (i.e. missing from black's army), and
// vice versa; materialDiff is White's total minus Black's (positive =
// White ahead), matching chess.com's own "+N" convention.
export function computeCapturedMaterial(gameState) {
  const fenHistory = gameState.fen_history || [];
  const evolutionHistory = gameState.evolution_history || [];
  const initialFen = fenHistory[0] || gameState.fen;
  const initialSnapshot = evolutionHistory[0] || null;
  const currentFen = gameState.fen;
  const currentSnapshot = {
    white_dragon_squares: gameState.white_dragon_squares,
    black_dragon_squares: gameState.black_dragon_squares,
    white_pope_square: gameState.white_pope_square,
    black_pope_square: gameState.black_pope_square,
    white_archer_square: gameState.white_archer_square,
    black_archer_square: gameState.black_archer_square,
    white_hydra_squares: gameState.white_hydra_squares,
    black_hydra_squares: gameState.black_hydra_squares,
    white_cyclops_squares: gameState.white_cyclops_squares,
    black_cyclops_squares: gameState.black_cyclops_squares,
    white_mirror_squares: gameState.white_mirror_squares,
    black_mirror_squares: gameState.black_mirror_squares,
  };

  const whiteCaptured = capturedFromArmy(initialFen, initialSnapshot, currentFen, currentSnapshot, false);
  const blackCaptured = capturedFromArmy(initialFen, initialSnapshot, currentFen, currentSnapshot, true);
  const materialDiff = materialValue(whiteCaptured) - materialValue(blackCaptured);

  return { whiteCaptured, blackCaptured, materialDiff };
}
