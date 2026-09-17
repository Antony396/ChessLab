import { clearAuth } from "../social/authStore";

const API_ROOT = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
const API_BASE = `${API_ROOT}/api`;

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

export function fetchTodaysPuzzle(token) {
  return fetch(`${API_BASE}/daily-puzzle/today`, { headers: authHeaders(token) }).then(handle);
}

export function fetchMyStreak(token) {
  return fetch(`${API_BASE}/daily-puzzle/streak`, { headers: authHeaders(token) }).then(handle);
}

export function postDailyPuzzleMove(token, payload) {
  return fetch(`${API_BASE}/daily-puzzle/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(payload),
  }).then(handle);
}
