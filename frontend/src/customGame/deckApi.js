import { clearAuth } from "./social/authStore";

// Save/load for a player's own drafted decks (two slots, persisted
// server-side per account) - see backend/app/api/deck_routes.py.
const API_ROOT = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
const API_BASE = `${API_ROOT}/api/decks`;

async function handle(res) {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      // not JSON, keep statusText
    }
    if (res.status === 401) clearAuth();
    throw new Error(detail);
  }
  return res.json();
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function listSavedDecks(token) {
  return fetch(API_BASE, { headers: authHeaders(token) }).then(handle);
}

export function saveDeckToSlot(token, slot, payload) {
  return fetch(`${API_BASE}/${slot}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(payload),
  }).then(handle);
}

export function deleteSavedDeck(token, slot) {
  return fetch(`${API_BASE}/${slot}`, {
    method: "DELETE",
    headers: authHeaders(token),
  }).then(handle);
}
