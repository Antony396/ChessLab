import { useState } from "react";
import { postLogin, postRegister } from "./api";
import { setAuth } from "./authStore";
import "./authGate.css";

// The app's true landing screen for a signed-out visitor - Evo Chess itself
// only ever renders once someone's logged in, since usernames/friends/the
// dorm-visiting presence layer all need a real identity to hang off of.
export default function AuthGate() {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = mode === "login" ? await postLogin({ username, password }) : await postRegister({ username, password });
      setAuth(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-gate">
      <div className="auth-card">
        <h1 className="auth-title">Evo Chess</h1>
        <p className="auth-subtitle">
          {mode === "login" ? "Sign in to enter your dorm." : "Create an account to get your own dorm."}
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          <label className="auth-field">
            <span>Username</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              minLength={3}
              maxLength={20}
              required
            />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={6}
              required
            />
          </label>

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="auth-submit-btn" disabled={submitting}>
            {submitting ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>

        <button
          type="button"
          className="auth-switch-btn"
          onClick={() => {
            setMode((m) => (m === "login" ? "register" : "login"));
            setError(null);
          }}
        >
          {mode === "login" ? "Need an account? Create one" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
