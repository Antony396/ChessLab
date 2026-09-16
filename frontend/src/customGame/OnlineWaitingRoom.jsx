import { useEffect, useRef, useState } from "react";
import { onlineRoomWsUrl } from "./api";

// The creator waits here, sharing the room link, until a second player
// drafts a deck and joins - the server broadcasts the finished game over
// this room-level socket the moment that happens, and this component hands
// off to actual play.
export default function OnlineWaitingRoom({ roomId, whiteToken, onGameReady, onExit }) {
  const [connected, setConnected] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
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
          // A keepalive frame (see backend's _hold_open) - not the game
          // state this socket is actually waiting for.
          if (state.type === "ping") return;
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

  // A plain elapsed-time counter, purely to reassure whoever's waiting that
  // something's actually happening rather than silently stuck - not tied to
  // any real timeout, just a visible "this is normal, keep waiting" signal.
  useEffect(() => {
    const interval = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const joinLink = `${window.location.origin}${window.location.pathname}?join=${roomId}`;
  const minutes = String(Math.floor(elapsedSeconds / 60)).padStart(2, "0");
  const seconds = String(elapsedSeconds % 60).padStart(2, "0");

  function copyLink() {
    navigator.clipboard?.writeText(joinLink).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    });
  }

  return (
    <div className="custom-play">
      <div className="custom-play-toolbar">
        <span className="custom-play-turn">
          <span className={`online-waiting-dot${connected ? " connected" : ""}`} aria-hidden="true" />
          {connected ? "Waiting for opponent…" : "Connecting…"}
        </span>
        <button type="button" onClick={onExit}>
          Home
        </button>
      </div>

      <div className="online-waiting-panel">
        <div className="online-waiting-spinner" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <h2 className="online-waiting-title">Waiting for your opponent</h2>
        <p className="online-waiting-subtitle">
          They're building their deck right now - this screen switches over the instant they're done.
        </p>
        <p className="online-waiting-elapsed">
          {minutes}:{seconds}
        </p>

        <p className="online-waiting-hint">Share this link with them to get started:</p>
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
