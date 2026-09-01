// My agents index: rich cards with the lineage character, its power, a clear
// status in plain words, and PLAY buttons - the "how do I start?" screen.

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { del, get, post } from "../api/client";
import type { AgentPublic, User } from "../api/types";
import { ErrorText } from "../components/bits";
import LineageAvatar from "../components/LineageAvatar";
import UnitRoster from "../components/UnitRoster";
import { LINEAGES, lineageLabel } from "../game/meta";

export default function AgentsList() {
  const [agents, setAgents] = useState<AgentPublic[]>([]);
  const [me, setMe] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const navigate = useNavigate();

  const reload = useCallback(() => {
    get<{ agents: AgentPublic[] }>("/api/agents")
      .then((r) => setAgents(r.agents)).catch(() => undefined);
    get<User>("/api/auth/me").then(setMe).catch(() => undefined);
  }, []);

  useEffect(() => {
    reload();
    const timer = setInterval(reload, 4000); // statuses update themselves
    return () => clearInterval(timer);
  }, [reload]);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setError(null);
    setBusyId(id);
    try {
      await fn();
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const practiceLeft = me?.practice_remaining ?? 0;

  return (
    <>
      <div className="row" style={{ alignItems: "center" }}>
        <h2 className="col">My agents</h2>
        <Link to="/agents/new"><button className="secondary">New agent</button></Link>
      </div>
      <p className="hint">
        Matches are <strong>1v1 duels</strong> or <strong>free-for-alls with 3-4
        agents</strong> in one arena. Press "Find opponents" and you always get a
        game: if no rival shows up within about a minute, a house agent steps in.
        {" "}Want to fight a friend - or watch your own agents fight each other?{" "}
        <Link to="/custom">Create a private match →</Link>
      </p>
      <ErrorText error={error} />

      {agents.length === 0 && (
        <div className="card">
          <p>No agents yet.</p>
          <Link to="/onboarding"><button>Start onboarding</button></Link>
        </div>
      )}

      <div className="row">
        {agents.map((a) => (
          <div className="card col agent-card" key={a.id}>
            <div className="agent-card-head">
              <LineageAvatar lineage={a.lineage} size={84} />
              <div className="agent-card-id">
                <h3><Link to={`/agents/${a.id}`}>{a.name}</Link></h3>
                <p style={{ margin: "2px 0" }}>
                  <span className="badge">{lineageLabel(a.lineage)}</span>
                  <span className="badge">{a.kind === "hosted" ? "AI model" : "your code"}</span>
                  <span className="badge">lvl {a.level}</span>
                  {a.title && <span className="badge warn">{a.title}</span>}
                </p>
                <p className="hint" style={{ margin: 0 }}>
                  Elo {a.elo_by_format["1v1"]} (1v1) · {a.elo_by_format.ffa} (free-for-all)
                </p>
              </div>
            </div>

            <p className="hint agent-power">
              {LINEAGES[a.lineage]?.blurb ?? ""}
            </p>

            <details className="roster-details">
              <summary>Meet its units & their powers</summary>
              <UnitRoster lineage={a.lineage} />
            </details>

            {a.live_match_id ? (
              <>
                <p className="agent-status live">⚔ In battle right now!</p>
                <Link to={`/matches/${a.live_match_id}`}>
                  <button>Watch the battle</button>
                </Link>
              </>
            ) : a.queued_format ? (
              <>
                <p className="agent-status searching">
                  Searching for opponents ({a.queued_format})... if nobody shows up
                  in ~1 min, a house agent steps in.
                </p>
                <button className="secondary" disabled={busyId === a.id}
                        onClick={() => act(a.id, () => del(`/api/agents/${a.id}/queue`))}>
                  Stop searching
                </button>
              </>
            ) : (
              <>
                <p className="agent-status">Resting - not looking for matches.</p>
                <div className="agent-actions">
                  <button disabled={busyId === a.id}
                          onClick={() => act(a.id, () =>
                            post(`/api/agents/${a.id}/queue`, { format: "1v1" }))}>
                    ⚔ Find opponents (1v1)
                  </button>
                  <button className="secondary" disabled={busyId === a.id}
                          onClick={() => act(a.id, () =>
                            post(`/api/agents/${a.id}/queue`, { format: "ffa" }))}>
                    Free-for-all (3-4)
                  </button>
                  {practiceLeft > 0 && (
                    <button className="secondary" disabled={busyId === a.id}
                            onClick={() => act(a.id, async () => {
                              const r = await post<{ match_id: string }>(
                                `/api/agents/${a.id}/practice`);
                              navigate(`/matches/${r.match_id}`);
                            })}>
                      Practice (free, {practiceLeft} left)
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
