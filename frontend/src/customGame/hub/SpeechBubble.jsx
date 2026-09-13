// A floating chat message over an avatar's head - shared between the local
// player's own avatar (AvatarController.jsx) and everyone else's
// (HubWorld.jsx's RemoteAvatar) so both look identical. Fades on its own
// after a few seconds - see social/usePresence.js's CHAT_BUBBLE_DURATION_MS
// for the timer that actually clears it.
export default function SpeechBubble({ text }) {
  return (
    <div className="hub-speech-bubble">
      <span>{text}</span>
    </div>
  );
}
