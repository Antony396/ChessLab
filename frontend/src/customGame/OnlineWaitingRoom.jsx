import { useEffect, useRef, useState } from "react";
import { onlineRoomWsUrl } from "./api";

// The creator waits here, sharing the room link, until a second player
// drafts a deck and joins - the server broadcasts the finished game over
// this room-level socket the moment that happens, and this component hands
// off to actual play.
export default function OnlineWaitingRoom({ roomId, whiteToken, onGameReady }) {
  const [connected, setConnected] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const reconnectTimer = useRef(null);

  useEffect(() => {
    let socket;
    let cancelled = false;

    function connect() {
      socket = new WebSocket(onlineRoomWsUrl(roomId));
      socket.onopen = () => setConnected(true);
      socket.onmessage = (event) => {
        try {
          const state = JSON.parse(event.data);
          onGameReady({ initialGame: state, myColor: "white", myToken: whiteToken, roomId });
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

  const joinLink = `${window.location.origin}${window.location.pathname}?join=${roomId}`;

  function copyLink() {
    navigator.clipboard?.writeText(joinLink).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    });
  }

  return (
    <div className="custom-play">
      <div className="custom-play-toolbar">
        <span className="custom-play-turn">{connected ? "Waiting for opponent…" : "Connecting…"}</span>
      </div>
      <div className="online-waiting-panel">
        <p>Share this link with your opponent - they'll build their own deck for black:</p>
        <div className="online-waiting-link-row">
          <code className="online-waiting-link">{joinLink}</code>
          <button type="button" onClick={copyLink}>
            {linkCopied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
