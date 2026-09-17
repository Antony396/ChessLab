import { useEffect, useMemo, useState } from "react";
import { Chessboard } from "react-chessboard";
import { FLAT_2D_BOARD_COLORS, buildPiecesWithEvolutions } from "../../pieces/flat2dPieces";
import { computeLegalDestinations, isArcherShootMove } from "../legalMoves";
import { playCaptureSound, playMoveSound } from "../sound";
import { KING_SKINS } from "../skinStore";
import { fetchHeroMapState, startHeroMapPuzzle, postHeroMapPuzzleMove } from "./api";
import { MAP_NODE_POSITIONS } from "../puzzleMap/mapNodePositions";
import "../puzzleMap/puzzleMap.css";

const DOT_STYLE = { backgroundImage: "radial-gradient(circle, rgba(20,20,20,0.35) 19%, transparent 20%)" };
const RING_STYLE = { boxShadow: "inset 0 0 0 4px rgba(20,20,20,0.35)" };
const SHOOT_RING_STYLE = { boxShadow: "inset 0 0 0 4px rgba(200,60,30,0.6)" };
const CORRECT_FLASH_MS = 260;
const WRONG_FLASH_MS = 320;

// The Hero Puzzle Map: a second 50-node route, structurally identical to
// the original Puzzle Map (see puzzleMap/PuzzleMap.jsx, which this mirrors
// closely - same fetch/attempt-state shape) and, for now, reusing its exact
// map art/node layout too rather than a distinct background. The real
// difference is content: every node here is an original hero-piece puzzle
// hand-authored via POST /hero-puzzle-map/nodes (see backend/app/api/
// hero_puzzle_map_routes.py), so unlike the original map not every slot
// 1-50 necessarily has a puzzle in it yet - an unauthored slot renders
// dimmed and unclickable regardless of sequential unlock status (see
// node.authored below). Node 50 unlocks the Hydra King skin.
export default function HeroPuzzleMap({ token, onExit }) {
  const [phase, setPhase] = useState("loading-map"); // "loading-map" | "route" | "loading-puzzle" | "solving" | "solved" | "error"
  const [mapState, setMapState] = useState(null); // GET /hero-puzzle-map/state response
  const [puzzle, setPuzzle] = useState(null); // POST /hero-puzzle-map/start response
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [legalDestinations, setLegalDestinations] = useState([]);
  const [busy, setBusy] = useState(false);
  const [justUnlockedHydra, setJustUnlockedHydra] = useState(false);

  function loadMapState() {
    setPhase("loading-map");
    fetchHeroMapState(token)
      .then((result) => {
        setMapState(result);
        setPhase("route");
      })
      .catch((e) => {
        setError(e.message);
        setPhase("error");
      });
  }

  useEffect(loadMapState, [token]);

  function openNode(index) {
    setPhase("loading-puzzle");
    setJustUnlockedHydra(false);
    startHeroMapPuzzle(token, index)
      .then((result) => {
        setPuzzle(result);
        setPhase("solving");
      })
      .catch((e) => {
        setError(e.message);
        setPhase("error");
      });
  }

  const game = puzzle?.game;
  const mySide = puzzle?.my_side || "white";
  const myPrefix = mySide === "white" ? "w" : "b";

  const archerSquare = myPrefix === "w" ? game?.white_archer_square : game?.black_archer_square;
  const popeSquare = myPrefix === "w" ? game?.white_pope_square : game?.black_pope_square;
  const dragonSquares = (myPrefix === "w" ? game?.white_dragon_squares : game?.black_dragon_squares) || [];
  const hydraSquares = (myPrefix === "w" ? game?.white_hydra_squares : game?.black_hydra_squares) || [];
  const cyclopsSquares = (myPrefix === "w" ? game?.white_cyclops_squares : game?.black_cyclops_squares) || [];
  const mirrorSquares = (myPrefix === "w" ? game?.white_mirror_squares : game?.black_mirror_squares) || [];
  const opponentLastType = myPrefix === "w" ? game?.black_last_moved_type : game?.white_last_moved_type;
  const mirrorMimicType = opponentLastType ? opponentLastType.toLowerCase() : null;
  const mirrorMimicIsHydra = myPrefix === "w" ? game?.black_last_moved_was_hydra : game?.white_last_moved_was_hydra;
  const mirrorMimicIsArcher = myPrefix === "w" ? game?.black_last_moved_was_archer : game?.white_last_moved_was_archer;
  const mirrorMimicIsPope = myPrefix === "w" ? game?.black_last_moved_was_pope : game?.white_last_moved_was_pope;

  const pieces = useMemo(() => {
    if (!game) return undefined;
    return buildPiecesWithEvolutions({
      whiteDragonSquares: game.white_dragon_squares,
      blackDragonSquares: game.black_dragon_squares,
      whitePopeSquare: game.white_pope_square,
      blackPopeSquare: game.black_pope_square,
      whiteArcherSquare: game.white_archer_square,
      blackArcherSquare: game.black_archer_square,
      whiteHydraSquares: game.white_hydra_squares,
      blackHydraSquares: game.black_hydra_squares,
      whiteCyclopsSquares: game.white_cyclops_squares,
      blackCyclopsSquares: game.black_cyclops_squares,
      whiteMirrorSquares: game.white_mirror_squares,
      blackMirrorSquares: game.black_mirror_squares,
    });
  }, [game]);

  function showLegalDestinationsFor(square) {
    setLegalDestinations(
      computeLegalDestinations({
        fen: game.fen,
        square,
        isDragonSquare: dragonSquares.includes(square),
        isPopeSquare: square === popeSquare,
        isArcherSquare: square === archerSquare,
        isHydraSquare: hydraSquares.includes(square),
        isCyclopsSquare: cyclopsSquares.includes(square),
        isMirrorSquare: mirrorSquares.includes(square),
        mirrorMimicType,
        mirrorMimicIsHydra,
        mirrorMimicIsArcher,
        mirrorMimicIsPope,
        ownPopeSquare: popeSquare,
      })
    );
  }

  function handlePieceDrag({ isSparePiece, square, piece }) {
    if (isSparePiece || !square || phase !== "solving") return;
    if (piece.pieceType[0] !== myPrefix) return;
    setSelectedSquare(square);
    showLegalDestinationsFor(square);
  }

  function handleSquareClick({ piece, square }) {
    if (phase !== "solving") return;
    if (selectedSquare === square || !piece || piece.pieceType[0] !== myPrefix) {
      setSelectedSquare(null);
      setLegalDestinations([]);
      return;
    }
    setSelectedSquare(square);
    showLegalDestinationsFor(square);
  }

  function handlePieceDrop({ sourceSquare, targetSquare, piece }) {
    setLegalDestinations([]);
    setSelectedSquare(null);
    if (!targetSquare || busy || phase !== "solving") return false;
    if (piece.pieceType[0] !== myPrefix) return false;

    const isMirrorArcherMove = mirrorSquares.includes(sourceSquare) && mirrorMimicType === "n" && mirrorMimicIsArcher;
    const shoot =
      (sourceSquare === archerSquare || isMirrorArcherMove) && isArcherShootMove(game.fen, sourceSquare, targetSquare);

    setBusy(true);
    postHeroMapPuzzleMove(token, { from_square: sourceSquare, to_square: targetSquare, shoot })
      .then((result) => {
        setPuzzle((prev) => ({ ...prev, game: result.game }));
        if (result.correct) {
          playMoveSound();
          setFlash("correct");
          window.setTimeout(() => setFlash(null), CORRECT_FLASH_MS);
          if (result.puzzle_solved) {
            playCaptureSound();
            setJustUnlockedHydra(result.unlocked_hydra_skin);
            setPhase("solved");
          }
        } else {
          setFlash("wrong");
          window.setTimeout(() => setFlash(null), WRONG_FLASH_MS);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));

    // Same convention as PuzzleMap.jsx: the server is the only judge of a
    // hero-special move, so nothing is ever guessed optimistically here.
    return false;
  }

  if (phase === "loading-map" || phase === "loading-puzzle") {
    return (
      <div className="puzzle-map">
        <p>Loading…</p>
        <button type="button" className="puzzle-map-back-btn" onClick={onExit}>
          Back to Dorm
        </button>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="puzzle-map">
        <div className="puzzle-map-menu">
          <h1>Hero Puzzles</h1>
          {error && <div className="error-banner">{error}</div>}
          <button type="button" className="puzzle-map-back-btn" onClick={onExit}>
            Back to Dorm
          </button>
        </div>
      </div>
    );
  }

  if (phase === "solved") {
    return (
      <div className="puzzle-map">
        <div className="puzzle-map-menu">
          <h1>Solved!</h1>
          <p>
            Node {puzzle.index} of {mapState.nodes.length} complete.
          </p>
          {justUnlockedHydra && (
            <div className="puzzle-map-unlock-banner">
              <img src={KING_SKINS.hydra.src} alt="" className="puzzle-map-unlock-img" />
              <p>Hydra King skin unlocked!</p>
            </div>
          )}
          <button type="button" className="puzzle-map-back-btn" onClick={loadMapState}>
            Back to Map
          </button>
        </div>
      </div>
    );
  }

  if (phase === "solving") {
    const squareStyles = {};
    for (const { square, capture, shoot: isShoot } of legalDestinations) {
      squareStyles[square] = isShoot ? SHOOT_RING_STYLE : capture ? RING_STYLE : DOT_STYLE;
    }
    const options = {
      position: game.fen,
      boardOrientation: mySide,
      allowDragging: !busy,
      showAnimations: false,
      onPieceDrop: handlePieceDrop,
      onPieceDrag: handlePieceDrag,
      onSquareClick: handleSquareClick,
      squareStyles,
      boardStyle: { borderRadius: "4px" },
      lightSquareStyle: { background: FLAT_2D_BOARD_COLORS.light },
      darkSquareStyle: { background: FLAT_2D_BOARD_COLORS.dark },
      pieces,
    };
    return (
      <div className="puzzle-map">
        <div className="puzzle-map-toolbar">
          <span className="puzzle-map-node-label">Puzzle {puzzle.index}</span>
          <button type="button" onClick={() => setPhase("route")}>
            Back to Map
          </button>
        </div>
        <div className={`puzzle-map-board-wrap${flash ? ` flash-${flash}` : ""}`}>
          <Chessboard options={options} />
        </div>
        {error && <div className="error-banner">{error}</div>}
      </div>
    );
  }

  // phase === "route"
  return (
    <div className="puzzle-map">
      <div className="puzzle-map-toolbar">
        <span className="puzzle-map-node-label">
          {mapState.solved_count} / {mapState.nodes.length} solved
        </span>
        <button type="button" onClick={onExit}>
          Back to Dorm
        </button>
      </div>
      <div className="puzzle-map-atlas">
        <img src="/puzzle-map/map-background.png" alt="" className="puzzle-map-atlas-img" draggable={false} />
        {mapState.nodes.map((node, i) => {
          const pos = MAP_NODE_POSITIONS[i];
          if (!pos) return null;
          const playable = node.unlocked && node.authored;
          return (
            <button
              key={node.index}
              type="button"
              className={`puzzle-map-node${node.solved ? " solved" : ""}${playable ? "" : " locked"}${
                node.is_finale ? " finale" : ""
              }`}
              style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              disabled={!playable}
              onClick={() => openNode(node.index)}
              title={
                !node.authored
                  ? "Not created yet - check back later"
                  : node.is_finale
                    ? "Node 50 - unlocks the Hydra King skin"
                    : `Puzzle ${node.index}`
              }
            >
              {node.is_finale ? (
                <img src={KING_SKINS.hydra.src} alt="" className="puzzle-map-finale-img" />
              ) : (
                <span className="puzzle-map-node-number">{node.index}</span>
              )}
              {node.solved && <span className="puzzle-map-node-check">✓</span>}
              {!playable && <span className="puzzle-map-node-lock">{node.authored ? "🔒" : "…"}</span>}
              {node.is_finale && <span className="puzzle-map-node-star">★</span>}
            </button>
          );
        })}
      </div>
      {error && <div className="error-banner">{error}</div>}
    </div>
  );
}
