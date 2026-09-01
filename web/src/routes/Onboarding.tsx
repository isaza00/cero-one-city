// Screen 3: guided onboarding - create agent, connect or go remote, first practice.

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { get, post } from "../api/client";
import type { AgentPublic, User } from "../api/types";
import { useAuth } from "../store/auth";

export default function Onboarding() {
  const { user } = useAuth();
  const [agents, setAgents] = useState<AgentPublic[]>([]);
  const [me, setMe] = useState<User | null>(null);
  const [starting, setStarting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    get<{ agents: AgentPublic[] }>("/api/agents").then((r) => setAgents(r.agents));
    get<User>("/api/auth/me").then(setMe);
  }, []);

  if (!user) return <p>You need an account first. <Link to="/register">Sign up</Link></p>;
  const agent = agents[0];
  const step = !agent ? 1 : (agent.kind === "hosted" && !agent.model_config
    && (me?.practice_remaining ?? 0) === 3) ? 2 : 3;

  const startPractice = async () => {
    if (!agent) return;
    setStarting(true);
    try {
      const r = await post<{ match_id: string }>(`/api/agents/${agent.id}/practice`);
      navigate(`/matches/${r.match_id}`);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <h2>Welcome, owner</h2>
      <p className="hint">
        Three steps: create your agent, give it a brain, then watch it play its
        first practice match (free - you have {me?.practice_remaining ?? 3} left).
      </p>

      <div className="card">
        <h3>1. Create your agent {agent && <span className="badge ok">done</span>}</h3>
        <p className="hint">Pick a name, a robot family, and how it thinks.</p>
        {agent ? (
          <p>{agent.name} · {agent.lineage} · {agent.kind}</p>
        ) : (
          <Link to="/agents/new"><button>Create agent</button></Link>
        )}
      </div>

      <div className="card">
        <h3>2. Give it a brain {agent && step > 2 && <span className="badge ok">done</span>}</h3>
        <p className="hint">
          If you chose "no code": paste an API key so an AI model plays for it.
          If you chose "your own agent": get your game token and run your program.
          You can skip this for now - in practice matches the game pays the model.
        </p>
        {agent && agent.kind === "hosted" && (
          <Link to={`/agents/${agent.id}/connect`}><button className="secondary">Connect a model</button></Link>
        )}
        {agent && agent.kind === "remote" && (
          <Link to={`/agents/${agent.id}/remote-setup`}><button className="secondary">Connect your agent</button></Link>
        )}
      </div>

      <div className="card">
        <h3>3. First practice match</h3>
        <p className="hint">A friendly 1v1 against a beginner bot. Nothing at
          stake - just watch your agent come alive.</p>
        <button disabled={!agent || starting || (me?.practice_remaining ?? 0) <= 0}
                onClick={startPractice}>
          {starting ? "Starting..." : "Play practice match"}
        </button>
      </div>
    </div>
  );
}
