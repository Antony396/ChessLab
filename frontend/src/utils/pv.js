import { Chess } from "chess.js";

// Stockfish's principal variation (best_line_san) is the sequence of moves
// it expects both sides to play out from this position. This walks that SAN
// sequence forward from fenBefore to recover each move's from/to squares so
// the whole line can be drawn on the board, not just the first move.
export function computePvArrows(fenBefore, sanMoves) {
  let chess;
  try {
    chess = new Chess(fenBefore);
  } catch {
    return [];
  }

  const arrows = [];
  for (const san of sanMoves) {
    let move;
    try {
      move = chess.move(san);
    } catch {
      break; // stop at the first move that doesn't apply cleanly
    }
    if (!move) break;
    arrows.push({ startSquare: move.from, endSquare: move.to });
  }
  return arrows;
}
