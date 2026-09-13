import { useEffect, useRef, useState } from "react";
import { simulRoomWsUrl } from "./api";

// Mirrors OnlineWaitingRoom's own pattern (the shareable-link flow), but
// for a friend challenge: both sides draft simultaneously (see
// FriendsPanel.jsx/HeroChessApp.jsx), so whoever finishes first just lands
// here and waits - there's no link to share, since the opponent is
// already a known friend who's drafting their own deck right now too.
export default function SimulWaitingRoom({ roomId, myColor, myToken, opponentUsername, onGameReady }) {
  const [connected, setConnected] = useState(false);
  const reconnectTimer = useRef(null);

  useEffect(() => {
    let socket;
    let cancelled = false;

    function connect() {
      socket = new WebSocket(simulRoomWsUrl(roomId));
      socket.onopen = () => setConnected(true);
      socket.onmessage = (event) => {
        try {
          const state = JSON.parse(event.data);
          if (state.ready) onGameReady({ initialGame: state, myColor, myToken, roomId });
        } catch {
          // ignore malformed frames
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (!cancelled) reconnectTimer.current = setTimeout(connect, 2000);
      };
      socket.onerror = () => socket.close();
    }

    connect();
    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer.current);
      socket?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  return (
    <div className="custom-play">
      <div className="custom-play-toolbar">
        <span className="custom-play-turn">{connected ? "Waiting for opponent…" : "Connecting…"}</span>
      </div>
      <div className="online-waiting-panel">
        <p>
          Waiting for <strong>{opponentUsername}</strong> to finish drafting their deck - the match starts the
          moment they submit.
        </p>
      </div>
    </div>
  );
}
