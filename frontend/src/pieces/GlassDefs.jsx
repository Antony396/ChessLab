// Shared SVG gradient/filter definitions referenced by glassPieces.jsx via
// url(#...). Mounted once near the app root (main.jsx) - <defs> alone render
// nothing, so this is a zero-size, always-safe inclusion regardless of which
// view is active.
export default function GlassDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <defs>
        {/* Genuinely translucent - the middle stop is deliberately low-opacity
            so the board shows through, with a bright top glint and a
            grounded, more opaque base for readability. */}
        <linearGradient id="glass-white-fill" x1="10%" y1="0%" x2="75%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="35%" stopColor="#cdbdfa" stopOpacity="0.28" />
          <stop offset="70%" stopColor="#a48ef2" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.6" />
        </linearGradient>
        <linearGradient id="glass-black-fill" x1="10%" y1="0%" x2="75%" y2="100%">
          <stop offset="0%" stopColor="#b6a3ff" stopOpacity="0.8" />
          <stop offset="35%" stopColor="#241c3d" stopOpacity="0.45" />
          <stop offset="70%" stopColor="#0d0a18" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.78" />
        </linearGradient>

        <radialGradient id="glass-shine" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>

        <filter id="glass-blur-soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>
    </svg>
  );
}
