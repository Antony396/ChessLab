import { Chess } from "chess.js";

// Legal-destination hints for the board's drag-start highlight. chess.js
// only understands the piece actually encoded in the FEN, which is correct
// for normal pieces and for a Dragon's rook-mode travel (it's stored as a
// Rook), but knows nothing about their extra movement mode, or about the
// Pope's king-step-only movement, the Archer's king-step relocate and
// knight's-move shoot, or a Pawn boosted by a nearby Pope's aura - those are
// layered on top here, mirroring backend/app/custom_chess/rules.py and
// api/custom_game_routes.py's candidate-generation so the hints match what
// the server will actually accept.
//
// One accepted gap: knight/king-shaped extra-mode destinations aren't
// checked for leaving your own king in check (chess.js has no way to ask
// "is this hypothetical move safe" for a square it thinks holds a Rook or
// Bishop). That only matters for the rare pinned-evolved-piece case, and the
// server still authoritatively rejects an unsafe move on drop either way -
// this is a hint overlay, not the rule enforcement.

// Which square is currently a Dragon/Pope/Archer/Hydra/Cyclops/Mirror lives
// in its own separate gameState fields, not the FEN - that's how a Dragon's
// art (say) differs from a plain Rook sitting on the same square. The
// optimistic FEN preview above moves the piece's *position* instantly, but
// doesn't touch these on its own, which left the piece rendering as its
// plain base type (a Rook, a Knight, ...) for the instant between the
// optimistic preview landing and the real response arriving, since art
// selection keys off these squares matching, not the FEN. This relocates
// whichever one of them held `from` over to `to`, mirroring the FEN move
// that just happened. Never call this for an Archer's shoot - the archer
// itself doesn't move, and `from` there is the archer's own square (which
// this would incorrectly "relocate" onto the shot's target square).
const HERO_SQUARE_ARRAY_FIELDS = [
  "white_dragon_squares",
  "black_dragon_squares",
  "white_hydra_squares",
  "black_hydra_squares",
  "white_cyclops_squares",
  "black_cyclops_squares",
  "white_mirror_squares",
  "black_mirror_squares",
];
const HERO_SQUARE_SINGLE_FIELDS = [
  "white_pope_square",
  "black_pope_square",
  "white_archer_square",
  "black_archer_square",
];

export function relocateHeroTrackingSquares(gameState, from, to) {
  const patch = {};
  for (const field of HERO_SQUARE_SINGLE_FIELDS) {
    if (gameState[field] === from) patch[field] = to;
  }
  for (const field of HERO_SQUARE_ARRAY_FIELDS) {
    const list = gameState[field];
    if (list && list.includes(from)) {
      patch[field] = list.map((square) => (square === from ? to : square));
    }
  }
  return patch;
}

