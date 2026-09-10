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

// Returns [{ square, capture, shoot }] - capture flags whether that
// destination is currently occupied (by an enemy piece), for dot-vs-ring
// styling; shoot flags an Archer's non-relocating knight's-move capture.
export function computeLegalDestinations({ fen, square, isDragonSquare, isWizardSquare, isArcherSquare, shootArmed }) {
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

  const baseModeDestinations = chess.moves({ square, verbose: true }).map((m) => m.to);
  let destinations;
  if (isDragonSquare) {
    destinations = [...new Set([...baseModeDestinations, ...knightShapeDestinations(chess, square, { requireEnemy: false })])];
  } else if (isWizardSquare) {
    destinations = [...new Set([...baseModeDestinations, ...kingStepDestinations(chess, square)])];
  } else {
    destinations = baseModeDestinations;
  }

  return destinations.map((to) => ({ square: to, capture: Boolean(chess.get(to)), shoot: false }));
}
