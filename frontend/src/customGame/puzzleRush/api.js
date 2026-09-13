const API_ROOT = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
const API_BASE = `${API_ROOT}/api/puzzle-rush`;

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

export function postStartRush(token, durationSeconds) {
  return fetch(`${API_BASE}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ duration_seconds: durationSeconds }),
  }).then(handle);
}

export function postRushMove(token, payload) {
  return fetch(`${API_BASE}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(payload),
  }).then(handle);
}
