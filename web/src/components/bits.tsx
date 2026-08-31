// Small shared UI pieces.

import type { FeedLine, ScoreboardRow } from "../api/types";
import { PLAYER_COLOR_CSS } from "../game/meta";

export function PlayerBadge({ index, name }: { index: number; name?: string | null }) {
  return (
    <span className={`badge p${index % 4}`} style={{ borderColor: PLAYER_COLOR_CSS[index % 4] }}>
      P{index}{name ? ` ${name}` : ""}
    </span>
  );
}

export function Feed({ lines }: { lines: FeedLine[] }) {
  return (
    <div className="feed">
      {lines.length === 0 && <div className="hint">Nothing yet...</div>}
      {lines.map((l, i) => (
        <div className="line" key={i}>
          {l.turn !== undefined && <span className="turn">T{l.turn}</span>}
          {l.player_index !== null && l.player_index !== undefined && (
            <PlayerBadge index={l.player_index} />
          )}
          {l.text}
        </div>
      ))}
    </div>
  );
}

export function Scoreboard({ rows }: { rows: ScoreboardRow[] }) {
  return (
    <table>
      <thead>
        <tr><th>Player</th><th>Score</th><th>Status</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.player_index}>
            <td><PlayerBadge index={r.player_index} name={r.name} /></td>
            <td className="mono">{r.score}</td>
            <td>{r.alive ? <span className="badge ok">alive</span>
                        : <span className="badge danger">out</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ErrorText({ error }: { error: string | null }) {
  return error ? <div className="error">{error}</div> : null;
}
