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

function kingStepDestinations(chess, fromSquare) {
  const mover = chess.get(fromSquare);
  return offsetDestinations(KING_STEP_OFFSETS, fromSquare).filter((square) => {
    const occupant = chess.get(square);
    return !occupant || occupant.color !== mover.color;
  });
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
// reconstructs the FEN with that one square edited instead).
function mirrorMimicDestinations(chess, fromSquare, mimicType) {
  if (mimicType === "k") return kingStepDestinations(chess, fromSquare);

  const mover = chess.get(fromSquare);
  const scratch = new Chess(chess.fen());
  scratch.remove(fromSquare);
  scratch.put({ type: mimicType, color: mover.color }, fromSquare);
  try {
    return scratch.moves({ square: fromSquare, verbose: true }).map((m) => m.to);
  } catch {
    return [];
  }
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
  shootArmed,
}) {
  let chess;
  try {
    chess = new Chess(fen);
  } catch {
    return [];
  }

  if (isArcherSquare) {
    const destinations = shootArmed
      ? knightShapeDestinations(chess, square, { requireEnemy: true })
      : kingStepDestinations(chess, square);
    return destinations.map((to) => ({ square: to, capture: Boolean(chess.get(to)), shoot: shootArmed }));
  }

  if (isMirrorSquare) {
    if (!mirrorMimicType) return [];
    const destinations = mirrorMimicDestinations(chess, square, mirrorMimicType);
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
