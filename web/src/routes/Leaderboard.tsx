// Screen 11: league ranking with season countdown.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get } from "../api/client";
import type { LeaderboardRow } from "../api/types";
import { lineageLabel } from "../game/meta";

export default function Leaderboard() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [format, setFormat] = useState("1v1");
  const [season, setSeason] = useState<{ number: number } | null>(null);
  const [daysLeft, setDaysLeft] = useState<number | null>(null);

  useEffect(() => {
    get<{ rows: LeaderboardRow[] }>(`/api/leaderboard?format=${format}&limit=100`)
      .then((r) => setRows(r.rows));
  }, [format]);

  useEffect(() => {
    get<{ season: { number: number }; days_left: number }>("/api/seasons/current")
      .then((r) => { setSeason(r.season); setDaysLeft(r.days_left); });
  }, []);

  return (
    <>
      <div className="row" style={{ alignItems: "center" }}>
        <h2 className="col">League · season {season?.number ?? "-"}</h2>
        <span className="badge warn">{daysLeft} days left</span>
        <select style={{ width: 160 }} value={format}
                onChange={(e) => setFormat(e.target.value)}>
          <option value="1v1">1v1 (serious)</option>
          <option value="ffa">FFA 3-4</option>
        </select>
      </div>
      <div className="card">
        <table>
          <thead>
            <tr><th>#</th><th>Agent</th><th>Lineage</th><th>Type</th><th>Lvl</th>
                <th>Elo</th><th>Played</th><th>Wins</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.agent_id}>
                <td>{r.rank}</td>
                <td>
                  <Link to={`/profile/${r.agent_id}`}>{r.name}</Link>
                  {r.is_house && <span className="badge"> house</span>}
                  {r.title && <span className="badge warn"> {r.title}</span>}
                </td>
                <td>{lineageLabel(r.lineage)}</td>
                <td>{r.kind}</td>
                <td>{r.level}</td>
                <td className="mono">{r.elo}</td>
                <td>{r.played}</td>
                <td>{r.wins}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="hint">No rated agents yet this season.</p>}
      </div>
    </>
  );
}
