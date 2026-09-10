const MATE_CP = 100000;
const MATE_THRESHOLD = 9000; // real (non-mate) evals never get remotely this large

export function isMateScore(cp) {
  return Math.abs(cp) >= MATE_THRESHOLD;
}

export function formatEval(cp) {
  if (isMateScore(cp)) {
    const movesToMate = MATE_CP - Math.abs(cp);
    return `#${cp > 0 ? "" : "-"}${movesToMate}`;
  }
  const pawns = cp / 100;
  return `${pawns > 0 ? "+" : ""}${pawns.toFixed(2)}`;
}
