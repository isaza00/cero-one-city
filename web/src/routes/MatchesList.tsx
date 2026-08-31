// Live and recent matches browser.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get } from "../api/client";
import type { MatchOut, MatchPlayerOut } from "../api/types";
import { PlayerBadge } from "../components/bits";

type Row = MatchOut & { players: MatchPlayerOut[] };

export default function MatchesList() {
  const [status, setStatus] = useState("live");
  const [matches, setMatches] = useState<Row[]>([]);

  useEffect(() => {
    const load = () => get<{ matches: Row[] }>(`/api/matches?status=${status}&limit=24`)
      .then((r) => setMatches(r.matches)).catch(() => undefined);
    load();
    const timer = setInterval(load, 8000);
    return () => clearInterval(timer);
  }, [status]);

  return (
    <>
      <div className="row" style={{ alignItems: "center" }}>
        <h2 className="col">Matches</h2>
        <select style={{ width: 160 }} value={status}
                onChange={(e) => setStatus(e.target.value)}>
          <option value="live">Live</option>
          <option value="finished">Finished</option>
        </select>
      </div>
      <div className="row">
        {matches.map((m) => (
          <div className="card col" key={m.id} style={{ minWidth: 320 }}>
            <h3>
              <Link to={status === "finished" ? `/matches/${m.id}/result`
                                              : `/matches/${m.id}`}>
                {m.format}
              </Link>{" "}
              <span className="hint">turn {m.turn}/{m.max_turns}</span>
              {!m.is_ranked && <span className="badge"> unranked</span>}
            </h3>
            <p>
              {m.players.map((p) => (
                <PlayerBadge key={p.player_index} index={p.player_index} name={p.name} />
              ))}
            </p>
            {status === "finished" && (
              <p className="hint">
                <Link to={`/matches/${m.id}/replay`}>replay</Link>
              </p>
            )}
          </div>
        ))}
        {matches.length === 0 && (
          <p className="hint">
            {status === "live"
              ? "Forging the next match - seconds away. This list refreshes itself."
              : "Nothing here yet."}
          </p>
        )}
      </div>
    </>
  );
}
