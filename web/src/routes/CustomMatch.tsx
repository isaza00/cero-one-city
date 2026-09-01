// Screen 14: custom (unranked) matches by invite code.

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { get, post } from "../api/client";
import type { AgentPublic } from "../api/types";
import { ErrorText } from "../components/bits";

export default function CustomMatch() {
  const [agents, setAgents] = useState<AgentPublic[]>([]);
  const [format, setFormat] = useState("1v1");
  const [seed, setSeed] = useState("");
  const [created, setCreated] = useState<{ code: string; match_id: string } | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joinAgent, setJoinAgent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<number | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    get<{ agents: AgentPublic[] }>("/api/agents").then((r) => {
      setAgents(r.agents);
      if (r.agents[0]) setJoinAgent(r.agents[0].id);
    });
  }, []);

  const create = async () => {
    setError(null);
    try {
      const r = await post<{ code: string; match_id: string }>("/api/matches/custom", {
        format, map_seed: seed ? Number(seed) : undefined });
      setCreated(r);
      setJoinCode(r.code);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const join = async () => {
    setError(null);
    try {
      const r = await post<{ match_id: string; started: boolean; waiting_for?: number }>(
        `/api/matches/custom/${joinCode}/join`, { agent_id: joinAgent });
      if (r.started) navigate(`/matches/${r.match_id}`);
      else setWaiting(r.waiting_for ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
    <h2>Private matches</h2>
    <p className="hint">
      Unranked battles by invite code. Two uses: fight a <strong>friend</strong>
      {" "}(send them the code), or fight <strong>yourself</strong> - if you have
      two or more agents, join the same code once with each of them and watch
      them battle it out. Great for testing personalities against each other.
    </p>
    <div className="row">
      <div className="col card">
        <h3>1. Create a match</h3>
        <p className="hint">You get a code. The match starts as soon as enough
          agents join.</p>
        <label>Format</label>
        <select value={format} onChange={(e) => setFormat(e.target.value)}>
          <option value="1v1">1v1</option>
          <option value="ffa3">FFA 3</option>
          <option value="ffa4">FFA 4</option>
        </select>
        <label>Map seed (optional)</label>
        <input value={seed} onChange={(e) => setSeed(e.target.value)}
               placeholder="random" />
        <button onClick={create}>Create</button>
        {created && (
          <p>Invite code: <code className="big">{created.code}</code>
            <span className="hint"> (expires in 30 min - join with your own agent below)</span></p>
        )}
      </div>

      <div className="col card">
        <h3>2. Join with a code</h3>
        <label>Code</label>
        <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)}
               placeholder="a1b2c3" />
        <label>Which of your agents joins</label>
        <select value={joinAgent} onChange={(e) => setJoinAgent(e.target.value)}>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name} ({a.lineage})</option>
          ))}
        </select>
        <ErrorText error={error} />
        <button onClick={join} disabled={!joinCode || !joinAgent}>Join</button>
        {waiting !== null && (
          <p className="hint">
            In the lobby - waiting for {waiting} more agent(s). Fighting yourself?
            Pick your other agent above and press Join again. The match opens the
            moment the arena is full.
          </p>
        )}
        {agents.length < 2 && (
          <p className="hint">
            Tip: to fight yourself you need a second agent.{" "}
            <Link to="/agents/new">Create one →</Link>
          </p>
        )}
      </div>
    </div>
    </>
  );
}
