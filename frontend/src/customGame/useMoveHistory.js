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
  const viewingFen = fenHistory[currentIndex] ?? gameState.fen;
  // The move that produced the position currently being viewed (whether
  // that's live or a reviewed past position) - action_log[i] is what
  // produced fen_history[i+1], so the move landing on fen_history[currentIndex]
  // is action_log[currentIndex - 1]. null at the very start position, since
  // nothing produced it.
  const actionLog = gameState.action_log || [];
  const lastMoveSquares = currentIndex > 0 ? parseMoveSquares(actionLog[currentIndex - 1]) : null;
  // Which squares held which evolved/hero piece at the position currently
  // being viewed - see backend's EvolutionSnapshot. Lets a reviewed past
  // position render with the SAME hero-piece art the live position uses,
  // instead of falling back to plain base-type art.
  const evolutionHistory = gameState.evolution_history || [];
  const viewingEvolution = evolutionHistory[currentIndex] || null;

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
