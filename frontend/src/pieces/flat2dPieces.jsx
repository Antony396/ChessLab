// Flat 2D chess-set artwork (cropped from a reference sheet the user
// supplied), used for Hero Chess. Files live in /public so they're served as
// plain static assets - frontend/public/pieces/flat-2d/.

const IMG_STYLE = { display: "block", width: "100%", height: "100%", objectFit: "contain" };

export function pieceImageSrc(pieceKey) {
  return `/pieces/flat-2d/${pieceKey}.png`;
}

function makePiece(pieceKey) {
  const src = pieceImageSrc(pieceKey);
  function Flat2dPiece() {
    return <img src={src} alt={pieceKey} style={IMG_STYLE} draggable={false} />;
  }
  Flat2dPiece.displayName = `Flat2d(${pieceKey})`;
  return Flat2dPiece;
}

export const flat2dPieces = Object.fromEntries(
  ["P", "N", "B", "R", "Q", "K"].flatMap((t) => [
    [`w${t}`, makePiece(`w${t}`)],
    [`b${t}`, makePiece(`b${t}`)],
  ])
);

// A Dragon is stored as a Rook and a Wizard as a Bishop in the FEN
// (python-chess needs a real piece type it understands), so swapping in
// their art has to happen per-square, not per-piece-type. react-chessboard
// passes `square` into every piece render call, so wR/bR and wB/bB here
// check it against the tracked evolved square and pick the right image -
// everything else (including plain Archer squares, which render normally as
// wN/bN reskinned below) renders as usual.
export function buildPiecesWithEvolutions({
  whiteDragonSquare,
  blackDragonSquare,
  whiteWizardSquares = [],
  blackWizardSquares = [],
  whiteArcherSquares = [],
  blackArcherSquares = [],
}) {
  function WhiteRookOrDragon(props) {
    const src = pieceImageSrc(props?.square === whiteDragonSquare ? "wD" : "wR");
    return <img src={src} alt="wR" style={IMG_STYLE} draggable={false} />;
  }
  function BlackRookOrDragon(props) {
    const src = pieceImageSrc(props?.square === blackDragonSquare ? "bD" : "bR");
    return <img src={src} alt="bR" style={IMG_STYLE} draggable={false} />;
  }
  function WhiteBishopOrWizard(props) {
    const src = pieceImageSrc(whiteWizardSquares.includes(props?.square) ? "wW" : "wB");
    return <img src={src} alt="wB" style={IMG_STYLE} draggable={false} />;
  }
  function BlackBishopOrWizard(props) {
    const src = pieceImageSrc(blackWizardSquares.includes(props?.square) ? "bW" : "bB");
    return <img src={src} alt="bB" style={IMG_STYLE} draggable={false} />;
  }
  function WhiteKnightOrArcher(props) {
    const src = pieceImageSrc(whiteArcherSquares.includes(props?.square) ? "wA" : "wN");
    return <img src={src} alt="wN" style={IMG_STYLE} draggable={false} />;
  }
  function BlackKnightOrArcher(props) {
    const src = pieceImageSrc(blackArcherSquares.includes(props?.square) ? "bA" : "bN");
    return <img src={src} alt="bN" style={IMG_STYLE} draggable={false} />;
  }
  return {
    ...flat2dPieces,
    wR: WhiteRookOrDragon,
    bR: BlackRookOrDragon,
    wB: WhiteBishopOrWizard,
    bB: BlackBishopOrWizard,
    wN: WhiteKnightOrArcher,
    bN: BlackKnightOrArcher,
  };
}

// Sampled from the matching board image (scratch_piece_preview2/board.png).
export const FLAT_2D_BOARD_COLORS = { light: "#eee9e0", dark: "#596670" };

// Mirrors backend/app/api/custom_game_routes.py's POINT_COSTS/DRAGON_COST/
// WIZARD_COST/ARCHER_COST/PAWN_COST - keep these in sync if any changes.
export const ARCHER_COST = 4;
export const PAWN_COST = 1;
export const POINT_COSTS = { K: 0, Q: 9, R: 5, B: 3, N: 3, A: ARCHER_COST, P: PAWN_COST };
export const DRAGON_COST = 8;
export const WIZARD_COST = 6;
export const MAX_DECK_POINTS = 31;

export const PALETTE_PIECES = ["K", "Q", "R", "B", "N", "A", "P"];
export const PIECE_LABELS = {
  K: "King",
  Q: "Queen",
  R: "Rook",
  B: "Bishop",
  N: "Knight",
  D: "Dragon",
  W: "Wizard",
  A: "Archer",
  P: "Pawn",
};
