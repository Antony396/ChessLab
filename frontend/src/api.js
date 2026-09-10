// In production (Vercel), set VITE_API_BASE_URL to the deployed backend's
// origin (e.g. "https://your-app.onrender.com"). Falls back to local dev.
const API_BASE = `${import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000"}/api`;

async function handle(res) {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      // response wasn't JSON, keep statusText
    }
    throw new Error(detail);
  }
  return res.json();
}

export function fetchGames(platform, username, count = 10) {
  const params = new URLSearchParams({ platform, username, count });
  return fetch(`${API_BASE}/games?${params}`).then(handle);
}

export function fetchGameAnalysis(gameId, depth) {
  const params = new URLSearchParams(depth ? { depth } : {});
  const qs = params.toString() ? `?${params}` : "";
  return fetch(`${API_BASE}/games/${encodeURIComponent(gameId)}/analysis${qs}`).then(handle);
}
