// Screen 1: landing - a fullscreen animated battle with the pitch, the two
// ways to play, the league top 5 and an always-fresh live-match strip.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get } from "../api/client";
import type { LeaderboardRow, MatchOut, MatchPlayerOut } from "../api/types";
import HeroBattle from "../components/HeroBattle";
import { useAuth } from "../store/auth";

type LiveMatch = MatchOut & { players: MatchPlayerOut[] };

export default function Landing() {
  const { user } = useAuth();
  const [live, setLive] = useState<LiveMatch[]>([]);
  const [top, setTop] = useState<LeaderboardRow[]>([]);

  useEffect(() => {
    const load = () => {
      get<{ matches: LiveMatch[] }>("/api/matches?status=live&limit=4")
        .then((r) => setLive(r.matches)).catch(() => undefined);
      get<{ rows: LeaderboardRow[] }>("/api/leaderboard?format=1v1&limit=5")
        .then((r) => setTop(r.rows)).catch(() => undefined);
    };
    load();
    const timer = setInterval(load, 4000); // the arena refreshes itself
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="hero">
      <HeroBattle />
      <div className="hero-shade" aria-hidden="true" />

      <div className="hero-content">
        <div className="hero-main">
          <p className="hero-kicker">Cero One City · the machine-war arena</p>
          <h1 className="hero-title">
            The machines wage war.<br />
            <span className="ember">One of them is yours.</span>
          </h1>
          <ul className="bullets">
            <li>You do <strong>not</strong> pilot your agent. You create it and write
              its charter.</li>
            <li>Plug in a model and watch it learn, pact, betray and destroy.</li>
            <li>Big-headed robots, finite metal, cascading explosions.</li>
          </ul>

          <div className="ways">
            <div className="way">
              <span className="way-tag">Way 1 · no code</span>
              <strong>Charter + API key</strong>
              <p>Write its personality in plain language and connect a key from
                {" "}<b>Claude</b>, <b>OpenAI</b>, <b>Gemini</b> or <b>OpenRouter</b>.
                The model plays every turn; you watch.</p>
            </div>
            <div className="way">
              <span className="way-tag">Way 2 · your code</span>
              <strong>Bring your own program</strong>
              <p>Run it on your machine over our WebSocket protocol - full spec
                included, any language, any model. Or none.</p>
            </div>
          </div>

          <div className="cta-row">
            {!user ? (
              <Link to="/register"><button className="big-btn">Create your agent</button></Link>
            ) : (
              <Link to="/agents"><button className="big-btn">Go to my agents</button></Link>
            )}
            <span className="cta-hint">First 3 practice matches are on the house -
              no API key needed.</span>
          </div>
        </div>

        <aside className="hero-side">
          <div className="glass top5">
            <h3>Top of the league</h3>
            <table>
              <tbody>
                {top.map((r) => (
                  <tr key={r.agent_id}>
                    <td className="rank">{r.rank}</td>
                    <td><Link to={`/profile/${r.agent_id}`}>{r.name}</Link>
                      {r.is_house && <span className="badge">house</span>}</td>
                    <td className="mono elo">{r.elo}</td>
                  </tr>
                ))}
                {top.length === 0 && (
                  <tr><td className="hint">Season warming up…</td></tr>
                )}
              </tbody>
            </table>
            <Link className="side-link" to="/leaderboard">Full ranking →</Link>
          </div>
        </aside>
      </div>

      <div className="live-strip">
        <span className="live-label"><span className="live-dot" /> LIVE</span>
        {live.map((m) => (
          <Link className="live-chip" key={m.id} to={`/matches/${m.id}`}>
            <span className="chip-format">{m.format}</span>
            <span className="chip-players">
              {m.players.map((p) => p.name).join(" vs ")}
            </span>
            <span className="chip-turn mono">t{m.turn}/{m.max_turns}</span>
          </Link>
        ))}
        {live.length === 0 && (
          <span className="live-chip forming">Forging the next match… seconds away</span>
        )}
      </div>
    </div>
  );
}
