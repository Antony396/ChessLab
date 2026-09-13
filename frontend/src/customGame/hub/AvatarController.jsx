import { useEffect } from "react";
import SpeechBubble from "./SpeechBubble";

const KEY_TO_DIRECTION = {
  w: "up",
  arrowup: "up",
  s: "down",
  arrowdown: "down",
  a: "left",
  arrowleft: "left",
  d: "right",
  arrowright: "right",
};

// Owns keyboard input (WASD + arrow keys) and renders the King avatar at
// its current grid tile, facing the right way, hopping on every step. Pure
// controller + view - it never touches game/session state, only the tiny
// slice of hub state passed in as props.
export default function AvatarController({ position, facing, isHopping, bubbleText, skin, tileSize, onStep }) {
  useEffect(() => {
    function handleKeyDown(e) {
      const direction = KEY_TO_DIRECTION[e.key.toLowerCase()];
      if (!direction) return;
      // Don't hijack typing if a modal's input/textarea happens to have
      // focus, and don't scroll the page on arrow keys.
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      onStep(direction);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onStep]);

  const style = {
    transform: `translate(${position.x * tileSize}px, ${position.y * tileSize}px)`,
  };

  return (
    <div className={`hub-avatar facing-${facing}${isHopping ? " hopping" : ""}`} style={style}>
      {bubbleText && <SpeechBubble text={bubbleText} />}
      <img src={skin.src} alt={skin.name} className="hub-avatar-img" draggable={false} />
      <div className="hub-avatar-shadow" />
    </div>
  );
}
