// Shown to the challenger right after sending a challenge, before the
// recipient has responded - mirrors SimulWaitingRoom's later "waiting for
// them to draft" screen, but for the earlier "waiting for them to accept"
// gate. onChallengeAccepted/onChallengeDeclined (wired in HeroChessApp.jsx's
// usePresence callbacks) are what actually move this forward - there's
// nothing to poll here.
export default function ChallengeWaitingForAccept({ toUsername, declined, onExit }) {
  return (
    <div className="custom-play">
      <div className="custom-play-toolbar">
        <span className="custom-play-turn">{declined ? "Challenge declined" : "Waiting for accept…"}</span>
        <button type="button" onClick={onExit}>
          Home
        </button>
      </div>
      <div className="online-waiting-panel">
        {declined ? (
          <p>
            <strong>{toUsername}</strong> declined your challenge.
          </p>
        ) : (
          <p>
            Waiting for <strong>{toUsername}</strong> to accept your challenge - drafting starts for both of you the
            moment they do.
          </p>
        )}
      </div>
    </div>
  );
}
