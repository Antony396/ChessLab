import { Chess } from "chess.js";

// Purely local heuristics derived from the position/move themselves - no
// LLM, no API call. This is presentation-layer sugar on top of Stockfish's
// factual output, not a fact Stockfish asserted; keep it framed that way in
// the UI (see BestMovePanel).

const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PIECE_NAMES = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const CENTER_SQUARES = new Set(["d4", "d5", "e4", "e5"]);
const OPENING_MOVE_CUTOFF = 12;

export function describeMove(fenBefore, uci, moveNumber) {
  let chess;
  try {
    chess = new Chess(fenBefore);
  } catch {
    return [];
  }

  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.slice(4) || undefined;
  const movingPiece = chess.get(from);
  if (!movingPiece) return [];

  let move;
  try {
    move = chess.move({ from, to, promotion });
  } catch {
    return [];
  }

  const tags = [];

  if (move.isEnPassant()) {
    tags.push("Captures en passant");
  } else if (move.isCapture()) {
    const capturedValue = PIECE_VALUES[move.captured] ?? 0;
    const attackerValue = PIECE_VALUES[movingPiece.type] ?? 0;
    if (capturedValue > attackerValue) {
      tags.push(`Wins material — a ${PIECE_NAMES[move.captured]} for a ${PIECE_NAMES[movingPiece.type]}`);
    } else {
      tags.push(`Captures a ${PIECE_NAMES[move.captured]}`);
    }
  }

  if (move.isKingsideCastle() || move.isQueensideCastle()) {
    tags.push("Castles the king to safety");
  }

  if (move.isPromotion()) {
    tags.push(`Promotes to a ${PIECE_NAMES[move.promotion]}`);
  }

  if (chess.inCheck()) {
    tags.push("Gives check");
  }

  if (movingPiece.type !== "k" && CENTER_SQUARES.has(to)) {
    tags.push(movingPiece.type === "p" ? "Claims central space" : "Centralizes a piece");
  }

  const homeRank = movingPiece.color === "w" ? "1" : "8";
  const isMinorPiece = movingPiece.type === "n" || movingPiece.type === "b";
  if (isMinorPiece && from[1] === homeRank && moveNumber && moveNumber <= OPENING_MOVE_CUTOFF) {
    tags.push("Develops a piece");
  }

  return tags;
}

export function summarizeTags(tags) {
  if (!tags.length) return "Best available continuation in this position.";
  if (tags.length === 1) return `${tags[0]}.`;
  return `${tags.slice(0, -1).join(", ")} and ${tags[tags.length - 1]}.`;
}
