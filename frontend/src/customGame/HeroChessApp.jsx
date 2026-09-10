import { useState } from "react";
import DeckBuilder from "./DeckBuilder";
import CustomGamePlay from "./CustomGamePlay";
import OnlineWaitingRoom from "./OnlineWaitingRoom";
import OnlineGamePlay from "./OnlineGamePlay";
import "./customGame.css";
import "./deckBuilder.css";

const SESSION_KEY = "heroChessOnlineSession";

// Discriminated union, persisted so a page refresh doesn't strand a player:
//   { stage: "waiting", roomId, whiteToken }                - creator, before black joins
//   { stage: "playing", initialGame, myColor, myToken }      - either side, once the game exists
function loadStoredSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function storeSession(session) {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // private browsing / storage disabled - the session just won't survive a refresh
  }
}

// Every stored session (waiting or playing) carries the roomId it
// originated from, so a stored session only counts as resumable if it's for
// the same room a join link (if any) points at - a link to a different room
// means starting fresh (drafting a new deck to join THAT room), while
// re-clicking the same link (or just refreshing) resumes it.
function getRestorableSession(joinRoomId) {
  const stored = loadStoredSession();
  if (!stored) return null;
  if (joinRoomId && stored.roomId !== joinRoomId) return null;
  return stored;
}

export default function HeroChessApp({ joinGameId: joinRoomId }) {
  const [game, setGame] = useState(null);
  const [session, setSession] = useState(() => getRestorableSession(joinRoomId));

  function handleOnlineGameCreated({ room_id, white_token }) {
    const next = { stage: "waiting", roomId: room_id, whiteToken: white_token };
    setSession(next);
    storeSession(next);
  }

  function handleWaitingRoomGameReady({ initialGame, myColor, myToken, roomId }) {
    const next = { stage: "playing", initialGame, myColor, myToken, roomId };
    setSession(next);
    storeSession(next);
  }

  function handleOnlineDeckSubmitted(joined) {
    const next = { stage: "playing", initialGame: joined, myColor: "black", myToken: joined.black_token, roomId: joinRoomId };
    setSession(next);
    storeSession(next);
  }

  function handleExit() {
    setGame(null);
    setSession(null);
    storeSession(null);
    // Drop the ?join=... param so leaving a room doesn't re-trigger the join flow.
    window.history.replaceState({}, "", window.location.pathname);
  }

  let content;
  if (session?.stage === "waiting") {
    content = (
      <OnlineWaitingRoom roomId={session.roomId} whiteToken={session.whiteToken} onGameReady={handleWaitingRoomGameReady} />
    );
  } else if (session?.stage === "playing") {
    content = (
      <OnlineGamePlay
        initialGame={session.initialGame}
        myColor={session.myColor}
        myToken={session.myToken}
        onExit={handleExit}
      />
    );
  } else if (joinRoomId) {
    // A fresh join link (not resuming a stored session) - draft black's deck first.
    content = <DeckBuilder joinMode roomId={joinRoomId} onOnlineDeckSubmitted={handleOnlineDeckSubmitted} />;
  } else if (game) {
    content = <CustomGamePlay initialGame={game} onExit={handleExit} />;
  } else {
    content = <DeckBuilder onGameStarted={setGame} onOnlineGameCreated={handleOnlineGameCreated} />;
  }

  return <div className="hero-chess-app">{content}</div>;
}
