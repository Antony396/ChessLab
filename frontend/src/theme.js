export const BOARD_THEMES = {
  classic: { name: "Classic Green", light: "#eeeed2", dark: "#769656" },
  walnut: { name: "Walnut", light: "#f0d9b5", dark: "#b58863" },
  midnight: { name: "Midnight Blue", light: "#dee3e6", dark: "#4b6584" },
  coral: { name: "Coral", light: "#fbe4dd", dark: "#c97b63" },
  slate: { name: "Slate", light: "#e8e9ed", dark: "#8493a8" },
  glass: {
    name: "Glass",
    light: "linear-gradient(155deg, #f5f2fb 0%, #e2dbf3 100%)",
    dark: "linear-gradient(155deg, #4d466b 0%, #2c2740 100%)",
    pieces: "glass",
    boardStyle: {
      borderRadius: "18px",
      boxShadow: "0 24px 60px rgba(20, 10, 40, 0.45), 0 0 0 1px rgba(255,255,255,0.08)",
    },
  },
};

export const DEFAULT_THEME = "classic";

export function loadStoredTheme() {
  try {
    const stored = localStorage.getItem("chess-eval-board-theme");
    return stored && BOARD_THEMES[stored] ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function storeTheme(themeKey) {
  try {
    localStorage.setItem("chess-eval-board-theme", themeKey);
  } catch {
    // ignore (private browsing, storage disabled, etc.)
  }
}
