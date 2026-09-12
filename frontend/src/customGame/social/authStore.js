import { useSyncExternalStore } from "react";

// Logged-in identity: {token, user: {id, username}} | null. A plain
// module-level store (see skinStore.js for the same pattern/rationale) so
// anything in the app can read/react to auth state without threading it
// through every component's props.
const STORAGE_KEY = "evoChessAuth";

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

let auth = loadInitial();
const listeners = new Set();

export function getAuth() {
  return auth;
}

export function setAuth(next) {
  auth = next;
  try {
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // fine to just not persist it
  }
  listeners.forEach((notify) => notify());
}

export function clearAuth() {
  setAuth(null);
}

function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function useAuth() {
  return useSyncExternalStore(subscribe, getAuth);
}
