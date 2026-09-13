import { useEffect, useRef } from "react";
import { playCheckSound, playCheckmateSound } from "./sound";

// A prominent on-board banner for check/checkmate, on top of the small text
// status label already in each toolbar - reads gameState.in_check/status
// directly rather than re-deriving check itself, since the true check state
// (accounting for a hero piece's extra threat squares) is only computable
// server-side (see backend's _in_check) without duplicating that whole rule
// set in JS.
export default function GameStatusBanner({ status, inCheck, turn, myColor }) {
  // Plays exactly once per transition INTO check or checkmate (never on
  // every render this stays true, and never for either resolving) - a
  // distinct sound each, per both players so it reads as a shared
  // game-state event rather than something only the checked side hears.
  // prevRef starts undefined rather than a hardcoded "in_progress" default
  // so that mounting fresh already in check/checkmate (this banner remounts
  // every time move-history review toggles off - see the callers) never
  // replays the sound for a state that isn't actually new.
  const prevRef = useRef();
  useEffect(() => {
    const prev = prevRef.current;
    if (prev) {
      if (status === "checkmate" && prev.status !== "checkmate") {
        playCheckmateSound();
      } else if (inCheck && !prev.inCheck && status !== "checkmate") {
        playCheckSound();
      }
    }
    prevRef.current = { status, inCheck };
  }, [status, inCheck]);

  if (status === "checkmate") {
    // Checkmate always lands on whoever's turn it currently is (they're the
    // side with no legal moves left) - so that's the loser.
    const iLost = turn === myColor;
    return (
      <div className={`game-status-banner checkmate${iLost ? " lose" : " win"}`}>
        {iLost ? "Checkmate — you lost" : "Checkmate — you won"}
      </div>
    );
  }
  if (status === "stalemate") {
    return <div className="game-status-banner draw">Stalemate — draw</div>;
  }
  if (status === "draw") {
    return <div className="game-status-banner draw">Draw</div>;
  }
  if (inCheck) {
    const imInCheck = turn === myColor;
    return <div className="game-status-banner check">{imInCheck ? "You're in check" : "Check"}</div>;
  }
  return null;
}
