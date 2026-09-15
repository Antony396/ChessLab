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

// A Dragon is stored as a Rook, a Pope/Mirror as a Bishop, a Hydra/Archer as
// a Knight, and a Cyclops as a Pawn in the FEN (python-chess needs a real
// piece type it understands), so swapping in their art has to happen
// per-square, not per-piece-type. react-chessboard passes `square` into
// every piece render call, so the overrides below check it against each
// tracked hero-squares list and pick the right image - everything else
// renders as usual.
//
// The Pope and Archer reuse the OLD Archer/Wizard art files rather than
// needing new assets: since only evolution outputs used to get more
// detailed art than a plain piece, and now Archer and Pope are the two
// evolution outputs, the Pope wears the old Archer's skin ("wA"/"bA") and
// the Archer wears the old Wizard's skin ("wW"/"bW") - a straight swap, no
// new art required.
export function buildPiecesWithEvolutions({
  whiteDragonSquares = [],
  blackDragonSquares = [],
  whitePopeSquare,
  blackPopeSquare,
  whiteArcherSquare,
  blackArcherSquare,
  whiteHydraSquares = [],
  blackHydraSquares = [],
  whiteCyclopsSquares = [],
  blackCyclopsSquares = [],
  whiteMirrorSquares = [],
  blackMirrorSquares = [],
  // Cosmetic King skin overrides (see customGame/skinStore.js) - defaults to
  // the classic art when a caller doesn't care about skins at all.
  whiteKingSkinSrc,
  blackKingSkinSrc,
}) {
  function WhiteKing() {
    return <img src={whiteKingSkinSrc || pieceImageSrc("wK")} alt="wK" style={IMG_STYLE} draggable={false} />;
  }
  function BlackKing() {
    return <img src={blackKingSkinSrc || pieceImageSrc("bK")} alt="bK" style={IMG_STYLE} draggable={false} />;
  }
  function WhiteRookOrDragon(props) {
    const src = pieceImageSrc(whiteDragonSquares.includes(props?.square) ? "wD" : "wR");
    return <img src={src} alt="wR" style={IMG_STYLE} draggable={false} />;
  }
  function BlackRookOrDragon(props) {
    const src = pieceImageSrc(blackDragonSquares.includes(props?.square) ? "bD" : "bR");
    return <img src={src} alt="bR" style={IMG_STYLE} draggable={false} />;
  }
  function WhiteBishopOrPopeOrMirror(props) {
    const sq = props?.square;
    const key = sq === whitePopeSquare ? "wA" : whiteMirrorSquares.includes(sq) ? "wM" : "wB";
    return <img src={pieceImageSrc(key)} alt="wB" style={IMG_STYLE} draggable={false} />;
  }
  function BlackBishopOrPopeOrMirror(props) {
    const sq = props?.square;
    const key = sq === blackPopeSquare ? "bA" : blackMirrorSquares.includes(sq) ? "bM" : "bB";
    return <img src={pieceImageSrc(key)} alt="bB" style={IMG_STYLE} draggable={false} />;
  }
  function WhiteKnightOrArcherOrHydra(props) {
    const sq = props?.square;
    const key = whiteHydraSquares.includes(sq) ? "wH" : sq === whiteArcherSquare ? "wW" : "wN";
    return <img src={pieceImageSrc(key)} alt="wN" style={IMG_STYLE} draggable={false} />;
  }
  function BlackKnightOrArcherOrHydra(props) {
    const sq = props?.square;
    const key = blackHydraSquares.includes(sq) ? "bH" : sq === blackArcherSquare ? "bW" : "bN";
    return <img src={pieceImageSrc(key)} alt="bN" style={IMG_STYLE} draggable={false} />;
  }
  function WhitePawnOrCyclops(props) {
    const src = pieceImageSrc(whiteCyclopsSquares.includes(props?.square) ? "wC" : "wP");
    return <img src={src} alt="wP" style={IMG_STYLE} draggable={false} />;
  }
  function BlackPawnOrCyclops(props) {
    const src = pieceImageSrc(blackCyclopsSquares.includes(props?.square) ? "bC" : "bP");
    return <img src={src} alt="bP" style={IMG_STYLE} draggable={false} />;
  }
  return {
    ...flat2dPieces,
    wK: WhiteKing,
    bK: BlackKing,
    wR: WhiteRookOrDragon,
    bR: BlackRookOrDragon,
    wB: WhiteBishopOrPopeOrMirror,
    bB: BlackBishopOrPopeOrMirror,
    wN: WhiteKnightOrArcherOrHydra,
    bN: BlackKnightOrArcherOrHydra,
    wP: WhitePawnOrCyclops,
    bP: BlackPawnOrCyclops,
  };
}

// Sampled from the matching board image (scratch_piece_preview2/board.png).
export const FLAT_2D_BOARD_COLORS = { light: "#eee9e0", dark: "#596670" };

// Mirrors backend/app/api/custom_game_routes.py's POINT_COSTS/DRAGON_COST/
// POPE_COST/ARCHER_COST/HYDRA_COST/CYCLOPS_COST/MIRROR_COST/PAWN_COST - keep
// these in sync if any changes.
export const DRAGON_COST = 8;
export const HYDRA_COST = 12;
export const CYCLOPS_COST = 2;
export const MIRROR_COST = 5;
export const PAWN_COST = 1;
export const POINT_COSTS = {
  K: 0,
  Q: 9,
  R: 5,
  B: 3,
  N: 3,
  D: DRAGON_COST,
  H: HYDRA_COST,
  C: CYCLOPS_COST,
  M: MIRROR_COST,
  P: PAWN_COST,
};
export const ARCHER_COST = 6;
export const POPE_COST = 6;
export const MAX_DECK_POINTS = 31;

export const PALETTE_PIECES = ["K", "Q", "R", "B", "N", "D", "H", "C", "M", "P"];
export const PIECE_LABELS = {
  K: "King",
  Q: "Queen",
  R: "Rook",
  B: "Bishop",
  N: "Knight",
  D: "Dragon",
  A: "Archer",
  H: "Hydra",
  C: "Cyclops",
  M: "Mirror",
  P: "Pawn",
  Pope: "Pope",
};