const KING_STEP_OFFSETS = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
];
const KNIGHT_OFFSETS = [
  [1, 2], [2, 1], [2, -1], [1, -2],
  [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
// The other 8 squares at Chebyshev distance 2 (straight or diagonal, two
// out) - together with KNIGHT_OFFSETS these form the Hydra's full ring.
const HYDRA_RING_EXTRA_OFFSETS = [
  [-2, -2], [-2, 0], [-2, 2], [0, -2], [0, 2], [2, -2], [2, 0], [2, 2],
];

function toCoord(square) {
  return [square.charCodeAt(0) - 97, Number(square[1]) - 1];
}

function toSquare([file, rank]) {
  return `${String.fromCharCode(97 + file)}${rank + 1}`;
}

function offsetDestinations(offsets, fromSquare) {
  const [ff, fr] = toCoord(fromSquare);
  const destinations = [];
  for (const [df, dr] of offsets) {
    const f = ff + df;
    const r = fr + dr;
    if (f < 0 || f > 7 || r < 0 || r > 7) continue;
    destinations.push(toSquare([f, r]));
  }
  return destinations;
}

// Relocates a piece by hand (remove from `from`, remove/replace whatever's
// on `to`, put it back down there) and fixes up the FEN's active-color /
// halfmove / fullmove fields to match - the same bookkeeping a normal move
// gets, just done manually since chess.js's own move() has no idea these
// moves are legal at all. Never used for a castle, en passant, or
// promotion - no hero special move is ever any of those.
function applyRelocateAndCapture(fen, from, to, promotion) {
  try {
    const chess = new Chess(fen);
    const mover = chess.get(from);
    if (!mover) return null;
    const wasCapture = Boolean(chess.get(to));
    chess.remove(from);
    if (wasCapture) chess.remove(to);
    const landingRank = Number(to[1]);
    const isPromotion = mover.type === "p" && (landingRank === 8 || landingRank === 1);
    chess.put({ type: isPromotion ? promotion || "q" : mover.type, color: mover.color }, to);

    const [placement, activeColor, castling] = chess.fen().split(" ");
    const nextColor = activeColor === "w" ? "b" : "w";
    const fullmove = Number(fen.split(" ")[5]) + (activeColor === "b" ? 1 : 0);
    return `${placement} ${nextColor} ${castling} - ${wasCapture ? 0 : Number(fen.split(" ")[4]) + 1} ${fullmove}`;
  } catch {
    return null;
  }
}

// An Archer's shoot never relocates it - this just removes whatever's on
// the target square and passes the turn, same idea as above.
function applyNonRelocatingCapture(fen, targetSquare) {
  try {
    const chess = new Chess(fen);
    if (!chess.get(targetSquare)) return null;
    chess.remove(targetSquare);

    const [placement, activeColor, castling] = chess.fen().split(" ");
    const nextColor = activeColor === "w" ? "b" : "w";
    const fullmove = Number(fen.split(" ")[5]) + (activeColor === "b" ? 1 : 0);
    return `${placement} ${nextColor} ${castling} - 0 ${fullmove}`;
  } catch {
    return null;
  }
}

// A quick client-side "best guess" at the resulting position for a move,
// so the mover's own board can update the instant they drop a piece
// instead of waiting on the network round trip. Only ever used for the
// optimistic preview, never for rule enforcement - the authoritative
// response/broadcast overwrites this guess moments later regardless, and
// the caller rolls it back if the server ends up rejecting the move
// outright.
//
// Tries a plain chess.js move first, since that correctly handles every
// normal move (including a hero piece's own "plain" mode - the FEN only
// ever encodes the base type it's stored as). If that's not legal, and the
// caller says this square is a Dragon/Pope/Hydra/Cyclops/Mirror/Archer/a
// Pope-boosted Pawn, checks whether `to` is actually one of THAT piece's own
// hero-special destinations (reusing the exact same candidate logic
// computeLegalDestinations uses) before applying it by hand - so a
// genuinely illegal drop still correctly returns null and waits for the
// server to reject it, same as before.
export function tryOptimisticFen(
  fen,
  from,
  to,
  {
    promotion = "q",
    isDragonSquare,
    isPopeSquare,
    isArcherSquare,
    isHydraSquare,
    isCyclopsSquare,
    isMirrorSquare,
    mirrorMimicType,
    mirrorMimicIsHydra,
    mirrorMimicIsArcher,
    mirrorMimicIsPope,
    ownPopeSquare,
    shoot,
  } = {}
) {
  if (shoot) return applyNonRelocatingCapture(fen, to);

  try {
    const chess = new Chess(fen);
    const move = chess.move({ from, to, promotion });
    if (move) return chess.fen();
  } catch {
    // Not a plain chess.js-legal move - fall through to the hero-special
    // checks below rather than giving up immediately.
  }

  let chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }
  const mover = chess.get(from);
  if (!mover) return null;

  if (isDragonSquare && knightShapeDestinations(chess, from, { requireEnemy: false }).includes(to)) {
    return applyRelocateAndCapture(fen, from, to);
  }
  if (isArcherSquare && archerRelocateDestinations(chess, from).includes(to)) {
    return applyRelocateAndCapture(fen, from, to);
  }
  if (isPopeSquare && kingStepDestinations(chess, from).includes(to)) {
    return applyRelocateAndCapture(fen, from, to);
  }
  if (isHydraSquare && hydraRingExtraDestinations(chess, from).includes(to)) {
    return applyRelocateAndCapture(fen, from, to);
  }
  if (isCyclopsSquare && cyclopsSpecialCaptureSquare(from, mover.color) === to) {
    const occupant = chess.get(to);
    if (occupant && occupant.color !== mover.color && occupant.type !== "k") {
      return applyRelocateAndCapture(fen, from, to);
    }
    return null;
  }
  if (isMirrorSquare && mirrorMimicType === "n" && mirrorMimicIsArcher) {
    // An Archer's relocate is move-only (never a capture) - shoot is
    // already handled by the `if (shoot)` early-return above, since
    // isArcherShootMove is purely geometric and works for a Mirror's own
    // square exactly like it does for a real Archer's.
    if (archerRelocateDestinations(chess, from).includes(to)) {
      return applyRelocateAndCapture(fen, from, to);
    }
  } else if (
    isMirrorSquare &&
    mirrorMimicType &&
    mirrorMimicDestinations(chess, from, mirrorMimicType, mirrorMimicIsHydra, mirrorMimicIsPope).includes(to)
  ) {
    return applyRelocateAndCapture(fen, from, to);
  }
  if (
    !isDragonSquare &&
    !isPopeSquare &&
    !isArcherSquare &&
    !isHydraSquare &&
    !isCyclopsSquare &&
    !isMirrorSquare &&
    mover.type === "p" &&
    isWithinPopeAura(ownPopeSquare, from)
  ) {
    if (popeBoostedForwardSquare(from, mover.color) === to && !chess.get(to)) {
      return applyBoostedPawnPush(fen, from, to, promotion);
    }
    if (popeBoostedDiagonalCaptureSquares(from, mover.color).includes(to)) {
      const occupant = chess.get(to);
      if (occupant && occupant.color !== mover.color && occupant.type !== "k") {
        return applyRelocateAndCapture(fen, from, to, promotion);
      }
    }
  }

  return null;
}

function kingStepDestinations(chess, fromSquare) {
  const mover = chess.get(fromSquare);
  return offsetDestinations(KING_STEP_OFFSETS, fromSquare).filter((square) => {
    const occupant = chess.get(square);
    return !occupant || occupant.color !== mover.color;
  });
}

// An Archer's king-step relocate is move-only - unlike the Pope/Mirror's
// own king-step modes, it can never capture (an enemy king included), so
// this can't just reuse kingStepDestinations - see execute_archer_move.
function archerRelocateDestinations(chess, fromSquare) {
  return offsetDestinations(KING_STEP_OFFSETS, fromSquare).filter((square) => !chess.get(square));
}

// Whether dropping an Archer from archerSquare onto targetSquare should be
// treated as a shoot (a knight's-move away, capturing without relocating)
// rather than a king-step relocate - inferred from the target square itself
// now that there's no separate "arm the shot" toggle to ask instead.
export function isArcherShootMove(fen, archerSquare, targetSquare) {
  try {
    const chess = new Chess(fen);
    return knightShapeDestinations(chess, archerSquare, { requireEnemy: true }).includes(targetSquare);
  } catch {
    return false;
  }
}

function knightShapeDestinations(chess, fromSquare, { requireEnemy }) {
  const mover = chess.get(fromSquare);
  return offsetDestinations(KNIGHT_OFFSETS, fromSquare).filter((square) => {
    const occupant = chess.get(square);
    if (requireEnemy) return Boolean(occupant) && occupant.color !== mover.color && occupant.type !== "k";
    return !occupant || occupant.color !== mover.color;
  });
}

function hydraRingExtraDestinations(chess, fromSquare) {
  const mover = chess.get(fromSquare);
  return offsetDestinations(HYDRA_RING_EXTRA_OFFSETS, fromSquare).filter((square) => {
    const occupant = chess.get(square);
    return !occupant || occupant.color !== mover.color;
  });
}

// A Cyclops's one special-capture square: two squares diagonally toward its
// own forward-left - mirrors backend/app/custom_chess/rules.py's
// cyclops_special_capture_square. Returns null if it would fall off-board.
function cyclopsSpecialCaptureSquare(fromSquare, color) {
  const [ff, fr] = toCoord(fromSquare);
  const [df, dr] = color === "w" ? [-2, 2] : [2, -2];
  const f = ff + df;
  const r = fr + dr;
  if (f < 0 || f > 7 || r < 0 || r > 7) return null;
  return toSquare([f, r]);
}

// Mirrors backend/app/custom_chess/rules.py's is_within_pope_aura: Chebyshev
// distance <= 1 from the Pope's own square.
function isWithinPopeAura(popeSquare, square) {
  if (!popeSquare) return false;
  const [pf, pr] = toCoord(popeSquare);
  const [sf, sr] = toCoord(square);
  return Math.max(Math.abs(pf - sf), Math.abs(pr - sr)) <= 1;
}

// Mirrors rules.pope_boosted_forward_square: two squares straight ahead,
// regardless of rank (only the path needs to be clear, not the starting
// rank).
function popeBoostedForwardSquare(fromSquare, color) {
  const [f, r] = toCoord(fromSquare);
  const dr = color === "w" ? 2 : -2;
  const nr = r + dr;
  if (nr < 0 || nr > 7) return null;
  return toSquare([f, nr]);
}

// Mirrors rules.pope_boosted_diagonal_capture_squares: both two-square
// diagonal jumps forward (a real Pawn's own diagonal capture only ever
// reaches one square, and even the Cyclops's extra hop only ever covers its
// forward-left).
function popeBoostedDiagonalCaptureSquares(fromSquare, color) {
  const [f, r] = toCoord(fromSquare);
  const dr = color === "w" ? 2 : -2;
  const nr = r + dr;
  const squares = [];
  if (nr < 0 || nr > 7) return squares;
  for (const df of [-2, 2]) {
    const nf = f + df;
    if (nf >= 0 && nf <= 7) squares.push(toSquare([nf, nr]));
  }
  return squares;
}

// A boosted Pawn's forward-2 push, applied by hand like
// applyRelocateAndCapture - unlike a capture, this needs to double-check the
// square directly ahead is also clear (a normal double-step's path-clear
// rule, just extended to a non-starting rank), and can land on the back
// rank (promotion) the same way a normal pawn push can.
function applyBoostedPawnPush(fen, from, to, promotion) {
  try {
    const chess = new Chess(fen);
    const mover = chess.get(from);
    if (!mover) return null;
    const [ff, fr] = toCoord(from);
    const oneAheadRank = fr + (mover.color === "w" ? 1 : -1);
    const oneAhead = toSquare([ff, oneAheadRank]);
    if (chess.get(oneAhead) || chess.get(to)) return null;
    chess.remove(from);
    const landingRank = Number(to[1]);
    const isPromotion = landingRank === 8 || landingRank === 1;
    chess.put({ type: isPromotion ? promotion : mover.type, color: mover.color }, to);

    const [placement, activeColor, castling] = chess.fen().split(" ");
    const nextColor = activeColor === "w" ? "b" : "w";
    const fullmove = Number(fen.split(" ")[5]) + (activeColor === "b" ? 1 : 0);
    return `${placement} ${nextColor} ${castling} - 0 ${fullmove}`;
  } catch {
    return null;
  }
}

// Every square python-chess's own legal-move generator would allow a piece
// of mimicType to reach from fromSquare, mirroring
// custom_game_routes.py's _mirror_candidate_destinations - built by loading
// a scratch chess.js position with fromSquare's real piece swapped for
// mimicType (chess.js has no "relabel and ask" API of its own, so this
// reconstructs the FEN with that one square edited instead). mimicIsHydra
// layers on a Hydra's ring-extra squares when mimicking a Knight - chess.js's
// relabel-to-Knight trick alone only ever sees the plain knight-shaped third
// of a Hydra's ring, the same gap _mirror_candidate_destinations closes on
// the backend (the "couldn't copy a Hydra in some cases" bug). mimicIsPope
// routes a mimicked Bishop into king-step geometry instead of the
// relabel-and-ask path below - a Pope has no native diagonal-line movement
// at all (see rules.py's execute_pope_move), so treating it as a real
// Bishop offered (and threatened - see custom_game_routes.py's
// _mirror_threat_squares) the whole diagonal instead of the one square a
// king-step actually reaches.
function mirrorMimicDestinations(chess, fromSquare, mimicType, mimicIsHydra, mimicIsPope) {
  if (mimicType === "k" || (mimicType === "b" && mimicIsPope)) return kingStepDestinations(chess, fromSquare);

  const mover = chess.get(fromSquare);
  const scratch = new Chess(chess.fen());
  scratch.remove(fromSquare);
  scratch.put({ type: mimicType, color: mover.color }, fromSquare);
  let destinations;
  try {
    destinations = scratch.moves({ square: fromSquare, verbose: true }).map((m) => m.to);
  } catch (err) {
    console.warn("mirrorMimicDestinations: couldn't compute mimicked moves, showing no hints", {
      fromSquare,
      mimicType,
      err,
    });
    destinations = [];
  }
  if (mimicType === "n" && mimicIsHydra) {
    const ringExtra = hydraRingExtraDestinations(chess, fromSquare);
    destinations = [...new Set([...destinations, ...ringExtra])];
  }
  return destinations;
}

// Whether relocating the piece on `fromSquare` to `toSquare` would leave
// moverColor's own king in check - used to filter every hero-special
// destination list below (king-step, knight-shape, ring-extra, ...) none
// of which go through chess.js's own native legal-move generation the way
// a plain/base-mode move does, so none of them were ever check-safety
// filtered on their own. Confirmed live: an Archer pinned to its own king
// along a file showed dots for all 8 king-step squares, 6 of which the
// server correctly rejected as "leaves your king in check" - the exact
// "sometimes doesn't work" symptom (a shown dot that silently fails on
// drop). `chess` is assumed to already have its turn set to moverColor
// (computeLegalDestinations's own off-turn flip above already does this),
// so the scratch clone's own inCheck() directly answers the right
// question without needing a color argument.
function keepsOwnKingSafeIfRelocated(chess, fromSquare, toSquare, moverColor) {
  try {
    const scratch = new Chess(chess.fen());
    const piece = scratch.get(fromSquare);
    if (!piece) return false;
    scratch.remove(fromSquare);
    scratch.remove(toSquare);
    scratch.put({ type: piece.type, color: moverColor }, toSquare);
    return !scratch.inCheck();
  } catch (err) {
    // Fails CLOSED (treats the candidate as unsafe/hidden) rather than
    // crashing the whole computeLegalDestinations call - a thrown error
    // here used to propagate all the way up uncaught, silently wiping out
    // EVERY dot for that click (not just this one candidate square), with
    // nothing printed anywhere to explain why - exactly the "dots
    // randomly don't show, nothing in the console" symptom.
    console.warn("keepsOwnKingSafeIfRelocated: treating candidate as unsafe after an error", {
      fromSquare,
      toSquare,
      moverColor,
      err,
    });
    return false;
  }
}

// Same idea, for an Archer's (or a Mirror-mimicking-one's) shoot - the
// shooter never relocates, only the target square loses its piece.
function keepsOwnKingSafeIfShotFrom(chess, targetSquare) {
  try {
    const scratch = new Chess(chess.fen());
    scratch.remove(targetSquare);
    return !scratch.inCheck();
  } catch (err) {
    console.warn("keepsOwnKingSafeIfShotFrom: treating candidate as unsafe after an error", { targetSquare, err });
    return false;
  }
}

// Returns [{ square, capture, shoot }] - capture flags whether that
// destination is currently occupied (by an enemy piece), for dot-vs-ring
// styling; shoot flags an Archer's non-relocating knight's-move capture.
export function computeLegalDestinations({
  fen,
  square,
  isDragonSquare,
  isPopeSquare,
  isArcherSquare,
  isHydraSquare,
  isCyclopsSquare,
  isMirrorSquare,
  mirrorMimicType, // one of "q"/"r"/"b"/"n"/"p"/"k", or null/undefined if nothing to mimic yet
  mirrorMimicIsHydra,
  mirrorMimicIsArcher,
  mirrorMimicIsPope,
  ownPopeSquare, // this piece's own side's Pope square, for the aura's boosted-Pawn destinations
}) {
  let chess;
  try {
    chess = new Chess(fen);
  } catch (err) {
    console.warn("computeLegalDestinations: couldn't load fen, showing no hints", { fen, square, err });
    return [];
  }

  // chess.moves() - and anything built from a scratch copy of `chess`, like
  // mirrorMimicDestinations's own relabel trick - is turn-gated: it silently
  // returns nothing for a piece whose color doesn't match whose turn it
  // currently is in the FEN. A click-to-preview needs to work for ANY
  // piece regardless of whose actual turn it is (see OnlineGamePlay.jsx's
  // own click handler comment), so the scratch position's turn is flipped
  // to match this square's own piece before generating anything from it -
  // this was the real "sometimes doesn't show where pieces move" bug:
  // previewing your own piece off-turn, or an opponent's piece on your
  // turn, silently produced zero destinations either way. The hero-special
  // offset-based destinations below (king-step, knight-shape, etc.) never
  // called chess.moves() at all, so they were never affected - only the
  // generic chess.js-native modes were.
  const mover = chess.get(square);
  if (!mover) return [];
  if (mover.color !== chess.turn()) {
    const fenParts = chess.fen().split(" ");
    fenParts[1] = mover.color;
    // The en-passant square's rank is only ever legal for ONE side to move
    // (rank 6 for white, rank 3 for black) - chess.js's own FEN validator
    // enforces this and throws otherwise. Right after any pawn double-step,
    // flipping the active color above without also clearing this field
    // produces exactly that illegal combination, which is what was actually
    // throwing here: previewing an off-turn piece (routine - clicking the
    // opponent's own piece, or either side in an online game) right after a
    // pawn double-step anywhere on the board. This preview is a synthetic
    // "what if it were this side's turn" snapshot, not a real position in
    // the game's history, so there's nothing meaningful an en-passant
    // square could add to it anyway.
    fenParts[3] = "-";
    try {
      chess = new Chess(fenParts.join(" "));
    } catch (err) {
      console.warn("computeLegalDestinations: couldn't flip turn to preview off-turn piece, showing no hints", {
        fen,
        square,
        moverColor: mover.color,
        err,
      });
      return [];
    }
  }

  if (isArcherSquare) {
    // No more "arm the shot" toggle - selecting an Archer always shows both
    // its move-only king-step destinations (plain dots) and its knight's-
    // move shoot targets (red rings) at once; which one a drop actually
    // performs is inferred from the target square, not a pre-armed mode.
    // Both filtered for check safety (see keepsOwnKingSafeIfRelocated's own
    // comment) - an Archer pinned to its own king must not show either.
    const moveDestinations = archerRelocateDestinations(chess, square).filter((to) =>
      keepsOwnKingSafeIfRelocated(chess, square, to, mover.color)
    );
    const shootDestinations = knightShapeDestinations(chess, square, { requireEnemy: true }).filter((to) =>
      keepsOwnKingSafeIfShotFrom(chess, to)
    );
    return [
      ...moveDestinations.map((to) => ({ square: to, capture: false, shoot: false })),
      ...shootDestinations.map((to) => ({ square: to, capture: true, shoot: true })),
    ];
  }

  if (isMirrorSquare) {
    if (!mirrorMimicType) return [];
    if (mirrorMimicType === "n" && mirrorMimicIsArcher) {
      // Same dual-mode shape as the real Archer branch above - a Mirror
      // currently mimicking an Archer shows both the move-only relocate
      // dots and the knight's-move shoot rings at once.
      const moveDestinations = archerRelocateDestinations(chess, square).filter((to) =>
        keepsOwnKingSafeIfRelocated(chess, square, to, mover.color)
      );
      const shootDestinations = knightShapeDestinations(chess, square, { requireEnemy: true }).filter((to) =>
        keepsOwnKingSafeIfShotFrom(chess, to)
      );
      return [
        ...moveDestinations.map((to) => ({ square: to, capture: false, shoot: false })),
        ...shootDestinations.map((to) => ({ square: to, capture: true, shoot: true })),
      ];
    }
    // mirrorMimicDestinations's own relabel-and-ask-chess.js path (every
    // mimicked type except King/Pope) is already check-safety filtered
    // natively by chess.js's own legal-move generation on that scratch
    // board - only King/Pope mimicry (pure king-step offsets, same gap as
    // the real Pope below) and a mimicked Hydra's ring-extra addition
    // aren't, so this filters the whole result uniformly rather than
    // duplicating mirrorMimicDestinations's own branching here.
    const destinations = mirrorMimicDestinations(chess, square, mirrorMimicType, mirrorMimicIsHydra, mirrorMimicIsPope).filter(
      (to) => keepsOwnKingSafeIfRelocated(chess, square, to, mover.color)
    );
    return destinations.map((to) => ({ square: to, capture: Boolean(chess.get(to)), shoot: false }));
  }

  if (isPopeSquare) {
    // No baseModeDestinations fallback - unlike the old Wizard this
    // replaces, a Pope has NO native movement mode at all (its Bishop
    // storage's diagonal-line moves are never actually legal for it), so
    // king-step is the sole source of truth, structurally like the Archer's
    // own king-step relocate above - filtered the same way for the same
    // reason (a pinned Pope must not show a dot off the pin line).
    const destinations = kingStepDestinations(chess, square).filter((to) =>
      keepsOwnKingSafeIfRelocated(chess, square, to, mover.color)
    );
    return destinations.map((to) => ({ square: to, capture: Boolean(chess.get(to)), shoot: false }));
  }

  const baseModeDestinations = chess.moves({ square, verbose: true }).map((m) => m.to);
  let destinations;
  if (isDragonSquare) {
    // baseModeDestinations (the Rook-line moves) already comes from
    // chess.js's own native legal-move generation, which is already
    // check-safety filtered - only the added knight-shape hop needs it
    // done manually here.
    const knightHopDestinations = knightShapeDestinations(chess, square, { requireEnemy: false }).filter((to) =>
      keepsOwnKingSafeIfRelocated(chess, square, to, mover.color)
    );
    destinations = [...new Set([...baseModeDestinations, ...knightHopDestinations])];
  } else if (isHydraSquare) {
    // baseModeDestinations already covers the knight-shaped third natively
    // (Hydra is stored as a Knight) - the other two thirds of its ring
    // (straight-two, diagonal-two) are layered on top here, filtered the
    // same way as the Dragon's added knight-hop above. It never moves
    // just one square, unlike a King.
    const ringExtraDestinations = hydraRingExtraDestinations(chess, square).filter((to) =>
      keepsOwnKingSafeIfRelocated(chess, square, to, mover.color)
    );
    destinations = [...new Set([...baseModeDestinations, ...ringExtraDestinations])];
  } else if (isCyclopsSquare) {
    const mover = chess.get(square);
    const specialTo = cyclopsSpecialCaptureSquare(square, mover.color);
    const specialOccupant = specialTo ? chess.get(specialTo) : null;
    destinations = [...baseModeDestinations];
    if (
      specialTo &&
      specialOccupant &&
      specialOccupant.color !== mover.color &&
      specialOccupant.type !== "k" &&
      keepsOwnKingSafeIfRelocated(chess, square, specialTo, mover.color)
    ) {
      destinations.push(specialTo);
    }
  } else if (mover.type === "p" && isWithinPopeAura(ownPopeSquare, square)) {
    // A plain Pawn (never a Cyclops - handled above already) within an
    // allied Pope's aura: baseModeDestinations already covers its normal
    // moves, plus the boosted forward-2 push and both diagonal-2 captures.
    destinations = [...baseModeDestinations];
    const forwardTo = popeBoostedForwardSquare(square, mover.color);
    if (
      forwardTo &&
      !destinations.includes(forwardTo) &&
      !chess.get(forwardTo) &&
      keepsOwnKingSafeIfRelocated(chess, square, forwardTo, mover.color)
    ) {
      const [ff, fr] = toCoord(square);
      const oneAhead = toSquare([ff, fr + (mover.color === "w" ? 1 : -1)]);
      if (!chess.get(oneAhead)) destinations.push(forwardTo);
    }
    for (const to of popeBoostedDiagonalCaptureSquares(square, mover.color)) {
      const occupant = chess.get(to);
      if (
        occupant &&
        occupant.color !== mover.color &&
        occupant.type !== "k" &&
        !destinations.includes(to) &&
        keepsOwnKingSafeIfRelocated(chess, square, to, mover.color)
      ) {
        destinations.push(to);
      }
    }
  } else {
    destinations = baseModeDestinations;
  }

  return destinations.map((to) => ({ square: to, capture: Boolean(chess.get(to)), shoot: false }));
}
