import { useState } from "react";
import DeckBuilder from "./DeckBuilder";
import CustomGamePlay from "./CustomGamePlay";
import OnlineWaitingRoom from "./OnlineWaitingRoom";
import OnlineGamePlay from "./OnlineGamePlay";
import HubWorld from "./hub/HubWorld";
import { useHubState } from "./hub/useHubState";
import FriendsPanel from "./social/FriendsPanel";
import SimulWaitingRoom from "./social/SimulWaitingRoom";
import PuzzleRush from "./puzzleRush/PuzzleRush";
import { usePresence } from "./social/usePresence";
import { postLogout } from "./social/api";
import { clearAuth } from "./social/authStore";
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

export default function HeroChessApp({ joinGameId: joinRoomId, auth }) {
  const [game, setGame] = useState(null);
  const [session, setSession] = useState(() => getRestorableSession(joinRoomId));
  // The dorm room hub is the default landing spot - but a shared multiplayer
  // link should still drop someone straight into drafting a deck to join
  // that room, exactly like before, not into the hub first.
  const hub = useHubState();

  // Whose dorm the hub is currently showing - null means "my own". Kept
  // here (not in usePresence) because it needs the friend's username,
  // which the presence socket alone doesn't carry (see FriendsPanel).
  const [visitingFriend, setVisitingFriend] = useState(null);
  const [inPuzzleRush, setInPuzzleRush] = useState(false);
  // A friend challenge, mine to draft for right now - set the instant a
  // challenge is sent or received (see FriendsPanel/usePresence's
  // onChallenge below), since both sides draft simultaneously with no
  // separate accept step: {roomId, myColor, myToken, opponentUsername,
  // waiting}. `waiting` flips true once I've submitted my own deck and am
  // sitting in SimulWaitingRoom for the other side to finish theirs.
  const [simulRoom, setSimulRoom] = useState(null);

  const presence = usePresence(auth.token, auth.user.id, {
    onChallenge: (msg) =>
      setSimulRoom({
        roomId: msg.room_id,
        myColor: "black",
        myToken: msg.black_token,
        opponentUsername: msg.from.username,
        waiting: false,
      }),
  });

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
    const next = {
      stage: "playing",
      initialGame: joined,
      myColor: "black",
      myToken: joined.black_token,
      roomId: joinRoomId,
    };
    setSession(next);
    storeSession(next);
  }

  function handleExit() {
    setGame(null);
    setSession(null);
    storeSession(null);
    hub.setActiveOverlay(null); // land back in the hub itself, not a stale station overlay
    // Drop the ?join=... param so leaving a room doesn't re-trigger the join flow.
    window.history.replaceState({}, "", window.location.pathname);
  }

  function handleGameStartedFromHub(startedGame) {
    hub.setActiveOverlay(null);
    setGame(startedGame);
  }

  function handleOnlineGameCreatedFromHub(payload) {
    hub.setActiveOverlay(null);
    handleOnlineGameCreated(payload);
  }

  function handleVisitFriend(friend) {
    presence.visit(friend.id);
    setVisitingFriend({ id: friend.id, username: friend.username });
    hub.setActiveOverlay(null);
  }

  function handleReturnHome() {
    presence.leaveDorm();
    setVisitingFriend(null);
  }

  function handleChallengeSent(challenge) {
    hub.setActiveOverlay(null);
    setSimulRoom({ ...challenge, waiting: false });
  }

  function handleSimulWaiting() {
    setSimulRoom((prev) => (prev ? { ...prev, waiting: true } : prev));
  }

  function handleSimulGameReady({ initialGame, myColor, myToken, roomId }) {
    setSimulRoom(null);
    handleWaitingRoomGameReady({ initialGame, myColor, myToken, roomId });
  }

  function handleLogout() {
    postLogout(auth.token).catch(() => {});
    clearAuth();
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
    // A fresh join link - draft black's deck first.
    content = <DeckBuilder joinMode roomId={joinRoomId} onOnlineDeckSubmitted={handleOnlineDeckSubmitted} />;
  } else if (simulRoom?.waiting) {
    content = (
      <SimulWaitingRoom
        roomId={simulRoom.roomId}
        myColor={simulRoom.myColor}
        myToken={simulRoom.myToken}
        opponentUsername={simulRoom.opponentUsername}
        onGameReady={handleSimulGameReady}
      />
    );
  } else if (simulRoom) {
    // A friend challenge, sent or received - draft simultaneously with
    // whoever's on the other end (see the comment on simulRoom's state).
    content = (
      <DeckBuilder simulRoom={simulRoom} onSimulWaiting={handleSimulWaiting} onSimulGameReady={handleSimulGameReady} />
    );
  } else if (game) {
    content = <CustomGamePlay initialGame={game} onExit={handleExit} />;
  } else if (inPuzzleRush) {
    content = <PuzzleRush token={auth.token} onExit={() => setInPuzzleRush(false)} />;
  } else {
    // Default landing spot: the dorm room hub. Walking to (or clicking) the
    // pedestal - the single place to queue up for a game - opens the
    // deck-builder flow as a station overlay on top of the room rather than
    // replacing it - closing the overlay without starting a match just
    // returns to the hub, in place, with the avatar exactly where it was
    // left.
    const overlayTitle = hub.activeOverlay === "friends" ? "Friends" : "Play a Game";
    content = (
      <>
        <HubWorld
          hub={hub}
          username={auth.user.username}
          presence={presence}
          visiting={visitingFriend}
          onReturnHome={handleReturnHome}
          onOpenFriends={() => hub.setActiveOverlay("friends")}
          onOpenPuzzleRush={() => setInPuzzleRush(true)}
          onLogout={handleLogout}
        />
        {hub.activeOverlay && (
          <div className="hub-overlay-backdrop" onClick={() => hub.setActiveOverlay(null)}>
            <div className="hub-overlay-panel" onClick={(e) => e.stopPropagation()}>
              <span className="hub-overlay-title">{overlayTitle}</span>
              <button
                type="button"
                className="hub-overlay-close"
                onClick={() => hub.setActiveOverlay(null)}
                title="Back to the hub"
              >
                ×
              </button>
              {hub.activeOverlay === "friends" ? (
                <FriendsPanel token={auth.token} onVisit={handleVisitFriend} onChallenge={handleChallengeSent} />
              ) : (
                <DeckBuilder onGameStarted={handleGameStartedFromHub} onOnlineGameCreated={handleOnlineGameCreatedFromHub} />
              )}
            </div>
          </div>
        )}
      </>
    );
  }

  return <div className="hero-chess-app">{content}</div>;
}
