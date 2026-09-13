import { useState } from "react";

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

  function goBack() {
    setHistoryIndex((prev) => Math.max(0, (prev === null ? liveIndex : prev) - 1));
  }

  function goForward() {
    setHistoryIndex((prev) => {
      if (prev === null) return null;
      const next = prev + 1;
      return next >= liveIndex ? null : next;
    });
  }

  // index is a fen_history index directly (0 = starting position).
  function goToIndex(index) {
    const clamped = Math.max(0, Math.min(index, liveIndex));
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
    canGoBack: currentIndex > 0,
    canGoForward: isViewingHistory,
    goBack,
    goForward,
    goToIndex,
    goLive,
  };
}
