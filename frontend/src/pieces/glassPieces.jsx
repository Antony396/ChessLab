import { PIECE_SHAPES } from "./pieceShapes";
import "./glassPieces.css";

const TYPE_LETTERS = { P: "P", N: "N", B: "B", R: "R", Q: "Q", K: "K" };

function GlassPiece({ typeLetter, isWhite }) {
  const shape = PIECE_SHAPES[typeLetter];
  const fillUrl = isWhite ? "url(#glass-white-fill)" : "url(#glass-black-fill)";
  const rimStroke = isWhite ? "rgba(255,255,255,0.75)" : "rgba(196,178,255,0.4)";
  const lineStroke = isWhite ? "rgba(80,70,120,0.55)" : "rgba(220,210,255,0.5)";

  return (
    <div className="glass-piece">
      <svg viewBox="0 0 45 45" width="100%" height="100%">
        {shape.body.map((d, i) => (
          <path
            key={i}
            d={d}
            fill={fillUrl}
            stroke={rimStroke}
            strokeWidth="1.1"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {shape.lines.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={lineStroke}
            strokeWidth="1"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        <ellipse
          cx="18"
          cy="15"
          rx="7"
          ry="4"
          fill="url(#glass-shine)"
          opacity="0.7"
          filter="url(#glass-blur-soft)"
          transform="rotate(-30 18 15)"
        />
      </svg>
    </div>
  );
}

function makeGlassPiece(pieceKey) {
  const isWhite = pieceKey[0] === "w";
  const typeLetter = TYPE_LETTERS[pieceKey[1]];
  function Piece() {
    return <GlassPiece typeLetter={typeLetter} isWhite={isWhite} />;
  }
  Piece.displayName = `Glass(${pieceKey})`;
  return Piece;
}

export const glassPieces = Object.fromEntries(
  ["P", "N", "B", "R", "Q", "K"].flatMap((t) => [
    [`w${t}`, makeGlassPiece(`w${t}`)],
    [`b${t}`, makeGlassPiece(`b${t}`)],
  ])
);
