// Client-side preview FEN builder, mirrors backend/app/custom_chess/fen.py.
// Not authoritative - only used to render the setup board live as pieces are
// placed. The backend re-validates and builds the real FEN on submit.

const FILES = "abcdefgh";

export function buildDraftFen(whiteBackRank, blackBackRank) {
  const rank = (pieces, rankChar, upper) => {
    let row = "";
    let emptyRun = 0;
    for (const file of FILES) {
      const piece = pieces[`${file}${rankChar}`];
      if (!piece) {
        emptyRun += 1;
        continue;
      }
      if (emptyRun) {
        row += emptyRun;
        emptyRun = 0;
      }
      row += upper ? piece.toUpperCase() : piece.toLowerCase();
    }
    if (emptyRun) row += emptyRun;
    return row || "8";
  };

  const rank8 = rank(blackBackRank, "8", false);
  const rank7 = "p".repeat(8);
  const rank2 = "P".repeat(8);
  const rank1 = rank(whiteBackRank, "1", true);

  return `${rank8}/${rank7}/8/8/8/8/${rank2}/${rank1} w - - 0 1`;
}
