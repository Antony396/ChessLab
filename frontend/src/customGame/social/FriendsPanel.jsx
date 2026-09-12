import { useEffect, useState } from "react";
import {
  acceptFriendRequest,
  declineFriendRequest,
  listFriendRequests,
  listFriends,
  searchUsers,
  sendFriendRequest,
} from "./api";
import "./friendsPanel.css";

const RELATIONSHIP_LABEL = {
  friends: "Already friends",
  request_sent: "Request sent",
  request_received: "They sent you a request",
};

// The Friends station: search for people to add, respond to incoming
// requests, and act on existing friends (visit their dorm live, or
// challenge them to a match with no code/link involved). Rendered inside
// the same overlay chrome the deck builder uses (see HeroChessApp.jsx).
export default function FriendsPanel({ token, onVisit, onChallenge }) {
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function refresh() {
    try {
      const [friendsList, requestsList] = await Promise.all([listFriends(token), listFriendRequests(token)]);
      setFriends(friendsList);
      setRequests(requestsList);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return undefined;
    }
    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      try {
        const found = await searchUsers(token, q);
        if (!cancelled) setResults(found);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [query, token]);

  async function handleAddFriend(userId) {
    setError(null);
    try {
      await sendFriendRequest(token, userId);
      setResults((prev) => prev.map((r) => (r.id === userId ? { ...r, relationship: "request_sent" } : r)));
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleAccept(requestId) {
    setError(null);
    try {
      await acceptFriendRequest(token, requestId);
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDecline(requestId) {
    setError(null);
    try {
      await declineFriendRequest(token, requestId);
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="friends-panel">
      <div className="friends-search">
        <input
          type="text"
          placeholder="Search by username…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {results.length > 0 && (
          <ul className="friends-search-results">
            {results.map((r) => (
              <li key={r.id}>
                <span>{r.username}</span>
                {r.relationship === "none" ? (
                  <button type="button" onClick={() => handleAddFriend(r.id)}>
                    Add friend
                  </button>
                ) : (
                  <span className="friends-relationship-tag">{RELATIONSHIP_LABEL[r.relationship]}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <div className="friends-error">{error}</div>}

      {requests.length > 0 && (
        <div className="friends-section">
          <h3>Friend Requests</h3>
          <ul className="friends-list">
            {requests.map((r) => (
              <li key={r.id}>
                <span>{r.from_user.username}</span>
                <span className="friends-row-actions">
                  <button type="button" className="friends-accept-btn" onClick={() => handleAccept(r.id)}>
                    Accept
                  </button>
                  <button type="button" className="friends-decline-btn" onClick={() => handleDecline(r.id)}>
                    Decline
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="friends-section">
        <h3>Friends</h3>
        {loading ? (
          <p className="friends-hint">Loading…</p>
        ) : friends.length === 0 ? (
          <p className="friends-hint">No friends yet - search above to add someone.</p>
        ) : (
          <ul className="friends-list">
            {friends.map((f) => (
              <li key={f.id}>
                <span className={`friends-status-dot${f.online ? " online" : ""}`} aria-hidden="true" />
                <span>{f.username}</span>
                <span className="friends-row-actions">
                  <button type="button" disabled={!f.online} onClick={() => onVisit(f)} title={f.online ? "" : "Offline"}>
                    Visit
                  </button>
                  <button
                    type="button"
                    disabled={!f.online}
                    onClick={() => onChallenge(f)}
                    title={f.online ? "" : "Offline"}
                  >
                    Challenge
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
