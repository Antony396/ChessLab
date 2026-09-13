import { Chess } from "chess.js";

// Legal-destination hints for the board's drag-start highlight. chess.js
// only understands the piece actually encoded in the FEN, which is correct
// for normal pieces and for a Dragon's rook-mode / Wizard's bishop-mode
// travel (they're stored as a Rook / Bishop respectively), but knows
// nothing about their extra movement mode, or about the Archer's king-step
// relocate and knight's-move shoot - those are layered on top here,
// mirroring backend/app/custom_chess/rules.py and
// api/custom_game_routes.py's candidate-generation so the hints match what
// the server will actually accept.
//
// One accepted gap: knight/king-shaped extra-mode destinations aren't
// checked for leaving your own king in check (chess.js has no way to ask
// "is this hypothetical move safe" for a square it thinks holds a Rook or
// Bishop). That only matters for the rare pinned-evolved-piece case, and the
// server still authoritatively rejects an unsafe move on drop either way -
// this is a hint overlay, not the rule enforcement.

// Which square is currently a Dragon/Wizard/Archer/Hydra/Cyclops/Mirror
// lives in its own separate gameState fields, not the FEN - that's how a
// Dragon's art (say) differs from a plain Rook sitting on the same square.
// The optimistic FEN preview above moves the piece's *position* instantly,
// but doesn't touch these on its own, which left the piece rendering as
// its plain base type (a Rook, a Knight, ...) for the instant between the
// optimistic preview landing and the real response arriving, since art
// selection keys off these squares matching, not the FEN. This relocates
// whichever one of them held `from` over to `to`, mirroring the FEN move
// that just happened. Never call this for an Archer's shoot - the archer
// itself doesn't move, and `from` there is the archer's own square (which
// this would incorrectly "relocate" onto the shot's target square).
const HERO_SQUARE_ARRAY_FIELDS = [
  "white_wizard_squares",
  "black_wizard_squares",
  "white_archer_squares",
  "black_archer_squares",
  "white_hydra_squares",
  "black_hydra_squares",
  "white_cyclops_squares",
  "black_cyclops_squares",
  "white_mirror_squares",
  "black_mirror_squares",
];
const HERO_SQUARE_SINGLE_FIELDS = ["white_dragon_square", "black_dragon_square"];

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
function applyRelocateAndCapture(fen, from, to) {
  try {
    const chess = new Chess(fen);
    const mover = chess.get(from);
    if (!mover) return null;
    const wasCapture = Boolean(chess.get(to));
    chess.remove(from);
    if (wasCapture) chess.remove(to);
    chess.put({ type: mover.type, color: mover.color }, to);

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
// caller says this square is a Dragon/Wizard/Hydra/Cyclops/Mirror/Archer,
// checks whether `to` is actually one of THAT piece's own hero-special
// destinations (reusing the exact same candidate logic
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
    isWizardSquare,
    isArcherSquare,
    isHydraSquare,
    isCyclopsSquare,
    isMirrorSquare,
    mirrorMimicType,
    mirrorMimicIsHydra,
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
  if (isWizardSquare && kingStepDestinations(chess, from).includes(to)) {
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
  if (
    isMirrorSquare &&
    mirrorMimicType &&
    mirrorMimicDestinations(chess, from, mirrorMimicType, mirrorMimicIsHydra).includes(to)
  ) {
    return applyRelocateAndCapture(fen, from, to);
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

// An Archer's king-step relocate is move-only - unlike the Wizard/Mirror's
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

// Every square python-chess's own legal-move generator would allow a piece
// of mimicType to reach from fromSquare, mirroring
// custom_game_routes.py's _mirror_candidate_destinations - built by loading
// a scratch chess.js position with fromSquare's real piece swapped for
// mimicType (chess.js has no "relabel and ask" API of its own, so this
// reconstructs the FEN with that one square edited instead). mimicIsHydra
// layers on a Hydra's ring-extra squares when mimicking a Knight - chess.js's
// relabel-to-Knight trick alone only ever sees the plain knight-shaped third
// of a Hydra's ring, the same gap _mirror_candidate_destinations closes on
// the backend (the "couldn't copy a Hydra in some cases" bug).
function mirrorMimicDestinations(chess, fromSquare, mimicType, mimicIsHydra) {
  if (mimicType === "k") return kingStepDestinations(chess, fromSquare);

  const mover = chess.get(fromSquare);
  const scratch = new Chess(chess.fen());
  scratch.remove(fromSquare);
  scratch.put({ type: mimicType, color: mover.color }, fromSquare);
  let destinations;
  try {
    destinations = scratch.moves({ square: fromSquare, verbose: true }).map((m) => m.to);
  } catch {
    destinations = [];
  }
  if (mimicType === "n" && mimicIsHydra) {
    const ringExtra = hydraRingExtraDestinations(chess, fromSquare);
    destinations = [...new Set([...destinations, ...ringExtra])];
  }
  return destinations;
}

// Returns [{ square, capture, shoot }] - capture flags whether that
// destination is currently occupied (by an enemy piece), for dot-vs-ring
// styling; shoot flags an Archer's non-relocating knight's-move capture.
export function computeLegalDestinations({
  fen,
  square,
  isDragonSquare,
  isWizardSquare,
  isArcherSquare,
  isHydraSquare,
  isCyclopsSquare,
  isMirrorSquare,
  mirrorMimicType, // one of "q"/"r"/"b"/"n"/"p"/"k", or null/undefined if nothing to mimic yet
  mirrorMimicIsHydra,
}) {
  let chess;
  try {
    chess = new Chess(fen);
  } catch {
    return [];
  }

  if (isArcherSquare) {
    // No more "arm the shot" toggle - selecting an Archer always shows both
    // its move-only king-step destinations (plain dots) and its knight's-
    // move shoot targets (red rings) at once; which one a drop actually
    // performs is inferred from the target square, not a pre-armed mode.
    const moveDestinations = archerRelocateDestinations(chess, square);
    const shootDestinations = knightShapeDestinations(chess, square, { requireEnemy: true });
    return [
      ...moveDestinations.map((to) => ({ square: to, capture: false, shoot: false })),
      ...shootDestinations.map((to) => ({ square: to, capture: true, shoot: true })),
    ];
  }

  if (isMirrorSquare) {
    if (!mirrorMimicType) return [];
    const destinations = mirrorMimicDestinations(chess, square, mirrorMimicType, mirrorMimicIsHydra);
    return destinations.map((to) => ({ square: to, capture: Boolean(chess.get(to)), shoot: false }));
  }

  const baseModeDestinations = chess.moves({ square, verbose: true }).map((m) => m.to);
  let destinations;
  if (isDragonSquare) {
    destinations = [...new Set([...baseModeDestinations, ...knightShapeDestinations(chess, square, { requireEnemy: false })])];
  } else if (isWizardSquare) {
    destinations = [...new Set([...baseModeDestinations, ...kingStepDestinations(chess, square)])];
  } else if (isHydraSquare) {
    // baseModeDestinations already covers the knight-shaped third natively
    // (Hydra is stored as a Knight) - the other two thirds of its ring
    // (straight-two, diagonal-two) are layered on top here. It never moves
    // just one square, unlike a King.
    destinations = [...new Set([...baseModeDestinations, ...hydraRingExtraDestinations(chess, square)])];
  } else if (isCyclopsSquare) {
    const mover = chess.get(square);
    const specialTo = cyclopsSpecialCaptureSquare(square, mover.color);
    const specialOccupant = specialTo ? chess.get(specialTo) : null;
    destinations = [...baseModeDestinations];
    if (specialTo && specialOccupant && specialOccupant.color !== mover.color && specialOccupant.type !== "k") {
      destinations.push(specialTo);
    }
  } else {
    destinations = baseModeDestinations;
  }

  return destinations.map((to) => ({ square: to, capture: Boolean(chess.get(to)), shoot: false }));
}
