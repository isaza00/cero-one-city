// Score-over-time chart: responsive SVG (viewBox, never a fixed pixel width)
// with a name legend. Used live in the match side panel and on the results page.

import { PLAYER_COLOR_CSS } from "../game/meta";

export default function ScoreChart({ series, names, height = 180 }: {
  /** One row per sampled turn; each row = score per player_index. */
  series: number[][];
  /** player_index -> display name (legend). */
  names: Map<number, string>;
  height?: number;
}) {
  if (series.length < 2) {
    return <p className="hint">The chart draws itself after a couple of turns...</p>;
  }
  const w = 560;
  const h = height;
  const max = Math.max(...series.flat(), 1);
  const paths = (series[0] ?? []).map((_, pid) => {
    const points = series.map((row, i) =>
      `${(i / (series.length - 1)) * w},${h - ((row[pid] ?? 0) / max) * (h - 10)}`);
    return <polyline key={pid} points={points.join(" ")} fill="none"
                     stroke={PLAYER_COLOR_CSS[pid % 4]} strokeWidth={2}
                     vectorEffect="non-scaling-stroke" />;
  });
  return (
    <div style={{ width: "100%" }}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"
           style={{ width: "100%", height: "auto", display: "block",
                    background: "var(--panel2)", borderRadius: 8 }}>
        {paths}
      </svg>
      <p className="hint" style={{ margin: "8px 0 0" }}>
        {(series[0] ?? []).map((_, pid) => (
          <span key={pid} style={{ marginRight: 14 }}>
            <span style={{ color: PLAYER_COLOR_CSS[pid % 4] }}>■</span>{" "}
            {names.get(pid) ?? `P${pid}`}
          </span>
        ))}
      </p>
    </div>
  );
}
