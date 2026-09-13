import { useEffect, useMemo, useState } from "react";
import {
  DRAGON_COST,
  MAX_DECK_POINTS,
  PALETTE_PIECES,
  PIECE_LABELS,
  POINT_COSTS,
  WIZARD_COST,
  pieceImageSrc,
} from "../pieces/flat2dPieces";
import { postCustomSetup, postOnlineCreate, postOnlineRoomJoin } from "./api";
import { deleteSavedDeck, listSavedDecks, saveDeckToSlot } from "./deckApi";
import { KING_SKINS, useEquippedSkin } from "./skinStore";
import { postSimulSubmit } from "./social/api";

const FILES = "abcdefgh";
const KING_HOME_INDEX = 4; // e-file, the King's regular starting square
const DRAFTABLE_PIECES = PALETTE_PIECES.filter((letter) => letter !== "K");

// Nothing locked right now - kept as a set (rather than deleted outright)
// so a piece can be pulled out of rotation again without re-adding the
// locking machinery from scratch.
const LOCKED_PIECES = new Set();

// White's back rank is always rank 1; joining as black (see `joinMode`
// below) drafts onto rank 8 instead - same board, same slots, just the
// other side's home rank.
function squareFor(slotIndex, rank = "1") {
  return `${FILES[slotIndex]}${rank}`;
}

// Standard chess coloring: a1 is dark. file 0-indexed (a=0), rankRow 0 = rank
// 1 (the back rank), rankRow 1 = rank 2 (the pawns).
function isDarkSquare(fileIndex, rankRow) {
  return (fileIndex + rankRow) % 2 === 0;
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" strokeLinecap="round" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3">
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}

function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="none">
      <path d="M4 18h16l1-9-5 3-4-6-4 6-5-3 1 9z" />
    </svg>
  );
}

function QuestionIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M9 9a3 3 0 1 1 4.5 2.6c-.9.5-1.5 1-1.5 2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="17.5" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

function PawnSquare({ dark }) {
  return (
    <div className={`chess-square pawn-square${dark ? " dark" : " light"}`}>
      <span className="lock-badge" title="Pawns are fixed on rank 2">
        <LockIcon />
      </span>
      <img src={pieceImageSrc("wP")} alt="Pawn" className="deck-slot-img" />
    </div>
  );
}

function DeckSlot({ letter, file, dark, isEvolution, isKing, isDragTarget, kingSkinSrc, onClick, onDragStart, onDragEnd, onDragOver, onDrop }) {
  const isDragon = isEvolution && letter === "N";
  const isWizard = isEvolution && letter === "B";
  const evolvedCost = isDragon ? DRAGON_COST : isWizard ? WIZARD_COST : null;
  const cost = letter ? evolvedCost ?? POINT_COSTS[letter] ?? 0 : null;
  const label = letter ? (isDragon ? "Dragon" : isWizard ? "Wizard" : PIECE_LABELS[letter]) : "";
  const imageKey = isDragon ? "wD" : isWizard ? "wW" : `w${letter}`;
  // The King's slot always shows whatever skin is currently equipped (see
  // customGame/skinStore.js) - kept in sync with the hub avatar and the
  // actual game board.
  const imageSrc = isKing && kingSkinSrc ? kingSkinSrc : pieceImageSrc(imageKey);

  return (
    <button
      type="button"
      className={`chess-square deck-slot${dark ? " dark" : " light"}${isEvolution ? " evolution" : ""}${letter ? " filled" : ""}${isKing ? " king" : ""}${isDragTarget ? " drag-target" : ""}`}
      onClick={onClick}
      draggable={Boolean(letter)}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <span className="file-watermark">{file}</span>
      {isEvolution && <span className="evolution-ribbon">EVO</span>}
      {isKing && (
        <span className="lock-badge king-badge" title="Always exactly one King - drag to reposition">
          <CrownIcon />
        </span>
      )}
      {letter ? (
        <img src={imageSrc} alt={label} className="deck-slot-img" />
      ) : (
        <span className="deck-slot-placeholder">+</span>
      )}
      {label && (
        <span className="card-name-row">
          <span className="deck-slot-label">{label}</span>
          {cost !== null && <span className="cost-badge">{cost}</span>}
        </span>
      )}
    </button>
  );
}

