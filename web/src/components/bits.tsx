// Small shared UI pieces.

import { useEffect, useRef } from "react";
import type { FeedLine, ScoreboardRow } from "../api/types";
import { banterFor } from "../game/banter";
import { PLAYER_COLOR_CSS } from "../game/meta";

export function PlayerBadge({ index, name }: { index: number; name?: string | null }) {
  return (
    <span className={`badge p${index % 4}`} style={{ borderColor: PLAYER_COLOR_CSS[index % 4] }}>
      {name ?? `P${index}`}
    </span>
  );
}

/** The war-room feed: agents "talk" (banter picked per event), the plain fact
 *  sits underneath, and the box keeps itself scrolled to the newest line. */
export function Commentary({ lines, names }: {
  lines: FeedLine[];
  names?: Map<number, string>;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <div className="commentary" ref={boxRef}>
      {lines.length === 0 && (
        <div className="hint" style={{ padding: 10 }}>
          The agents are sizing each other up...
        </div>
      )}
      {lines.map((l, i) => {
        const pid = l.player_index;
        const banter = banterFor(l);
        const name = pid !== null && pid !== undefined
          ? names?.get(pid) ?? `P${pid}` : null;
        return (
          <div className="chat-line" key={i}>
            {name !== null && pid !== null && pid !== undefined && (
              <span className="chat-name" style={{ color: PLAYER_COLOR_CSS[pid % 4] }}>
                {name}
              </span>
            )}
            {banter ? (
              <>
                <div className="chat-banter">{banter}</div>
                <div className="chat-fact">T{l.turn ?? "?"} · {l.text}</div>
              </>
            ) : (
              <div className="chat-fact solo">T{l.turn ?? "?"} · {l.text}</div>
            )}
          </div>
        );
      })}
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
