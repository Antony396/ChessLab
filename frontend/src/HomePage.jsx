import "./Home.css";

function BoardIcon() {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z" strokeLinejoin="round" />
      <path
        d="M12 8.2l1.3 2.6 2.9.4-2.1 2 .5 2.9-2.6-1.4-2.6 1.4.5-2.9-2.1-2 2.9-.4z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const FEATURES = [
  {
    key: "analyzer",
    icon: BoardIcon,
    title: "Game Analyzer",
    description:
      "Pull your recent games from Chess.com or Lichess and step through them with Stockfish's evaluation, best-move suggestions, and a flagged list of your inaccuracies, mistakes, and blunders.",
    tags: ["Chess.com", "Lichess", "Stockfish"],
  },
  {
    key: "hero-chess",
    icon: ShieldIcon,
    title: "Hero Chess",
    description:
      "Draft a custom back-rank formation for each side, assign one piece a Dragon Knight or Battering Rook ability, and play it out — a pass-and-play variant separate from the analyzer.",
    tags: ["Custom setup", "Hero abilities", "Pass and play"],
  },
];

export default function HomePage({ onSelect }) {
  return (
    <div className="home">
      <div className="home-hero">
        <h1>Chess Lab</h1>
        <p className="home-subtitle">A local chess toolkit. Pick a tool to get started.</p>
      </div>

      <div className="home-cards">
        {FEATURES.map((feature) => {
          const Icon = feature.icon;
          return (
            <button
              key={feature.key}
              type="button"
              className="home-card"
              onClick={() => onSelect(feature.key)}
            >
              <span className="home-card-icon">
                <Icon />
              </span>
              <h2>{feature.title}</h2>
              <p>{feature.description}</p>
              <div className="home-card-tags">
                {feature.tags.map((tag) => (
                  <span key={tag} className="home-card-tag">
                    {tag}
                  </span>
                ))}
              </div>
              <span className="home-card-cta">Open →</span>
            </button>
          );
        })}
      </div>

      <p className="home-footer">Runs entirely on this machine — your games and analysis never leave your PC.</p>
    </div>
  );
}