const EVOLUTION_ART = { N: "wD", B: "wW" };
const EVOLUTION_NAME = { N: "Dragon", B: "Wizard" };
// Short text for the palette card's corner badge - a Bishop evolution
// crafts 2 Wizards at once, a Knight evolution crafts 1 Dragon.
const EVOLUTION_BADGE_LABEL = { N: "EVO", B: "2× EVO" };

// --- Small per-piece movement demos -------------------------------------
// A compact grid centered on the piece, with dots marking every square it
// could reach from there - replaces a wall of explanatory text with
// something a player can actually look at.
const KING_STEP_OFFSETS = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
];
const KNIGHT_OFFSETS = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const DEMO_RADIUS = 3;
const DEMO_SIZE = DEMO_RADIUS * 2 + 1;

function slidingOffsets(dirs) {
  const offsets = [];
  for (const [df, dr] of dirs) {
    for (let step = 1; step <= DEMO_RADIUS; step++) offsets.push([df * step, dr * step]);
  }
  return offsets;
}

// A Cyclops's one EXTRA special-capture square (two diagonally
// forward-left) - on top of, not instead of, a real Pawn's plain
// one-square diagonal capture in both directions.
const CYCLOPS_CAPTURE_OFFSET = [[-2, 2]];

// The other 8 squares at Chebyshev distance 2 (straight or diagonal, two
// out) - together with KNIGHT_OFFSETS these form the Hydra's full ring. It
// never moves just one square, unlike a King.
const HYDRA_RING_EXTRA_OFFSETS = [
  [-2, -2], [-2, 0], [-2, 2], [0, -2], [0, 2], [2, -2], [2, 0], [2, 2],
];

const DEMO_MOVE_OFFSETS = {
  Q: [...slidingOffsets(ROOK_DIRS), ...slidingOffsets(BISHOP_DIRS)],
  R: slidingOffsets(ROOK_DIRS),
  B: slidingOffsets(BISHOP_DIRS),
  N: KNIGHT_OFFSETS,
  A: KING_STEP_OFFSETS,
  H: [...KNIGHT_OFFSETS, ...HYDRA_RING_EXTRA_OFFSETS],
  C: [[0, 1], [0, 2]],
  P: [[0, 1], [0, 2]],
};
const DEMO_SHOOT_OFFSETS = {
  A: KNIGHT_OFFSETS,
  C: [[-1, 1], [1, 1], ...CYCLOPS_CAPTURE_OFFSET],
  P: [[-1, 1], [1, 1]],
};
const DEMO_CAPTIONS = {
  Q: "Moves any distance in a straight line or diagonal.",
  R: "Moves any distance in a straight line.",
  B: "Moves any distance diagonally.",
  N: "Jumps in an L-shape, over other pieces.",
  A: "Moves one square any direction (dots), or shoots a piece a knight's-move away without moving (rings).",
  H: "Jumps to any square exactly two squares away - straight, diagonal, or a knight's L-shape - forming a full ring around it. It can never move just one square, unlike a King.",
  C: "Moves forward like a Pawn (dots) and captures diagonally like one too (near rings) - plus one extra trick: a two-square hop diagonally to its own left (far ring).",
  M: "Has no moves of its own - it moves exactly like whatever piece your opponent moved last. If they move a Knight, your Mirror can move like a Knight on your next turn. Before they've moved anything, it can't move yet.",
  P: "Moves forward (dots, two squares from its own start), captures diagonally (rings). On the back rank it starts blocked by the pawn ahead of it, until that one's gone.",
};

function MiniDemoBoard({ letter, moveOffsets, shootOffsets = [] }) {
  const cells = [];
  for (let row = 0; row < DEMO_SIZE; row++) {
    for (let col = 0; col < DEMO_SIZE; col++) {
      const df = col - DEMO_RADIUS;
      const dr = DEMO_RADIUS - row;
      const isCenter = df === 0 && dr === 0;
      const isMove = !isCenter && moveOffsets.some(([mf, mr]) => mf === df && mr === dr);
      const isShoot = !isCenter && shootOffsets.some(([mf, mr]) => mf === df && mr === dr);
      const dark = (row + col) % 2 === 1;
      cells.push(
        <div key={`${row}-${col}`} className={`demo-cell${dark ? " dark" : " light"}`}>
          {isCenter && <img src={pieceImageSrc(`w${letter}`)} alt="" className="demo-piece-img" />}
          {isMove && <span className="demo-dot" />}
          {isShoot && <span className="demo-ring" />}
        </div>
      );
    }
  }
  return <div className="mini-demo-board">{cells}</div>;
}

const DEMO_CELL_PX = 20;

