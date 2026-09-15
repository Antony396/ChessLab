import { useState } from "react";
import { playForwardSound, playRewindSound } from "./sound";

// Every action_log entry (see backend/app/api/custom_game_routes.py's
// _apply_move) starts with "{from}-{to}" or, for an Archer's non-relocating
// shoot, "{from} shoots {to}" - optionally followed by ": Label" or a
// trailing " (AI)". This grabs just the two square names regardless of
// which shape produced them, for the last-move highlight below.
function parseMoveSquares(logEntry) {
  if (!logEntry) return null;
  const match = logEntry.match(/^([a-h][1-8])(?:-|\s+shoots\s+)([a-h][1-8])/);
  return match ? { from: match[1], to: match[2] } : null;
}

// Chess.com-style back/forward review of past positions, driven entirely by
// gameState.fen_history (one FEN per position the board has actually been
// in, oldest first - see backend's CustomGame.fen_history). historyIndex
// null means "live" - tracking whatever the current game state actually is,
// including a move that lands while reviewing (which does NOT yank the
// viewer back to live, same as chess.com). Reaching the live position by
// paging forward resets to null rather than staying pinned to a fixed
// index, so a fresh move immediately becomes visible without an extra click.
export function useMoveHistory(gameState) {
  const [historyIndex, setHistoryIndex] = useState(null);
  const fenHistory = gameState.fen_history || [];
  const liveIndex = fenHistory.length - 1;
  const currentIndex = historyIndex === null ? liveIndex : Math.min(historyIndex, liveIndex);
  const isViewingHistory = historyIndex !== null && currentIndex < liveIndex;
  // While live (not reviewing a past position), read gameState directly
  // rather than through fen_history - that array only grows once the
  // SERVER confirms a move, one full round trip after the optimistic
  // update (see CustomGamePlay.jsx/OnlineGamePlay.jsx's handlePieceDrop)
  // already updated gameState.fen and the hero-tracking-squares fields
  // together. Deriving the live position from fen_history instead left the
  // board frozen at the pre-move position for the length of that round
  // trip - invisible on localhost's near-zero latency, very visible over a
  // real network - and worse, left it mismatched against the
  // ALREADY-updated tracking squares in the meantime: a Mirror/Dragon/etc
  // sitting at its old (pre-move) square with its new square already
  // claimed by the tracking-squares update reads as "not a hero square
  // anymore" to the art lookup, so it flashed as its plain base piece
  // until the board caught up.
  const viewingFen = isViewingHistory ? (fenHistory[currentIndex] ?? gameState.fen) : gameState.fen;
  const actionLog = gameState.action_log || [];
  // The move that produced the position currently being viewed. While
  // live, that's simply the most recent action_log entry - not
  // action_log[currentIndex - 1], which has the same staleness problem as
  // fen_history above (action_log is also only ever appended to by a
  // confirmed server response).
  const lastMoveSquares = isViewingHistory
    ? currentIndex > 0
      ? parseMoveSquares(actionLog[currentIndex - 1])
      : null
    : parseMoveSquares(actionLog[actionLog.length - 1]);
  // Which squares held which evolved/hero piece at the position currently
  // being viewed - see backend's EvolutionSnapshot. Lets a reviewed past
  // position render with the SAME hero-piece art the live position uses,
  // instead of falling back to plain base-type art. Only meaningful while
  // actually reviewing - the live position already renders hero art
  // straight from gameState's own (instantly-updated) tracking-squares
  // fields, not through this snapshot history at all.
  const evolutionHistory = gameState.evolution_history || [];
  const viewingEvolution = isViewingHistory ? evolutionHistory[currentIndex] || null : null;

  function goBack() {
    setHistoryIndex((prev) => {
      const from = prev === null ? liveIndex : prev;
      const next = Math.max(0, from - 1);
      if (next < from) playRewindSound();
      return next;
    });
  }

  function goForward() {
    setHistoryIndex((prev) => {
      if (prev === null) return null;
      const next = prev + 1;
      playForwardSound();
      return next >= liveIndex ? null : next;
    });
  }

  // index is a fen_history index directly (0 = starting position). Plays
  // the matching rewind/forward sound based on which direction this jump
  // actually moves - not on a no-op re-click of the already-current entry.
  function goToIndex(index) {
    const clamped = Math.max(0, Math.min(index, liveIndex));
    if (clamped < currentIndex) playRewindSound();
    else if (clamped > currentIndex) playForwardSound();
    setHistoryIndex(clamped >= liveIndex ? null : clamped);
  }

  function goLive() {
    setHistoryIndex(null);
  }

  return {
    viewingFen,
    isViewingHistory,
    currentIndex,
    liveIndex,
    lastMoveSquares,
    viewingEvolution,
    canGoBack: currentIndex > 0,
    canGoForward: isViewingHistory,
    goBack,
    goForward,
    goToIndex,
    goLive,
  };
}
