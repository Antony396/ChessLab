import { Chessboard } from "react-chessboard";
import EvalBadge from "./EvalBadge";
import { BOARD_THEMES } from "../theme";
import { glassPieces } from "../pieces/glassPieces";

const DEFAULT_BOARD_STYLE = { borderRadius: "10px", boxShadow: "0 10px 30px rgba(0,0,0,0.25)" };

// When showing the full path, later moves fade toward blue so the sequence
// reads as an order rather than a pile of same-weight arrows.
const PATH_COLORS = [
  "rgba(21, 128, 61, 0.9)",
  "rgba(37, 99, 235, 0.75)",
  "rgba(37, 99, 235, 0.55)",
  "rgba(37, 99, 235, 0.4)",
  "rgba(37, 99, 235, 0.28)",
];

export default function BoardViewer({
  positions,
  currentPly,
  setCurrentPly,
  orientation,
  evalCp,
  bestMoveUci,
  pathArrows,
  themeKey,
  onThemeChange,
}) {
  const fen = positions[currentPly];
  const maxPly = positions.length - 1;
  const theme = BOARD_THEMES[themeKey];

  let arrows = [];
  if (pathArrows && pathArrows.length) {
    arrows = pathArrows.map((a, i) => ({
      startSquare: a.startSquare,
      endSquare: a.endSquare,
      color: PATH_COLORS[Math.min(i, PATH_COLORS.length - 1)],
    }));
  } else if (bestMoveUci) {
    arrows = [
      {
        startSquare: bestMoveUci.slice(0, 2),
        endSquare: bestMoveUci.slice(2, 4),
        color: "rgba(21, 128, 61, 0.85)",
      },
    ];
  }

  const options = {
    position: fen,
    boardOrientation: orientation,
    allowDragging: false,
    showAnimations: false,
    lightSquareStyle: { background: theme.light },
    darkSquareStyle: { background: theme.dark },
    boardStyle: theme.boardStyle ?? DEFAULT_BOARD_STYLE,
    pieces: theme.pieces === "glass" ? glassPieces : undefined,
    arrows,
  };

  return (
    <div className="board-viewer">
      <div className="board-toolbar">
        <span className="board-toolbar-group">
          <label htmlFor="board-theme">Board theme</label>
          <select id="board-theme" value={themeKey} onChange={(e) => onThemeChange(e.target.value)}>
            {Object.entries(BOARD_THEMES).map(([key, t]) => (
              <option key={key} value={key}>
                {t.name}
              </option>
            ))}
          </select>
        </span>
        <EvalBadge cp={evalCp} />
      </div>

      <div className="board-wrap">
        <Chessboard options={options} />
      </div>

      <div className="board-controls">
        <button onClick={() => setCurrentPly(0)} disabled={currentPly === 0}>
          |&lt;
        </button>
        <button onClick={() => setCurrentPly((p) => Math.max(0, p - 1))} disabled={currentPly === 0}>
          &lt;
        </button>
        <span>
          {currentPly} / {maxPly}
        </span>
        <button onClick={() => setCurrentPly((p) => Math.min(maxPly, p + 1))} disabled={currentPly === maxPly}>
          &gt;
        </button>
        <button onClick={() => setCurrentPly(maxPly)} disabled={currentPly === maxPly}>
          &gt;|
        </button>
      </div>
    </div>
  );
}
