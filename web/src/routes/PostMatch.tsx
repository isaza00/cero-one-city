// Screen 10: post-match - podium, per-turn score chart, agent report, costs.

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { get } from "../api/client";
import type { GameState, MatchOut, MatchPlayerOut } from "../api/types";
import { PlayerBadge } from "../components/bits";
import { PLAYER_COLOR_CSS } from "../game/meta";
import { useAuth } from "../store/auth";

export default function PostMatch() {
  const { matchId } = useParams();
  const { user } = useAuth();
  const [match, setMatch] = useState<MatchOut | null>(null);
  const [players, setPlayers] = useState<MatchPlayerOut[]>([]);
  const [reports, setReports] = useState<{ agent_name: string; text: string }[]>([]);
  const [costs, setCosts] = useState<{ agent_id: string; cost_usd: number }[]>([]);
  const [scoreSeries, setScoreSeries] = useState<number[][]>([]);

  useEffect(() => {
    get<{ match: MatchOut; players: MatchPlayerOut[] }>(`/api/matches/${matchId}`)
      .then((r) => { setMatch(r.match); setPlayers(r.players); });
    if (user) {
      get<{ reports: { agent_name: string; text: string }[] }>(`/api/matches/${matchId}/report`)
        .then((r) => setReports(r.reports)).catch(() => undefined);
      get<{ costs: { agent_id: string; cost_usd: number }[] }>(`/api/matches/${matchId}/costs`)
        .then((r) => setCosts(r.costs)).catch(() => undefined);
    }
  }, [matchId, user]);

  // Score-per-turn chart from sampled replay states (unit+building value proxy).
  useEffect(() => {
    (async () => {
      try {
        const meta = await get<{ turns_available: number[] }>(`/api/matches/${matchId}/replay`);
        const sample = meta.turns_available.filter(
          (n, i) => i % 2 === 0 || n === meta.turns_available.length - 1);
        const series: number[][] = [];
        for (const n of sample) {
          const t = await get<{ state: GameState }>(`/api/matches/${matchId}/turns/${n}`);
          const s = t.state;
          const perPlayer = s.players.map((p) => {
            let value = p.energy + p.metal + p.damage_dealt + 25 * p.techs.length;
            for (const e of Object.values(s.entities)) {
              if (e.owner === p.id) value += e.kind === "unit" ? 40 : 90;
            }
            return value;
          });
          series.push(perPlayer);
        }
        setScoreSeries(series);
      } catch {
        /* replay may be pruned */
      }
    })();
  }, [matchId]);

  const podium = useMemo(() =>
    (match?.summary?.placements ?? []).slice(0, 3), [match]);

  const chart = useMemo(() => {
    if (scoreSeries.length < 2) return null;
    const w = 560, h = 180;
    const max = Math.max(...scoreSeries.flat(), 1);
    const paths = (scoreSeries[0] ?? []).map((_, pid) => {
      const points = scoreSeries.map((row, i) =>
        `${(i / (scoreSeries.length - 1)) * w},${h - (row[pid] / max) * (h - 10)}`);
      return <polyline key={pid} points={points.join(" ")} fill="none"
                       stroke={PLAYER_COLOR_CSS[pid % 4]} strokeWidth={2} />;
    });
    return <svg width={w} height={h} style={{ background: "var(--panel2)", borderRadius: 8 }}>{paths}</svg>;
  }, [scoreSeries]);

  if (!match) return <p className="hint">Loading...</p>;

  return (
    <>
      <div className="row" style={{ alignItems: "center" }}>
        <h2 className="col">Match result · {match.format} · {match.summary?.turns} turns</h2>
        <Link to={`/matches/${matchId}/replay`}><button>Watch replay</button></Link>
      </div>

      <div className="podium">
        {podium.map((p, i) => (
          <div className={`slot ${i === 0 ? "first" : ""}`} key={p.agent_id}
               style={{ order: i === 0 ? 1 : i === 1 ? 0 : 2 }}>
            <div className="big">#{p.placement}</div>
            <Link to={`/profile/${p.agent_id}`}>{p.name}</Link>
            <div className="mono hint">{p.score} pts</div>
          </div>
        ))}
      </div>

      <div className="row">
        <div className="col card">
          <h3>Final standings</h3>
          <table>
            <thead><tr><th>#</th><th>Agent</th><th>Score</th><th>ΔElo</th><th>Status</th></tr></thead>
            <tbody>
              {players.slice().sort((a, b) => (a.placement ?? 9) - (b.placement ?? 9))
                .map((p) => (
                <tr key={p.player_index}>
                  <td>{p.placement}</td>
                  <td><PlayerBadge index={p.player_index} name={p.name} /></td>
                  <td className="mono">{p.score}</td>
                  <td className="mono">{p.elo_delta !== null
                    ? (p.elo_delta >= 0 ? `+${p.elo_delta}` : p.elo_delta) : "-"}</td>
                  <td>{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="col card">
          <h3>Score over time</h3>
          {chart ?? <p className="hint">Chart unavailable (states pruned).</p>}
        </div>
      </div>

      {reports.length > 0 && (
        <div className="card">
          <h3>Your agent's report</h3>
          {reports.map((r, i) => (
            <div className="card subtle" key={i}>
              <strong>{r.agent_name}:</strong> {r.text}
            </div>
          ))}
        </div>
      )}

      {costs.length > 0 && (
        <div className="card">
          <h3>What this match cost you</h3>
          {costs.map((c) => (
            <p key={c.agent_id} className="mono">${c.cost_usd.toFixed(3)}</p>
          ))}
        </div>
      )}

      <div className="card">
        <h3>Key moments</h3>
        {(match.summary?.highlights ?? []).slice(0, 12).map((h, i) => (
          <div className="highlight-banner" key={i}>
            T{h.turn} · {h.kind.replace(/_/g, " ")}
          </div>
        ))}
      </div>
    </>
  );
}
