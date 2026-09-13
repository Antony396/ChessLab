import { useMemo } from "react";
import { pieceImageSrc } from "../pieces/flat2dPieces";
import { computeCapturedMaterial } from "./capturedMaterial";

// One row: the small icons for everything captured, in whatever color those
// captured pieces actually were, plus a "+N" material-lead badge when this
// row's side is ahead on points.
function CapturedRow({ entries, capturedColor, materialLead }) {
  return (
    <div className="captured-row">
      {entries.map((e) => (
        <span key={e.kind} className="captured-piece-group">
          <img src={pieceImageSrc(`${capturedColor}${e.icon}`)} alt="" className="captured-piece-icon" />
          {e.count > 1 && <span className="captured-piece-count">×{e.count}</span>}
        </span>
      ))}
      {materialLead > 0 && <span className="captured-material-lead">+{materialLead}</span>}
    </div>
  );
}

// chess.com-style captured-piece tray, split into two independently
// placeable rows - "mine" (what I've taken from my opponent) and "theirs"
// (what they've taken from me) - since the two need to land in different
// spots relative to the board (mine near my own side, theirs near
// opponent's), not stacked together in one fixed block. A hook rather than
// a plain component for exactly that reason: it hands back JSX for the
// caller to place, instead of rendering its own fixed layout.
export function useCapturedRows(gameState, myColor) {
  const { whiteCaptured, blackCaptured, materialDiff } = useMemo(() => computeCapturedMaterial(gameState), [gameState]);
  const isWhite = myColor === "white";
  // whiteCaptured = pieces WHITE captured (all originally BLACK pieces, so
  // rendered in black's art); blackCaptured = pieces BLACK captured (all
  // originally WHITE pieces, rendered in white's art).
  const myCaptured = isWhite ? whiteCaptured : blackCaptured;
  const theirCaptured = isWhite ? blackCaptured : whiteCaptured;
  const myLead = isWhite ? materialDiff : -materialDiff;

  return {
    mine: <CapturedRow entries={myCaptured} capturedColor={isWhite ? "b" : "w"} materialLead={Math.max(0, myLead)} />,
    theirs: (
      <CapturedRow entries={theirCaptured} capturedColor={isWhite ? "w" : "b"} materialLead={Math.max(0, -myLead)} />
    ),
  };
}
