import { useState } from "react";
import DeckBuilder from "./DeckBuilder";
import CustomGamePlay from "./CustomGamePlay";
import OnlineWaitingRoom from "./OnlineWaitingRoom";
import OnlineGamePlay from "./OnlineGamePlay";
import HubWorld from "./hub/HubWorld";
import { useHubState } from "./hub/useHubState";
import FriendsPanel from "./social/FriendsPanel";
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
  // Set when challenging a specific friend from the Friends panel, so the
  // deck-builder overlay (opened the same way as a normal "Play a Game")
  // knows to send a direct challenge instead of showing the usual
  // vs-Computer/Play Online buttons.
  const [challengeTarget, setChallengeTarget] = useState(null);
  // A challenge someone just sent *to* me, waiting on Accept/Decline.
  const [pendingChallenge, setPendingChallenge] = useState(null);
  // Set when I accept an incoming challenge - from here on it behaves
  // exactly like having opened a `?join=<roomId>` link.
  const [manualJoinRoomId, setManualJoinRoomId] = useState(null);
  const effectiveJoinRoomId = joinRoomId || manualJoinRoomId;

  const presence = usePresence(auth.token, auth.user.id, {
    onChallenge: (msg) => setPendingChallenge(msg),
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
      roomId: effectiveJoinRoomId,
    };
    setSession(next);
    storeSession(next);
    setManualJoinRoomId(null);
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
    setChallengeTarget(null);
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

  function handleChallengeFriend(friend) {
    setChallengeTarget(friend);
    hub.setActiveOverlay("match-queue");
  }

  function handleAcceptChallenge() {
    setManualJoinRoomId(pendingChallenge.room_id);
    setPendingChallenge(null);
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
  } else if (effectiveJoinRoomId) {
    // A fresh join link (or an accepted challenge) - draft black's deck first.
    content = <DeckBuilder joinMode roomId={effectiveJoinRoomId} onOnlineDeckSubmitted={handleOnlineDeckSubmitted} />;
  } else if (game) {
    content = <CustomGamePlay initialGame={game} onExit={handleExit} />;
  } else {
    // Default landing spot: the dorm room hub. Walking to (or clicking) the
    // pedestal - the single place to queue up for a game - opens the
    // deck-builder flow as a station overlay on top of the room rather than
    // replacing it - closing the overlay without starting a match just
    // returns to the hub, in place, with the avatar exactly where it was
    // left.
    const overlayTitle = hub.activeOverlay === "friends" ? "Friends" : challengeTarget ? `Challenge ${challengeTarget.username}` : "Play a Game";
    content = (
      <>
        <HubWorld
          hub={hub}
          username={auth.user.username}
          presence={presence}
          visiting={visitingFriend}
          onReturnHome={handleReturnHome}
          onOpenFriends={() => hub.setActiveOverlay("friends")}
          onLogout={handleLogout}
        />
        {hub.activeOverlay && (
          <div
            className="hub-overlay-backdrop"
            onClick={() => {
              hub.setActiveOverlay(null);
              setChallengeTarget(null);
            }}
          >
            <div className="hub-overlay-panel" onClick={(e) => e.stopPropagation()}>
              <span className="hub-overlay-title">{overlayTitle}</span>
              <button
                type="button"
                className="hub-overlay-close"
                onClick={() => {
                  hub.setActiveOverlay(null);
                  setChallengeTarget(null);
                }}
                title="Back to the hub"
              >
                ×
              </button>
              {hub.activeOverlay === "friends" ? (
                <FriendsPanel token={auth.token} onVisit={handleVisitFriend} onChallenge={handleChallengeFriend} />
              ) : (
                <DeckBuilder
                  onGameStarted={handleGameStartedFromHub}
                  onOnlineGameCreated={handleOnlineGameCreatedFromHub}
                  challengeTarget={challengeTarget}
                  authToken={auth.token}
                />
              )}
            </div>
          </div>
        )}

        {pendingChallenge && (
          <div className="hub-overlay-backdrop">
            <div className="hub-overlay-panel challenge-modal-panel">
              <span className="hub-overlay-title">Challenge</span>
              <p className="challenge-modal-text">
                <strong>{pendingChallenge.from.username}</strong> challenged you to a match.
              </p>
              <div className="challenge-modal-actions">
                <button type="button" className="challenge-accept-btn" onClick={handleAcceptChallenge}>
                  Accept
                </button>
                <button type="button" className="challenge-decline-btn" onClick={() => setPendingChallenge(null)}>
                  Decline
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return <div className="hero-chess-app">{content}</div>;
}
