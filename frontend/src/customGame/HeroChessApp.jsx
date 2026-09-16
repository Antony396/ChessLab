import { useState } from "react";
import DeckBuilder from "./DeckBuilder";
import CustomGamePlay from "./CustomGamePlay";
import OnlineWaitingRoom from "./OnlineWaitingRoom";
import OnlineGamePlay from "./OnlineGamePlay";
import HubWorld from "./hub/HubWorld";
import CommonsWorld from "./hub/CommonsWorld";
import { useHubState } from "./hub/useHubState";
import FriendsPanel from "./social/FriendsPanel";
import SkinsPanel from "./hub/SkinsPanel";
import ShopPanel from "./hub/ShopPanel";
import BattlePassPanel from "./hub/BattlePassPanel";
import LeaderboardPanel from "./hub/LeaderboardPanel";
import PuzzleChoicePanel from "./hub/PuzzleChoicePanel";
import SimulWaitingRoom from "./social/SimulWaitingRoom";
import ChallengeWaitingForAccept from "./social/ChallengeWaitingForAccept";
import IncomingChallengePrompt from "./social/IncomingChallengePrompt";
import PuzzleMap from "./puzzleMap/PuzzleMap";
import DailyPuzzle from "./dailyPuzzle/DailyPuzzle";
import { usePresence, COMMONS_DORM_ID } from "./social/usePresence";
import { postLogout, postSimulAccept, postSimulDecline } from "./social/api";
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
  // Whose dorm the hub is currently showing - null means "my own". Kept
  // here (not in usePresence) because it needs the friend's username,
  // which the presence socket alone doesn't carry (see FriendsPanel).
  const [visitingFriend, setVisitingFriend] = useState(null);
  // Am I currently in the Commons instead of a dorm at all - see
  // handleVisitCommons/handleReturnHome and useHubState's own room param.
  const [visitingCommons, setVisitingCommons] = useState(false);
  // The dorm room hub is the default landing spot - but a shared multiplayer
  // link should still drop someone straight into drafting a deck to join
  // that room, exactly like before, not into the hub first. Reused for the
  // Commons too (see useHubState's room param) rather than a second hook
  // instance, so there's one movement state, not two to keep in sync.
  const hub = useHubState(visitingCommons ? "commons" : "dorm");

  const [inPuzzleMap, setInPuzzleMap] = useState(false);
  const [inDailyPuzzle, setInDailyPuzzle] = useState(false);
  // A friend challenge I've been sent, awaiting MY accept/decline:
  // {roomId, blackToken, fromUsername}. Rendered as an always-on-top prompt
  // (see IncomingChallengePrompt) regardless of whatever else is on screen.
  const [incomingChallenge, setIncomingChallenge] = useState(null);
  // A friend challenge I sent, awaiting THEIR accept/decline:
  // {roomId, whiteToken, toUsername, declined}. Only moves forward via the
  // onChallengeAccepted/onChallengeDeclined presence pushes below - there's
  // nothing to poll here.
  const [awaitingChallenge, setAwaitingChallenge] = useState(null);
  // A friend challenge that's been accepted and is ready to draft for:
  // {roomId, myColor, myToken, opponentUsername, waiting}. `waiting` flips
  // true once I've submitted my own deck and am sitting in
  // SimulWaitingRoom for the other side to finish theirs.
  const [simulRoom, setSimulRoom] = useState(null);

  const presence = usePresence(auth.token, auth.user.id, {
    onChallenge: (msg) =>
      setIncomingChallenge({ roomId: msg.room_id, blackToken: msg.black_token, fromUsername: msg.from.username }),
    onChallengeAccepted: (msg) =>
      setAwaitingChallenge((prev) => {
        if (!prev || prev.roomId !== msg.room_id) return prev;
        setSimulRoom({
          roomId: prev.roomId,
          myColor: "white",
          myToken: prev.whiteToken,
          opponentUsername: prev.toUsername,
          waiting: false,
        });
        return null;
      }),
    onChallengeDeclined: (msg) =>
      setAwaitingChallenge((prev) => (prev && prev.roomId === msg.room_id ? { ...prev, declined: true } : prev)),
  });

  function handleAcceptChallenge() {
    const challenge = incomingChallenge;
    return postSimulAccept(challenge.roomId, challenge.blackToken).then(() => {
      setSimulRoom({
        roomId: challenge.roomId,
        myColor: "black",
        myToken: challenge.blackToken,
        opponentUsername: challenge.fromUsername,
        waiting: false,
      });
      setIncomingChallenge(null);
    });
  }

  function handleDeclineChallenge() {
    const challenge = incomingChallenge;
    return postSimulDecline(challenge.roomId, challenge.blackToken).then(() => setIncomingChallenge(null));
  }

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

  function handleVisitCommons() {
    presence.visit(COMMONS_DORM_ID);
    setVisitingCommons(true);
  }

  function handleReturnHome() {
    presence.leaveDorm();
    setVisitingFriend(null);
    setVisitingCommons(false);
  }

  function handleChallengeSent(challenge) {
    hub.setActiveOverlay(null);
    setAwaitingChallenge({ roomId: challenge.roomId, whiteToken: challenge.myToken, toUsername: challenge.opponentUsername });
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
      <OnlineWaitingRoom
        roomId={session.roomId}
        whiteToken={session.whiteToken}
        onGameReady={handleWaitingRoomGameReady}
        onExit={handleExit}
      />
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
    // A fresh join link - draft black's deck first. joinGameId is captured
    // once from the URL at mount (see App.jsx) and never changes after, so
    // leaving this flow means an actual navigation, not just clearing local
    // state - drops the ?join=... param and reloads to a clean hub landing.
    content = (
      <DeckBuilder
        joinMode
        roomId={joinRoomId}
        onOnlineDeckSubmitted={handleOnlineDeckSubmitted}
        token={auth.token}
        onExit={() => {
          window.location.href = window.location.pathname;
        }}
      />
    );
  } else if (awaitingChallenge) {
    content = (
      <ChallengeWaitingForAccept
        toUsername={awaitingChallenge.toUsername}
        declined={Boolean(awaitingChallenge.declined)}
        onExit={() => setAwaitingChallenge(null)}
      />
    );
  } else if (simulRoom?.waiting) {
    content = (
      <SimulWaitingRoom
        roomId={simulRoom.roomId}
        myColor={simulRoom.myColor}
        myToken={simulRoom.myToken}
        opponentUsername={simulRoom.opponentUsername}
        onGameReady={handleSimulGameReady}
        onExit={() => setSimulRoom(null)}
      />
    );
  } else if (simulRoom) {
    // A friend challenge, sent or received - draft simultaneously with
    // whoever's on the other end (see the comment on simulRoom's state).
    content = (
      <DeckBuilder
        simulRoom={simulRoom}
        onSimulWaiting={handleSimulWaiting}
        onSimulGameReady={handleSimulGameReady}
        token={auth.token}
        onExit={() => setSimulRoom(null)}
      />
    );
  } else if (game) {
    content = <CustomGamePlay initialGame={game} onExit={handleExit} />;
  } else if (inPuzzleMap) {
    content = <PuzzleMap token={auth.token} onExit={() => setInPuzzleMap(false)} />;
  } else if (inDailyPuzzle) {
    content = <DailyPuzzle token={auth.token} onExit={() => setInDailyPuzzle(false)} />;
  } else if (visitingCommons) {
    // Same overlay chrome the hub uses (see the default branch below),
    // trimmed to just "skins" - the Commons has no other stations, but the
    // player's own skin picker still needs somewhere to open into (see
    // CommonsWorld.jsx's own comment on why the profile badge/skin button
    // still show there at all).
    content = (
      <>
        <CommonsWorld
          hub={hub}
          presence={presence}
          onReturnHome={handleReturnHome}
          username={auth.user.username}
          token={auth.token}
          myUserId={auth.user.id}
          onOpenSkins={() => hub.setActiveOverlay("skins")}
        />
        {hub.activeOverlay === "skins" && (
          <div className="hub-overlay-backdrop" onClick={() => hub.setActiveOverlay(null)}>
            <div className="hub-overlay-panel" onClick={(e) => e.stopPropagation()}>
              <span className="hub-overlay-title">Choose a Skin</span>
              <button
                type="button"
                className="hub-overlay-close"
                onClick={() => hub.setActiveOverlay(null)}
                title="Back to the Commons"
              >
                ×
              </button>
              <SkinsPanel token={auth.token} />
            </div>
          </div>
        )}
      </>
    );
  } else {
    // Default landing spot: the dorm room hub. Walking to (or clicking) the
    // pedestal - the single place to queue up for a game - opens the
    // deck-builder flow as a station overlay on top of the room rather than
    // replacing it - closing the overlay without starting a match just
    // returns to the hub, in place, with the avatar exactly where it was
    // left. The puzzle pedestal instead opens a small choice popup (Daily
    // Puzzle vs the Puzzle Map) through this same overlay chrome.
    const overlayTitle =
      hub.activeOverlay === "friends"
        ? "Friends"
        : hub.activeOverlay === "skins"
          ? "Choose a Skin"
          : hub.activeOverlay === "shop"
            ? "Shop"
            : hub.activeOverlay === "battle-pass"
              ? "Battle Pass"
              : hub.activeOverlay === "leaderboard"
                ? "Leaderboard"
                : hub.activeOverlay === "puzzle-choice"
                  ? "Puzzles"
                  : "Play a Game";
    content = (
      <>
        <HubWorld
          hub={hub}
          username={auth.user.username}
          token={auth.token}
          myUserId={auth.user.id}
          presence={presence}
          visiting={visitingFriend}
          onReturnHome={handleReturnHome}
          onOpenFriends={() => hub.setActiveOverlay("friends")}
          onOpenPuzzles={() => hub.setActiveOverlay("puzzle-choice")}
          onOpenSkins={() => hub.setActiveOverlay("skins")}
          onOpenShop={() => hub.setActiveOverlay("shop")}
          onOpenBattlePass={() => hub.setActiveOverlay("battle-pass")}
          onOpenLeaderboard={() => hub.setActiveOverlay("leaderboard")}
          onOpenCommons={handleVisitCommons}
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
              ) : hub.activeOverlay === "skins" ? (
                <SkinsPanel token={auth.token} />
              ) : hub.activeOverlay === "shop" ? (
                <ShopPanel token={auth.token} />
              ) : hub.activeOverlay === "battle-pass" ? (
                <BattlePassPanel token={auth.token} />
              ) : hub.activeOverlay === "leaderboard" ? (
                <LeaderboardPanel token={auth.token} myUserId={auth.user.id} />
              ) : hub.activeOverlay === "puzzle-choice" ? (
                <PuzzleChoicePanel
                  onChoosePuzzleMap={() => {
                    hub.setActiveOverlay(null);
                    setInPuzzleMap(true);
                  }}
                  onChooseDailyPuzzle={() => {
                    hub.setActiveOverlay(null);
                    setInDailyPuzzle(true);
                  }}
                />
              ) : (
                <DeckBuilder
                  onGameStarted={handleGameStartedFromHub}
                  onOnlineGameCreated={handleOnlineGameCreatedFromHub}
                  token={auth.token}
                />
              )}
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="hero-chess-app">
      {content}
      {incomingChallenge && (
        <IncomingChallengePrompt
          fromUsername={incomingChallenge.fromUsername}
          onAccept={handleAcceptChallenge}
          onDecline={handleDeclineChallenge}
        />
      )}
    </div>
  );
}
