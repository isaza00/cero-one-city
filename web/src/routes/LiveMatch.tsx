// Screen 8: live match - Pixi map, scoreboard, feed, highlights, shout button.

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { get, post } from "../api/client";
import type { AgentPublic } from "../api/types";
import { ErrorText, Feed, PlayerBadge, Scoreboard } from "../components/bits";
import MapView from "../pixi/MapView";
import { useAuth } from "../store/auth";
import { useSpectate } from "../ws/useSpectate";

export default function LiveMatch() {
  const { matchId } = useParams();
  const { user } = useAuth();
  const data = useSpectate(matchId);
  const [myAgents, setMyAgents] = useState<AgentPublic[]>([]);
  const [shoutText, setShoutText] = useState("");
  const [shoutError, setShoutError] = useState<string | null>(null);
  const [shoutsUsed, setShoutsUsed] = useState(0);

  useEffect(() => {
    if (user) get<{ agents: AgentPublic[] }>("/api/agents")
      .then((r) => setMyAgents(r.agents)).catch(() => undefined);
  }, [user]);

  const myPlayer = useMemo(() => {
    const mine = new Set(myAgents.map((a) => a.id));
    return data.players.find((p) => mine.has(p.agent_id)) ?? null;
  }, [myAgents, data.players]);

  const sendShout = async () => {
    if (!myPlayer || !shoutText.trim()) return;
    setShoutError(null);
    try {
      const r = await post<{ shout: { match_used: number } }>(
        `/api/matches/${matchId}/shout`,
        { agent_id: myPlayer.agent_id, text: shoutText.trim() });
      setShoutsUsed(r.shout.match_used);
      setShoutText("");
    } catch (err) {
      setShoutError((err as Error).message);
    }
  };

  const scoreboard = data.scoreboard.length > 0 ? data.scoreboard
    : data.players.map((p) => ({ player_index: p.player_index, agent_id: p.agent_id,
                                 name: p.name, score: p.score ?? 0,
                                 alive: p.status === "alive" }));

  return (
    <>
      <div className="row" style={{ alignItems: "center" }}>
        <h2 className="col">
          {data.match?.format ?? "match"} · turn {data.turn}/{data.match?.max_turns ?? 40}
          {" "}
          {data.connected ? <span className="badge ok">live</span>
                          : <span className="badge warn">reconnecting</span>}
          {data.finished && <span className="badge">finished</span>}
        </h2>
        {data.finished && (
          <Link to={`/matches/${matchId}/result`}><button>Results</button></Link>
        )}
        <Link to={`/matches/${matchId}/replay`}>
          <button className="secondary">Replay</button>
        </Link>
      </div>

      <div className="row">
        <div>
          <MapView state={data.state} sizePx={620} />
          <p className="hint">
            {data.players.map((p) => (
              <PlayerBadge key={p.player_index} index={p.player_index} name={p.name} />
            ))}
          </p>
        </div>
        <div className="col">
          <div className="card">
            <h3>Scoreboard</h3>
            <Scoreboard rows={scoreboard} />
          </div>
          {myPlayer && !data.finished && (
            <div className="card">
              <h3>Shout from the bench <span className="hint">({shoutsUsed}/2 this match)</span></h3>
              <p className="hint">A short message your agent reads next turn - it
                decides whether to obey. Everyone sees THAT you intervened, never what you said.</p>
              <input value={shoutText} maxLength={200} placeholder="Hold the truce, hit player 0..."
                     onChange={(e) => setShoutText(e.target.value)} />
              <ErrorText error={shoutError} />
              <button onClick={sendShout} disabled={!shoutText.trim() || shoutsUsed >= 2}>
                Shout
              </button>
            </div>
          )}
          <div className="card">
            <h3>Key moments</h3>
            {data.highlights.slice(-8).reverse().map((h, i) => (
              <div className="highlight-banner" key={i}>
                T{h.turn} · {h.text ?? h.kind}
              </div>
            ))}
            {data.highlights.length === 0 && <p className="hint">Nothing dramatic yet.</p>}
          </div>
        </div>
        <div className="col">
          <div className="card">
            <h3>Feed</h3>
            <Feed lines={data.feed} />
          </div>
        </div>
      </div>
    </>
  );
}
