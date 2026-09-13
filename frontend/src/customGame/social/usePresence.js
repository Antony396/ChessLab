import { useCallback, useEffect, useRef, useState } from "react";
import { presenceWsUrl } from "./api";

// Owns the single live presence WebSocket connection for a logged-in
// session: which dorm this browser is currently "standing in" (own by
// default, a friend's after visit()), who else is in that same dorm right
// now, and delivers server-pushed challenge/friend-request notifications
// via callbacks rather than state, since those are one-off events for the
// caller to react to (show a modal, refetch a list), not something to
// re-render around here.
export function usePresence(
  token,
  userId,
  { onChallenge, onChallengeAccepted, onChallengeDeclined, onFriendRequest } = {}
) {
  const [dormOwnerId, setDormOwnerId] = useState(userId);
  const [occupants, setOccupants] = useState({}); // user_id -> {username,x,y,facing,skin}
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const onChallengeRef = useRef(onChallenge);
  const onChallengeAcceptedRef = useRef(onChallengeAccepted);
  const onChallengeDeclinedRef = useRef(onChallengeDeclined);
  const onFriendRequestRef = useRef(onFriendRequest);
  onChallengeRef.current = onChallenge;
  onChallengeAcceptedRef.current = onChallengeAccepted;
  onChallengeDeclinedRef.current = onChallengeDeclined;
  onFriendRequestRef.current = onFriendRequest;

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    let reconnectTimeout = null;
    let ws = null;

    function connect() {
      if (cancelled) return;
      ws = new WebSocket(presenceWsUrl(token));
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case "dorm_snapshot": {
            setDormOwnerId(msg.owner_id);
            const next = {};
            for (const o of msg.occupants) next[o.user_id] = o;
            setOccupants(next);
            break;
          }
          case "peer_joined":
            setOccupants((prev) => ({ ...prev, [msg.user_id]: msg }));
            break;
          case "peer_move":
            setOccupants((prev) =>
              prev[msg.user_id] ? { ...prev, [msg.user_id]: { ...prev[msg.user_id], ...msg } } : prev
            );
            break;
          case "peer_left":
            setOccupants((prev) => {
              if (!(msg.user_id in prev)) return prev;
              const next = { ...prev };
              delete next[msg.user_id];
              return next;
            });
            break;
          case "challenge":
            onChallengeRef.current?.(msg);
            break;
          case "challenge_accepted":
            onChallengeAcceptedRef.current?.(msg);
            break;
          case "challenge_declined":
            onChallengeDeclinedRef.current?.(msg);
            break;
          case "friend_request":
            onFriendRequestRef.current?.(msg);
            break;
          default:
            break;
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (cancelled) return;
        reconnectTimeout = window.setTimeout(connect, 2000);
      };

      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimeout) window.clearTimeout(reconnectTimeout);
      ws?.close();
    };
  }, [token]);

  const sendMove = useCallback((x, y, facing, skin) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "move", x, y, facing, skin }));
    }
  }, []);

  const visit = useCallback((targetUserId) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "visit", user_id: targetUserId }));
    }
  }, []);

  const leaveDorm = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "leave" }));
    }
  }, []);

  return {
    connected,
    dormOwnerId,
    isInOwnDorm: dormOwnerId === userId,
    occupants: Object.values(occupants),
    sendMove,
    visit,
    leaveDorm,
  };
}