// Pieces with more than one distinct movement mode - this cycles a small
// traveling token from the center square out to every destination of the
// current mode (pausing there, then hopping back to center) before moving
// on to the next mode, so every mode gets an actual animated demonstration.
// A "ring"-style mode (the Archer's shoot) never relocates the piece, so its
// destinations flash in place instead of the piece art sliding out to them.
// The full set of destinations from EVERY mode stays dotted/ringed on the
// board throughout, so switching modes only changes what's animating, never
// what's visible - you always see the whole picture.
const PIECE_DEMO_ART = { N: "wD", B: "wW", A: "wA" };
const PIECE_DEMO_MODES = {
  N: [
    { label: "Moves like a Rook…", offsets: slidingOffsets(ROOK_DIRS), style: "dot" },
    { label: "…and like a Knight", offsets: KNIGHT_OFFSETS, style: "dot" },
  ],
  B: [
    { label: "Moves like a Bishop…", offsets: slidingOffsets(BISHOP_DIRS), style: "dot" },
    { label: "…and one square like a King", offsets: KING_STEP_OFFSETS, style: "dot" },
  ],
  A: [
    { label: "Moves one square any direction…", offsets: KING_STEP_OFFSETS, style: "dot" },
    { label: "…or shoots a knight's-move away without moving", offsets: KNIGHT_OFFSETS, style: "ring" },
  ],
};

function AnimatedPieceDemo({ letter }) {
  const modes = PIECE_DEMO_MODES[letter] || [];
  const [modeIndex, setModeIndex] = useState(0);
  const [offsetIndex, setOffsetIndex] = useState(0);
  const [atTarget, setAtTarget] = useState(false);

  const currentMode = modes[modeIndex];
  const offsets = currentMode?.offsets || [];
  const currentStyle = currentMode?.style || "dot";

  useEffect(() => {
    setOffsetIndex(0);
    setAtTarget(false);
  }, [modeIndex]);

  useEffect(() => {
    if (offsets.length === 0) return undefined;
    const id = setInterval(() => {
      setAtTarget((wasAtTarget) => {
        if (wasAtTarget) {
          setOffsetIndex((prevIndex) => {
            const next = prevIndex + 1;
            if (next >= offsets.length) {
              setModeIndex((m) => (m + 1) % modes.length);
              return 0;
            }
            return next;
          });
          return false;
        }
        return true;
      });
    }, 550);
    return () => clearInterval(id);
  }, [offsets.length, modes.length]);

  const artKey = PIECE_DEMO_ART[letter] || `w${letter}`;
  const target = offsets[offsetIndex] || [0, 0];
  const targetTranslate = `translate(${target[0] * DEMO_CELL_PX}px, ${-target[1] * DEMO_CELL_PX}px)`;
  const travelerStyle = {
    transform: currentStyle === "dot" && atTarget ? targetTranslate : "translate(0, 0)",
  };
  const flashStyle = {
    transform: targetTranslate,
    opacity: currentStyle === "ring" && atTarget ? 1 : 0,
  };

  // Every mode's destinations stay marked at once - only the traveler/flash
  // (which one is currently demonstrated) changes as modes cycle.
  const allMarks = [];
  modes.forEach((mode) => {
    mode.offsets.forEach(([f, r]) => allMarks.push({ f, r, style: mode.style || "dot" }));
  });

  const cells = [];
  for (let row = 0; row < DEMO_SIZE; row++) {
    for (let col = 0; col < DEMO_SIZE; col++) {
      const df = col - DEMO_RADIUS;
      const dr = DEMO_RADIUS - row;
      const isCenter = df === 0 && dr === 0;
      const marksHere = isCenter ? [] : allMarks.filter((m) => m.f === df && m.r === dr);
      const dark = (row + col) % 2 === 1;
      cells.push(
        <div key={`${row}-${col}`} className={`demo-cell${dark ? " dark" : " light"}`}>
          {marksHere.some((m) => m.style === "dot") && <span className="demo-dot faint" />}
          {marksHere.some((m) => m.style === "ring") && <span className="demo-ring faint" />}
        </div>
      );
    }
  }

  return (
    <div className="animated-piece-demo">
      <div className="mini-demo-board">
        {cells}
        <img src={pieceImageSrc(artKey)} alt="" className="demo-traveler" style={travelerStyle} />
        <span className="demo-flash-ring" style={flashStyle} />
      </div>
      <p className="piece-demo-caption">{currentMode?.label}</p>
    </div>
  );
}

