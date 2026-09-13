import { useState } from "react";

// A friend's challenge needs an explicit accept before either side sees a
// deck builder (see HeroChessApp.jsx's incomingChallenge/awaitingChallenge
// state) - rendered as an always-on-top overlay since a challenge can land
// while its recipient is anywhere in the app, not just idle in the hub.
export default function IncomingChallengePrompt({ fromUsername, onAccept, onDecline }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handle(action) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="hub-overlay-backdrop challenge-prompt-backdrop">
      <div className="hub-overlay-panel challenge-prompt-panel" onClick={(e) => e.stopPropagation()}>
        <span className="hub-overlay-title">Challenge</span>
        <p className="challenge-prompt-text">
          <strong>{fromUsername}</strong> wants to play a match.
        </p>
        {error && <div className="error-banner">{error}</div>}
        <div className="challenge-prompt-actions">
          <button type="button" className="start-game-btn" disabled={busy} onClick={() => handle(onAccept)}>
            Accept
          </button>
          <button type="button" className="start-game-btn online" disabled={busy} onClick={() => handle(onDecline)}>
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}
