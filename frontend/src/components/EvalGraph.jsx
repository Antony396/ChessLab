import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatEval } from "../utils/evalFormat";

const CLAMP = 1000; // +/- 10 pawns; mate scores (up to 100000) saturate here for readability

function clamp(cp) {
  return Math.max(-CLAMP, Math.min(CLAMP, cp));
}

export default function EvalGraph({ analysis, currentPly, setCurrentPly }) {
  const data = [
    { ply: 0, eval: clamp(analysis.moves[0]?.eval_before ?? 0) },
    ...analysis.moves.map((m, i) => ({ ply: i + 1, eval: clamp(m.eval_after) })),
  ];

  return (
    <div className="eval-graph">
      <ResponsiveContainer width="100%" height={150}>
        <LineChart
          data={data}
          onClick={(e) => {
            if (e && e.activeLabel !== undefined) setCurrentPly(Number(e.activeLabel));
          }}
        >
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis dataKey="ply" tick={{ fontSize: 10 }} />
          <YAxis domain={[-CLAMP, CLAMP]} tick={{ fontSize: 10 }} width={40} />
          <Tooltip formatter={(v) => formatEval(v)} labelFormatter={(l) => `ply ${l}`} />
          <ReferenceLine y={0} stroke="#94a3b8" />
          <ReferenceLine x={currentPly} stroke="#3b82f6" />
          <Line type="monotone" dataKey="eval" stroke="#16a34a" dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