function EvoSlotDragDemo() {
  return (
    <div className="evo-help-drag-demo">
      <div className="evo-help-track">
        <img src={pieceImageSrc("wN")} alt="" className="evo-help-drag-icon knight" />
        <img src={pieceImageSrc("wB")} alt="" className="evo-help-drag-icon bishop" />
        <span className="evo-help-target">+</span>
      </div>
      <p className="piece-demo-caption">Drag a Knight or Bishop card here. Knight → 1 Dragon. Bishop → 2 Wizards.</p>
    </div>
  );
}

function PaletteCard({ letter, locked, expanded, onDragStart, onDragEnd, onToggleDemo }) {
  const evolvesInto = EVOLUTION_ART[letter];
  const tooltip = locked
    ? "Locked for now"
    : `${PIECE_LABELS[letter]}: ${DEMO_CAPTIONS[letter] || `Costs ${POINT_COSTS[letter]} points.`}`;
  return (
    <div
      className={`palette-card${locked ? " locked" : ""}${expanded ? " expanded" : ""}`}
      draggable={!locked}
      onDragStart={locked ? undefined : onDragStart}
      onDragEnd={locked ? undefined : onDragEnd}
      title={tooltip}
    >
      <span className="cost-badge palette-card-cost-badge">{POINT_COSTS[letter]}</span>
      {locked ? (
        <span className="lock-badge" title="Locked for now">
          <LockIcon />
        </span>
      ) : (
        evolvesInto && (
          <span className="evo-badge" title={`Drag onto the Evo Slot to craft a ${EVOLUTION_NAME[letter]}`}>
            <span className="evo-badge-text">{EVOLUTION_BADGE_LABEL[letter]}</span>
          </span>
        )
      )}
      <button
        type="button"
        className="palette-card-help-btn"
        onClick={onToggleDemo}
        title={`See how the ${PIECE_LABELS[letter]} moves`}
      >
        <QuestionIcon />
      </button>
      <span className="palette-card-icon">
        <img src={pieceImageSrc(`w${letter}`)} alt={PIECE_LABELS[letter]} className="palette-card-img" />
      </span>
      <span className="palette-card-label">{PIECE_LABELS[letter]}</span>
    </div>
  );
}

function EvoSlotBox({ evoSlotType, remaining, onDragOver, onDrop, onDragStartPiece, onDragEndPiece, onReset }) {
  const [showDemo, setShowDemo] = useState(false);
  const depleted = evoSlotType !== null && remaining === 0;
  const pieceArt = evoSlotType === "N" ? "wD" : "wW";
  const pieceName = evoSlotType === "N" ? "Dragon" : "Wizard";

  // The recipe changing (crafted, reset, depleted) makes the previous demo
  // stale - close it rather than leave a mismatched panel open.
  useEffect(() => {
    setShowDemo(false);
  }, [evoSlotType]);

  return (
    <div className="evo-orb-box" onDragOver={onDragOver} onDrop={onDrop}>
      {showDemo && (
        <div className="evo-help-panel">
          {evoSlotType ? <AnimatedPieceDemo letter={evoSlotType} /> : <EvoSlotDragDemo />}
        </div>
      )}

      <div className="evo-orb-box-header">
        <span className="evo-orb-box-title">Evo Slot</span>
        <button
          type="button"
          className="evo-help-btn"
          onClick={() => setShowDemo((v) => !v)}
          title={evoSlotType ? `See how the ${pieceName} moves` : "See how the Evo Slot works"}
        >
          <QuestionIcon />
        </button>
      </div>

      {!evoSlotType ? (
        <div className="evo-orb-box-empty">
          <span className="evo-socket-ring" aria-hidden="true" />
          <span className="deck-slot-placeholder">+</span>
          <p className="evo-socket-hint">Drag an EVO-eligible piece here</p>
        </div>
      ) : (
        <div className={`evo-slot-content${depleted ? " depleted" : ""}`}>
          <span className="evo-slot-qty-badge">{remaining}×</span>
          <button
            type="button"
            className="evo-slot-reset-btn"
            onClick={onReset}
            title="Change evolution - clears any placed on your deck"
          >
            <XIcon />
          </button>
          <img
            src={pieceImageSrc(pieceArt)}
            alt={pieceName}
            className="evo-slot-piece-img"
            draggable={remaining > 0}
            onDragStart={remaining > 0 ? onDragStartPiece : undefined}
            onDragEnd={remaining > 0 ? onDragEndPiece : undefined}
            onClick={() => setShowDemo((v) => !v)}
            title={
              (remaining > 0 ? `Drag your ${pieceName} onto an open deck square. ` : `All ${pieceName}s placed. `) +
              `Click to see how it moves.`
            }
          />
          <span className="evo-slot-piece-label">{pieceName}</span>
        </div>
      )}
    </div>
  );
}

