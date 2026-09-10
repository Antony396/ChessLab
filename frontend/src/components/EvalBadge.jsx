import { formatEval } from "../utils/evalFormat";

export default function EvalBadge({ cp }) {
  const cls = cp > 20 ? "eval-badge-pos" : cp < -20 ? "eval-badge-neg" : "eval-badge-neutral";
  return (
    <div className={`eval-badge ${cls}`} title="Advantage from the searched player's perspective">
      {formatEval(cp)}
    </div>
  );
}
