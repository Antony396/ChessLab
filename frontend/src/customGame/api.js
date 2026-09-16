// In production (Vercel), set VITE_API_BASE_URL to the deployed backend's
// origin (e.g. "https://your-app.onrender.com"). Falls back to local dev.
const API_ROOT = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
const API_BASE = `${API_ROOT}/api/game`;

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

export function postCustomSetup(payload) {
  return fetch(`${API_BASE}/custom-setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(handle);
}

export function postCustomMove(payload) {
  return fetch(`${API_BASE}/custom-move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(handle);
}

export function fetchCustomGame(gameId) {
  return fetch(`${API_BASE}/${encodeURIComponent(gameId)}`).then(handle);
}

export function postAiMove(gameId) {
  return fetch(`${API_BASE}/${encodeURIComponent(gameId)}/ai-move`, { method: "POST" }).then(handle);
}

// --- Online multiplayer --------------------------------------------------

export function postOnlineCreate(payload) {
  return fetch(`${API_BASE}/online/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(handle);
}

export function postOnlineRoomJoin(roomId, payload) {
  return fetch(`${API_BASE}/online/room/${encodeURIComponent(roomId)}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(handle);
}

export function postOnlineMove(payload) {
  return fetch(`${API_BASE}/online/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(handle);
}

export function postOnlineResign(payload) {
  return fetch(`${API_BASE}/online/resign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(handle);
}

function wsRoot() {
  return API_ROOT.replace(/^http/, "ws");
}

export function onlineRoomWsUrl(roomId) {
  return `${wsRoot()}/api/game/online/room/${encodeURIComponent(roomId)}/ws`;
}

export function onlineGameWsUrl(gameId) {
  return `${wsRoot()}/api/game/online/${encodeURIComponent(gameId)}/ws`;
}