export default function DeckBuilder({
  onGameStarted,
  onOnlineGameCreated,
  joinMode,
  roomId,
  onOnlineDeckSubmitted,
  simulRoom,
  onSimulWaiting,
  onSimulGameReady,
  // Only passed for the standalone usages (a join link, a friend challenge) -
  // the hub-triggered station overlay already has its own "×" close button
  // wrapping this component, so it doesn't pass one to avoid a duplicate.
  onExit,
  // Needed for the saved-deck slots (server-side, per account) below -
  // every DeckBuilder usage is already inside an authenticated session
  // (see HeroChessApp.jsx), so this is always available.
  token,
}) {
  // A friend challenge drafts on whichever rank actually matches my color
  // in that room (White = rank 1, Black = rank 8, same as joinMode's
  // shareable-link second player always being Black) - unlike everywhere
  // else in this component, a simul room's "me" isn't always White.
  const rank = joinMode || simulRoom?.myColor === "black" ? "8" : "1";
  // Kept in sync with the hub avatar and the actual game board (see
  // customGame/skinStore.js) - equip a skin once, see it everywhere.
  const equippedSkin = useEquippedSkin();
  // The deck builder always shows pieces in their White coloring by
  // convention (every other piece here is drawn from the "w"-prefixed set
  // regardless of which side you're actually drafting for), so the King's
  // slot uses the skin's White-team variant too.
  const kingSkinSrc = KING_SKINS[equippedSkin].whiteTeamSrc;
  const [deck, setDeck] = useState(() => {
    const initial = Array(8).fill(null);
    initial[KING_HOME_INDEX] = "K";
    return initial;
  });
  // Which deck slots hold an evolution (a Bishop craft produces 2 at once).
  // Only ever meaningful for a slot that still holds a Knight or Bishop -
  // re-derived below rather than trusted directly, so it self-clears the
  // moment a piece is removed or swapped out from under it.
  const [evolvedIndices, setEvolvedIndices] = useState(() => new Set());
  // The Evo Slot's active recipe: null (empty), "N" (-> 1 Dragon) or "B"
  // (-> 2 Wizards). Only one recipe is active at a time - the reset (X)
  // button clears it (and un-places anything from it) so a different one
  // can be started.
  const [evoSlotType, setEvoSlotType] = useState(null);
  const [expandedDemo, setExpandedDemo] = useState(null);
  // True while a card is actively being dragged (from the palette or the
  // Evo Slot) - highlights open deck slots as valid drop targets.
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);
  // Saved decks (up to 2 slots, server-side per account) - slot -> {name,
  // deck, evolved_indices}, only populated for slots that actually have a
  // save. Loaded once on mount; kept in sync locally after any save/delete
  // here rather than re-fetching.
  const [savedDecks, setSavedDecks] = useState({});
  const [deckSlotBusy, setDeckSlotBusy] = useState(null);

  useEffect(() => {
    if (!token) return;
    listSavedDecks(token)
      .then((decks) => {
        const bySlot = {};
        for (const d of decks) bySlot[d.slot] = d;
        setSavedDecks(bySlot);
      })
      .catch(() => {
        // Non-fatal - the deck builder still works without saved slots.
      });
  }, [token]);

  function handleSaveToSlot(slot) {
    const name = window.prompt("Name this deck:", savedDecks[slot]?.name || `Deck ${slot}`);
    if (!name) return;
    setDeckSlotBusy(slot);
    setError(null);
    saveDeckToSlot(token, slot, { name, deck, evolved_indices: [...effectiveEvolvedIndices] })
      .then((saved) => setSavedDecks((prev) => ({ ...prev, [slot]: saved })))
      .catch((e) => setError(e.message))
      .finally(() => setDeckSlotBusy(null));
  }

  function handleLoadFromSlot(slot) {
    const saved = savedDecks[slot];
    if (!saved) return;
    setDeck(saved.deck);
    setEvolvedIndices(new Set(saved.evolved_indices));
    setEvoSlotType(null);
  }

  function handleDeleteSlot(slot) {
    if (!savedDecks[slot]) return;
    if (!window.confirm(`Delete the deck saved in slot ${slot}?`)) return;
    setDeckSlotBusy(slot);
    setError(null);
    deleteSavedDeck(token, slot)
      .then(() =>
        setSavedDecks((prev) => {
          const next = { ...prev };
          delete next[slot];
          return next;
        })
      )
      .catch((e) => setError(e.message))
      .finally(() => setDeckSlotBusy(null));
  }

  const effectiveEvolvedIndices = useMemo(
    () => new Set([...evolvedIndices].filter((i) => deck[i] === "N" || deck[i] === "B")),
    [deck, evolvedIndices]
  );

  const evoSlotTotal = evoSlotType === "B" ? 2 : evoSlotType === "N" ? 1 : 0;
  const evoSlotPlacedCount = [...effectiveEvolvedIndices].filter((i) => deck[i] === evoSlotType).length;
  const evoSlotRemaining = evoSlotTotal - evoSlotPlacedCount;

  function handleDropOnSlot(e, targetIndex) {
    e.preventDefault();
    let data;
    try {
      data = JSON.parse(e.dataTransfer.getData("application/json"));
    } catch {
      return;
    }
    if (!data) return;

    if (data.source === "evoSlot") {
      if (deck[targetIndex] || evoSlotRemaining <= 0) return; // only an open square, and only while stock remains
      setDeck((prev) => {
        const next = [...prev];
        next[targetIndex] = data.letter;
        return next;
      });
      setEvolvedIndices((prev) => new Set(prev).add(targetIndex));
      return;
    }

    setDeck((prev) => {
      if (prev[targetIndex] === "K" && data.source !== "deck") {
        return prev; // the King's slot can only be rearranged by dragging the King itself, never overwritten
      }
      const next = [...prev];
      if (data.source === "palette") {
        if (LOCKED_PIECES.has(data.letter)) return prev;
        next[targetIndex] = data.letter;
      } else if (data.source === "deck") {
        const sourceIndex = data.index;
        if (sourceIndex === targetIndex) return prev;
        // Swap rather than overwrite-and-clear, so dragging any piece onto
        // the King's slot repositions the King instead of destroying it.
        [next[sourceIndex], next[targetIndex]] = [next[targetIndex], next[sourceIndex]];
      }
      return next;
    });

    if (data.source === "deck") {
      const sourceIndex = data.index;
      // An evolution tracks the piece, not the square - if an evolved piece
      // just got dragged elsewhere (or swapped with what's now here), follow it.
      setEvolvedIndices((prev) => {
        if (!prev.has(sourceIndex) && !prev.has(targetIndex)) return prev;
        const next = new Set(prev);
        const sourceWasEvolved = prev.has(sourceIndex);
        const targetWasEvolved = prev.has(targetIndex);
        next.delete(sourceIndex);
        next.delete(targetIndex);
        if (sourceWasEvolved) next.add(targetIndex);
        if (targetWasEvolved) next.add(sourceIndex);
        return next;
      });
    }
  }

  function handleSlotClick(index) {
    if (deck[index] === "K") return; // locked - drag to move, never remove
    setDeck((prev) => prev.map((v, i) => (i === index ? null : v)));
  }

  // Dropping a fresh Knight/Bishop card onto the Evo Slot arms its recipe -
  // only while the slot is empty; use the reset (X) button to change recipes.
  function handleEvoSlotDrop(e) {
    e.preventDefault();
    let data;
    try {
      data = JSON.parse(e.dataTransfer.getData("application/json"));
    } catch {
      return;
    }
    if (!data || data.source !== "palette") return;
    const letter = data.letter;
    if (letter !== "N" && letter !== "B") return;
    if (LOCKED_PIECES.has(letter)) return;
    if (evoSlotType !== null) return; // reset first to change recipes
    setEvoSlotType(letter);
  }

  function handleEvoSlotDragStartPiece(e) {
    setIsDragging(true);
    e.dataTransfer.setData("application/json", JSON.stringify({ source: "evoSlot", letter: evoSlotType }));
  }

  // Clears the recipe AND anything it already placed on the deck, so a
  // different evolution (e.g. swapping a placed Dragon back for 2 Wizards)
  // can be crafted fresh.
  function handleEvoSlotReset() {
    const placedIndices = [...effectiveEvolvedIndices].filter((i) => deck[i] === evoSlotType);
    setDeck((prev) => {
      const next = [...prev];
      placedIndices.forEach((i) => (next[i] = null));
      return next;
    });
    setEvolvedIndices((prev) => {
      const next = new Set(prev);
      placedIndices.forEach((i) => next.delete(i));
      return next;
    });
    setEvoSlotType(null);
  }

  const points = useMemo(
    () =>
      deck.reduce((sum, letter, i) => {
        if (!letter) return sum;
        const isEvolved = effectiveEvolvedIndices.has(i);
        const evolvedCost = isEvolved && letter === "N" ? DRAGON_COST : isEvolved && letter === "B" ? WIZARD_COST : null;
        return sum + (evolvedCost ?? POINT_COSTS[letter] ?? 0);
      }, 0),
    [deck, effectiveEvolvedIndices]
  );
  const overBudget = points > MAX_DECK_POINTS;
  const kingCount = deck.filter((l) => l === "K").length;

  function buildBackRank() {
    const backRank = {};
    deck.forEach((letter, i) => {
      if (letter) backRank[squareFor(i, rank)] = letter;
    });
    return backRank;
  }

  function buildEvolvedSquares() {
    return [...effectiveEvolvedIndices].map((i) => squareFor(i, rank));
  }

  async function handleStart() {
    setError(null);
    setStarting(true);
    try {
      const payload = {
        white_back_rank: buildBackRank(),
        white_evolved_squares: buildEvolvedSquares(),
        vs_ai: true,
      };
      const game = await postCustomSetup(payload);
      onGameStarted(game);
    } catch (e) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  }

  async function handleStartOnline() {
    setError(null);
    setStarting(true);
    try {
      const payload = {
        white_back_rank: buildBackRank(),
        white_evolved_squares: buildEvolvedSquares(),
      };
      const game = await postOnlineCreate(payload);
      onOnlineGameCreated(game);
    } catch (e) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  }

  async function handleSimulSubmit() {
    setError(null);
    setStarting(true);
    try {
      const payload = {
        token: simulRoom.myToken,
        back_rank: buildBackRank(),
        evolved_squares: buildEvolvedSquares(),
      };
      const result = await postSimulSubmit(simulRoom.roomId, payload);
      if (result.waiting) {
        onSimulWaiting();
      } else {
        onSimulGameReady({
          initialGame: result.game,
          myColor: simulRoom.myColor,
          myToken: simulRoom.myToken,
          roomId: simulRoom.roomId,
        });
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  }

  async function handleJoin() {
    setError(null);
    setStarting(true);
    try {
      const payload = {
        black_back_rank: buildBackRank(),
        black_evolved_squares: buildEvolvedSquares(),
      };
      const joined = await postOnlineRoomJoin(roomId, payload);
      onOnlineDeckSubmitted(joined);
    } catch (e) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  }

  const pointsPct = Math.min(100, Math.round((points / MAX_DECK_POINTS) * 100));

  const atFullBudget = points === MAX_DECK_POINTS;

  return (
    <div className="deck-builder">
      {onExit && (
        <div className="deck-builder-toolbar">
          <button type="button" onClick={onExit}>
            Home
          </button>
        </div>
      )}
      {token && (
        <div className="saved-deck-slots">
          {[1, 2].map((slot) => {
            const saved = savedDecks[slot];
            const busy = deckSlotBusy === slot;
            return (
              <div key={slot} className="saved-deck-slot">
                <button
                  type="button"
                  className="saved-deck-slot-load"
                  disabled={!saved || busy}
                  onClick={() => handleLoadFromSlot(slot)}
                  title={saved ? `Load "${saved.name}"` : `Slot ${slot} is empty`}
                >
                  {saved ? saved.name : `Slot ${slot}: empty`}
                </button>
                <button
                  type="button"
                  className="saved-deck-slot-save"
                  disabled={busy}
                  onClick={() => handleSaveToSlot(slot)}
                  title={`Save the current deck to slot ${slot}`}
                >
                  Save
                </button>
                {saved && (
                  <button
                    type="button"
                    className="saved-deck-slot-delete"
                    disabled={busy}
                    onClick={() => handleDeleteSlot(slot)}
                    title={`Delete slot ${slot}`}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className={`points-bar${overBudget ? " over" : ""}${atFullBudget ? " full" : ""}`}>
        <span className="points-bar-label">Deck Budget</span>
        <div className="points-bar-track">
          <div className="points-bar-fill" style={{ width: `${pointsPct}%` }} />
        </div>
        <span className="points-bar-value">
          <strong>{points}</strong> / {MAX_DECK_POINTS} PTS
        </span>
      </div>

      <div className="chess-deck-board">
        {Array.from({ length: 8 }, (_, i) => (
          <PawnSquare key={`p${i}`} dark={isDarkSquare(i, 1)} />
        ))}
        {deck.map((letter, i) => (
          <DeckSlot
            key={i}
            letter={letter}
            file={FILES[i]}
            dark={isDarkSquare(i, 0)}
            isEvolution={effectiveEvolvedIndices.has(i)}
            isKing={letter === "K"}
            kingSkinSrc={kingSkinSrc}
            isDragTarget={isDragging && !letter}
            onClick={() => handleSlotClick(i)}
            onDragStart={(e) => {
              setIsDragging(true);
              e.dataTransfer.setData("application/json", JSON.stringify({ source: "deck", index: i }));
            }}
            onDragEnd={() => setIsDragging(false)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleDropOnSlot(e, i)}
          />
        ))}
      </div>

      <div className="deck-builder-main">
        <div className="palette-row">
          {DRAFTABLE_PIECES.map((letter) => (
            <PaletteCard
              key={letter}
              letter={letter}
              locked={LOCKED_PIECES.has(letter)}
              expanded={expandedDemo === letter}
              onDragStart={(e) => {
                setIsDragging(true);
                e.dataTransfer.setData("application/json", JSON.stringify({ source: "palette", letter }));
              }}
              onDragEnd={() => setIsDragging(false)}
              onToggleDemo={() => setExpandedDemo((prev) => (prev === letter ? null : letter))}
            />
          ))}
        </div>

        <EvoSlotBox
          evoSlotType={evoSlotType}
          remaining={evoSlotRemaining}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleEvoSlotDrop}
          onDragStartPiece={handleEvoSlotDragStartPiece}
          onDragEndPiece={() => setIsDragging(false)}
          onReset={handleEvoSlotReset}
        />
      </div>

      {expandedDemo && (
        <div className="piece-demo-panel">
          {PIECE_DEMO_MODES[expandedDemo] ? (
            <AnimatedPieceDemo letter={expandedDemo} />
          ) : (
            <>
              <MiniDemoBoard
                letter={expandedDemo}
                moveOffsets={DEMO_MOVE_OFFSETS[expandedDemo] || []}
                shootOffsets={DEMO_SHOOT_OFFSETS[expandedDemo] || []}
              />
              <p className="piece-demo-caption">
                <strong>{PIECE_LABELS[expandedDemo]}:</strong> {DEMO_CAPTIONS[expandedDemo]}
              </p>
            </>
          )}
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      <div className="start-buttons-row">
        {joinMode ? (
          <button type="button" className="start-game-btn online" disabled={starting || overBudget || kingCount !== 1} onClick={handleJoin}>
            {starting ? "Joining…" : kingCount !== 1 ? "Place exactly one King" : "Join Game"}
          </button>
        ) : simulRoom ? (
          <button
            type="button"
            className="start-game-btn online"
            disabled={starting || overBudget || kingCount !== 1}
            onClick={handleSimulSubmit}
          >
            {starting ? "Submitting…" : kingCount !== 1 ? "Place exactly one King" : "Ready"}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="start-game-btn"
              disabled={starting || overBudget || kingCount !== 1}
              onClick={handleStart}
            >
              {starting ? "Starting…" : kingCount !== 1 ? "Place exactly one King" : "vs Computer"}
            </button>
            <button
              type="button"
              className="start-game-btn online"
              disabled={starting || overBudget || kingCount !== 1}
              onClick={handleStartOnline}
              title="Create a room and share the link with an opponent - they'll draft their own deck too"
            >
              {starting ? "Starting…" : kingCount !== 1 ? "Place exactly one King" : "Play Online"}
            </button>
          </>
        )}
      </div>

      <p className="deck-hint">
        {joinMode
          ? `Build your deck (up to ${MAX_DECK_POINTS} points), then join the match. `
          : simulRoom
            ? `Build a deck of up to ${MAX_DECK_POINTS} points - ${simulRoom.opponentUsername} is drafting theirs right now too, the match starts the moment you're both ready. `
            : `Build a deck of up to ${MAX_DECK_POINTS} points, then play a match against the computer. `}
        Drag a card into a deck slot. Click a filled slot to clear it. Click <strong>?</strong> on a card for a
        demo.
      </p>
    </div>
  );
}
