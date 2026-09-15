import { useCallback, useEffect, useRef, useState } from "react";
import { presenceWsUrl } from "./api";

export const CHAT_BUBBLE_DURATION_MS = 6000;
// Mirrors social_routes.py's own COMMONS_DORM_ID exactly - passing this as
// visit()'s target is how a client asks to join the shared Commons room
// instead of a specific account's dorm (see CommonsWorld.jsx).
export const COMMONS_DORM_ID = "__commons__";

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
  // Speech bubbles from OTHER players' chat messages - user_id -> {text,
  // key}. `key` (a fresh value per message) is what the fade-out timeout
  // below checks before clearing, so an in-flight timer for an older
  // message can never wipe out a newer one that arrived in the meantime.
  // My own sent messages aren't tracked here at all - the sender shows
  // its own bubble locally instead (see HubWorld.jsx), since presence_ws
  // never echoes a chat message back to its own sender.
  const [chatBubbles, setChatBubbles] = useState({});
  const wsRef = useRef(null);
  const chatBubbleTimersRef = useRef({});
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
            // Switching which dorm is on screen (my own view changed, or I
            // just visited someone) - any bubble left over from whatever
            // was showing before is now stale.
            for (const timer of Object.values(chatBubbleTimersRef.current)) window.clearTimeout(timer);
            chatBubbleTimersRef.current = {};
            setChatBubbles({});
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
            window.clearTimeout(chatBubbleTimersRef.current[msg.user_id]);
            delete chatBubbleTimersRef.current[msg.user_id];
            setChatBubbles((prev) => {
              if (!(msg.user_id in prev)) return prev;
              const next = { ...prev };
              delete next[msg.user_id];
              return next;
            });
            break;
          case "chat": {
            const key = `${Date.now()}-${Math.random()}`;
            setChatBubbles((prev) => ({ ...prev, [msg.user_id]: { text: msg.text, key } }));
            window.clearTimeout(chatBubbleTimersRef.current[msg.user_id]);
            chatBubbleTimersRef.current[msg.user_id] = window.setTimeout(() => {
              setChatBubbles((prev) => {
                if (prev[msg.user_id]?.key !== key) return prev;
                const next = { ...prev };
                delete next[msg.user_id];
                return next;
              });
            }, CHAT_BUBBLE_DURATION_MS);
            break;
          }
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

  // Never echoed back to me by the server (see presence_ws) - my own
  // bubble is shown locally by the caller (HubWorld.jsx) the instant this
  // is called, same pattern as sendMove's own optimistic local update.
  const sendChat = useCallback((text) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "chat", text }));
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
    chatBubbles,
    sendMove,
    sendChat,
    visit,
    leaveDorm,
  };
}
