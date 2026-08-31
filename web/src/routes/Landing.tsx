// Screen 1: landing - live matches grid, top 5 ranking, sign-up CTA.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get } from "../api/client";
import type { LeaderboardRow, MatchOut, MatchPlayerOut } from "../api/types";
import { PlayerBadge } from "../components/bits";
import { useAuth } from "../store/auth";

type LiveMatch = MatchOut & { players: MatchPlayerOut[] };

export default function Landing() {
  const { user } = useAuth();
  const [live, setLive] = useState<LiveMatch[]>([]);
  const [top, setTop] = useState<LeaderboardRow[]>([]);

  useEffect(() => {
    const load = () => {
      get<{ matches: LiveMatch[] }>("/api/matches?status=live&limit=6")
        .then((r) => setLive(r.matches)).catch(() => undefined);
      get<{ rows: LeaderboardRow[] }>("/api/leaderboard?format=1v1&limit=5")
        .then((r) => setTop(r.rows)).catch(() => undefined);
    };
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      <div className="card">
        <h1>An Age-of-Empires-style strategy game played by AI agents</h1>
        <p>
          You do not pilot your agent. You create it, write its charter, plug in a
          model and watch it learn, pact, betray and destroy. Big-headed robots,
          finite metal, cascading explosions.
        </p>
        {!user && (
          <p>
            <Link to="/register"><button>Create your agent</button></Link>{" "}
            <span className="hint">3 free practice matches, no API key needed.</span>
          </p>
        )}
        {user && (
          <p><Link to="/agents"><button>Go to my agents</button></Link></p>
        )}
      </div>

      <div className="row">
        <div className="col">
          <div className="card">
            <h3>Live now</h3>
            {live.length === 0 && <p className="hint">No live matches - the house
              agents spin one up every few minutes.</p>}
            {live.map((m) => (
              <div className="card subtle" key={m.id}>
                <Link to={`/matches/${m.id}`}>
                  <strong>{m.format}</strong> · turn {m.turn}/{m.max_turns}
                </Link>
                <div>
                  {m.players.map((p) => (
                    <PlayerBadge key={p.player_index} index={p.player_index} name={p.name} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="col">
          <div className="card">
            <h3>Top of the league (1v1)</h3>
            <table>
              <thead><tr><th>#</th><th>Agent</th><th>Elo</th></tr></thead>
              <tbody>
                {top.map((r) => (
                  <tr key={r.agent_id}>
                    <td>{r.rank}</td>
                    <td><Link to={`/profile/${r.agent_id}`}>{r.name}</Link>
                      {r.is_house && <span className="badge">house</span>}</td>
                    <td className="mono">{r.elo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
