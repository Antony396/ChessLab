const API_ROOT = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
const API_BASE = `${API_ROOT}/api/social`;

async function handle(res) {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      // not JSON, keep statusText
    }
    throw new Error(detail);
  }
  return res.json();
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function postRegister(payload) {
  return fetch(`${API_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(handle);
}

export function postLogin(payload) {
  return fetch(`${API_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(handle);
}

export function postLogout(token) {
  return fetch(`${API_BASE}/logout`, { method: "POST", headers: authHeaders(token) }).then(handle);
}

export function searchUsers(token, q) {
  return fetch(`${API_BASE}/users/search?q=${encodeURIComponent(q)}`, { headers: authHeaders(token) }).then(handle);
}

export function sendFriendRequest(token, toUserId) {
  return fetch(`${API_BASE}/friends/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ to_user_id: toUserId }),
  }).then(handle);
}

export function listFriendRequests(token) {
  return fetch(`${API_BASE}/friends/requests`, { headers: authHeaders(token) }).then(handle);
}

export function acceptFriendRequest(token, requestId) {
  return fetch(`${API_BASE}/friends/requests/${encodeURIComponent(requestId)}/accept`, {
    method: "POST",
    headers: authHeaders(token),
  }).then(handle);
}

export function declineFriendRequest(token, requestId) {
  return fetch(`${API_BASE}/friends/requests/${encodeURIComponent(requestId)}/decline`, {
    method: "POST",
    headers: authHeaders(token),
  }).then(handle);
}

export function listFriends(token) {
  return fetch(`${API_BASE}/friends`, { headers: authHeaders(token) }).then(handle);
}

export function postChallenge(token, payload) {
  return fetch(`${API_BASE}/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(payload),
  }).then(handle);
}

export function presenceWsUrl(token) {
  const wsRoot = API_ROOT.replace(/^http/, "ws");
  return `${wsRoot}/api/social/presence/ws?token=${encodeURIComponent(token)}`;
}
