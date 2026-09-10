import { useState } from "react";

export default function SearchForm({ onSearch, loading }) {
  const [platform, setPlatform] = useState("chesscom");
  const [username, setUsername] = useState("");
  const [count, setCount] = useState(10);

  function handleSubmit(e) {
    e.preventDefault();
    if (!username.trim()) return;
    onSearch({ platform, username: username.trim(), count: Number(count) });
  }

  return (
    <form className="search-form" onSubmit={handleSubmit}>
      <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
        <option value="chesscom">Chess.com</option>
        <option value="lichess">Lichess</option>
      </select>
      <input
        type="text"
        placeholder="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <input
        type="number"
        min={1}
        max={50}
        value={count}
        title="Number of recent games"
        onChange={(e) => setCount(e.target.value)}
      />
      <button type="submit" disabled={loading}>
        {loading ? "Loading…" : "Fetch games"}
      </button>
    </form>
  );
}
